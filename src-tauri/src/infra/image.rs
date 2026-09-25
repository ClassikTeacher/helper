//! Image helpers for the screenshot → model path (R4/R17). Pure functions — no
//! I/O, no platform APIs — so they are unit-tested directly and shared by the
//! capturer (cap at capture time) and the LLM command (per-request cap).
//!
//! Why downscale at all: providers resize large images on their side anyway
//! (Anthropic: ~1568 px long edge for Haiku-class models, 2576 px for the
//! Claude 5 family), so sending more only costs upload time (TTFT) and, for
//! tile-priced fallback models, tokens. Why per REQUEST, not only at capture:
//! the right limit depends on the route/model (R17) — a heavy route with a
//! model that accepts 2576 px keeps small code fonts legible, a light route
//! does not need them. The capture keeps the largest useful size; each request
//! shrinks to its own limit.

use std::io::Cursor;

use base64::{engine::general_purpose::STANDARD, Engine as _};

use crate::dto::{LlmContentPart, LlmStreamRequest};

/// Largest long edge worth capturing: the high-resolution threshold of the
/// Claude 5 family. Mirrors `MAX_IMAGE_EDGE_LIMIT` in `core/domain/model-route.ts`.
pub const MAX_CAPTURE_LONG_EDGE_PX: u32 = 2576;

/// Target size preserving the aspect ratio so the long edge is `max_edge`, or
/// `None` when the image already fits (no-op — never upscale).
pub fn target_size(width: u32, height: u32, max_edge: u32) -> Option<(u32, u32)> {
    let long = width.max(height);
    if max_edge == 0 || long <= max_edge {
        return None;
    }
    let scale = max_edge as f64 / long as f64;
    let w = ((width as f64 * scale).round() as u32).max(1);
    let h = ((height as f64 * scale).round() as u32).max(1);
    Some((w, h))
}

/// Downscales RGBA so the long edge is at most `max_edge`; returns the input
/// untouched when it already fits.
pub fn downscale_to_long_edge(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    max_edge: u32,
) -> (u32, u32, Vec<u8>) {
    match target_size(width, height, max_edge) {
        None => (width, height, rgba),
        Some((w, h)) => (w, h, area_downscale_rgba(width, height, &rgba, w, h)),
    }
}

/// Area-averaging (box filter) downscale of a tightly packed RGBA buffer.
///
/// Each output pixel is the coverage-weighted average of EVERY source pixel
/// under its footprint (fractional weights on the edges). Unlike bilinear
/// sampling — which reads a 2×2 neighborhood and skips pixels once the factor
/// exceeds 2× (4K → 1568 is ×2.45) — no source pixel is lost, so thin glyph
/// strokes of code text fade instead of aliasing away.
///
/// Streams row by row: for each output row, the covered source rows are
/// horizontally resampled into a one-row scratch buffer and accumulated with
/// their vertical weight. Memory is O(output width) instead of a full f32
/// intermediate image (≈ 89 MB for 4K → 2576), and every pass walks memory
/// sequentially. A source row shared by two output rows (fractional edge) is
/// resampled twice — cheaper than keeping the intermediate image.
pub fn area_downscale_rgba(
    src_w: u32,
    src_h: u32,
    rgba: &[u8],
    dst_w: u32,
    dst_h: u32,
) -> Vec<u8> {
    let (sw, sh, dw, dh) = (src_w as usize, src_h as usize, dst_w as usize, dst_h as usize);
    debug_assert_eq!(rgba.len(), sw * sh * 4);

    let x_weights = axis_weights(sw, dw);
    let y_weights = axis_weights(sh, dh);
    let mut row = vec![0f32; dw * 4];
    let mut acc = vec![0f32; dw * 4];
    let mut out = vec![0u8; dw * dh * 4];

    for (dy, (y_start, y_ws)) in y_weights.iter().enumerate() {
        acc.fill(0.0);
        for (k, wy) in y_ws.iter().enumerate() {
            let src_row = &rgba[(y_start + k) * sw * 4..(y_start + k + 1) * sw * 4];
            resample_row(src_row, &x_weights, &mut row);
            for (a, r) in acc.iter_mut().zip(&row) {
                *a += r * wy;
            }
        }
        for (o, a) in out[dy * dw * 4..(dy + 1) * dw * 4].iter_mut().zip(&acc) {
            *o = a.round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

/// Horizontal box-filter pass of one RGBA row into `out` (dst_w × 4 floats).
fn resample_row(src_row: &[u8], x_weights: &[(usize, Vec<f32>)], out: &mut [f32]) {
    for (dx, (start, weights)) in x_weights.iter().enumerate() {
        let mut px = [0f32; 4];
        for (k, w) in weights.iter().enumerate() {
            let si = (start + k) * 4;
            for c in 0..4 {
                px[c] += src_row[si + c] as f32 * w;
            }
        }
        out[dx * 4..dx * 4 + 4].copy_from_slice(&px);
    }
}

/// For each destination index along one axis: the first source index it covers
/// and the normalized coverage weight of each covered source index.
fn axis_weights(src: usize, dst: usize) -> Vec<(usize, Vec<f32>)> {
    let scale = src as f64 / dst as f64;
    (0..dst)
        .map(|d| {
            let start = d as f64 * scale;
            let end = (d + 1) as f64 * scale;
            let first = start.floor() as usize;
            let last = (end.ceil() as usize).min(src); // exclusive
            let weights: Vec<f32> = (first..last)
                .map(|s| {
                    let lo = start.max(s as f64);
                    let hi = end.min((s + 1) as f64);
                    ((hi - lo) / scale) as f32
                })
                .collect();
            (first, weights)
        })
        .collect()
}

/// Encodes a tightly packed RGBA buffer as PNG (lossless — code text must stay
/// crisp; JPEG was deliberately deferred, see R4).
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("png write_header failed: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("png write_image_data failed: {e}"))?;
    }
    Ok(buf)
}

/// Reads only the PNG header: `(width, height)`. Cheap — no pixel decoding —
/// so an image that already fits is never decoded at all.
pub fn png_dimensions(png_bytes: &[u8]) -> Result<(u32, u32), String> {
    let reader = png::Decoder::new(Cursor::new(png_bytes))
        .read_info()
        .map_err(|e| format!("png read_info failed: {e}"))?;
    let info = reader.info();
    Ok((info.width, info.height))
}

/// Decodes a PNG into tightly packed 8-bit RGBA (expanding palette/gray/RGB).
pub fn decode_png_rgba(png_bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("png read_info failed: {e}"))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut buf)
        .map_err(|e| format!("png decode failed: {e}"))?;
    buf.truncate(frame.buffer_size());

    let rgba = match frame.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buf
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        other => return Err(format!("unsupported png color type after expand: {other:?}")),
    };
    Ok((frame.width, frame.height, rgba))
}

/// Shrinks a base64 PNG so its long edge is at most `max_edge`. `Ok(None)`
/// when it already fits (the header is read, the pixels are not).
pub fn shrink_png_base64(image_base64: &str, max_edge: u32) -> Result<Option<String>, String> {
    let bytes = STANDARD
        .decode(image_base64)
        .map_err(|e| format!("image is not valid base64: {e}"))?;
    let (width, height) = png_dimensions(&bytes)?;
    if target_size(width, height, max_edge).is_none() {
        return Ok(None);
    }
    let (w, h, rgba) = decode_png_rgba(&bytes)?;
    let (w, h, rgba) = downscale_to_long_edge(w, h, rgba, max_edge);
    Ok(Some(STANDARD.encode(encode_png(w, h, &rgba)?)))
}

/// Applies `request.max_image_edge` to every image part in place. An image
/// that cannot be processed (not a PNG, corrupt) is sent as-is: the provider
/// may still accept it, and dropping the user's screenshot would be worse than
/// sending it large. Images are processed in parallel (one scoped thread each —
/// a batch is at most 5 shots), so a batch costs about one image's time
/// (~80 ms for 1440p → 1568 in release) instead of the sum. Returns how many
/// images were downscaled.
pub fn downscale_request_images(request: &mut LlmStreamRequest) -> usize {
    let Some(max_edge) = request.max_image_edge else {
        return 0;
    };
    let images: Vec<&mut String> = request
        .messages
        .iter_mut()
        .flat_map(|m| m.parts.iter_mut())
        .filter_map(|part| match part {
            LlmContentPart::Image { image_base64 } => Some(image_base64),
            LlmContentPart::Text { .. } => None,
        })
        .collect();

    std::thread::scope(|scope| {
        let handles: Vec<_> = images
            .into_iter()
            .map(|image_base64| {
                scope.spawn(move || match shrink_png_base64(image_base64, max_edge) {
                    Ok(Some(smaller)) => {
                        *image_base64 = smaller;
                        true
                    }
                    Ok(None) => false,
                    Err(e) => {
                        eprintln!("[llm_stream] image left unscaled: {e}");
                        false
                    }
                })
            })
            .collect();
        // A panicking worker leaves its image untouched (counted as not shrunk).
        handles
            .into_iter()
            .map(|h| h.join().unwrap_or(false))
            .filter(|&shrunk| shrunk)
            .count()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::{LlmMessage, LlmRole};

    fn solid(width: u32, height: u32, px: [u8; 4]) -> Vec<u8> {
        px.iter().copied().cycle().take((width * height * 4) as usize).collect()
    }

    #[test]
    fn target_size_is_a_noop_within_the_limit_and_never_upscales() {
        assert_eq!(target_size(1568, 882, 1568), None);
        assert_eq!(target_size(100, 50, 1568), None);
        assert_eq!(target_size(10, 10, 0), None);
    }

    #[test]
    fn target_size_preserves_aspect_ratio_on_the_long_edge() {
        assert_eq!(target_size(2560, 1440, 1568), Some((1568, 882)));
        // Portrait: the long edge is the height.
        assert_eq!(target_size(1440, 2560, 1568), Some((882, 1568)));
        // 4K down to the Claude 5 limit.
        assert_eq!(target_size(3840, 2160, 2576), Some((2576, 1449)));
    }

    #[test]
    fn downscale_of_a_solid_image_keeps_the_color_exactly() {
        let (w, h, out) = downscale_to_long_edge(10, 6, solid(10, 6, [10, 20, 30, 255]), 4);
        assert_eq!((w, h), (4, 2));
        assert!(out.chunks_exact(4).all(|p| p == [10, 20, 30, 255]));
    }

    #[test]
    fn downscale_is_a_noop_when_the_image_fits() {
        let rgba = solid(3, 2, [1, 2, 3, 4]);
        let (w, h, out) = downscale_to_long_edge(3, 2, rgba.clone(), 3);
        assert_eq!((w, h), (3, 2));
        assert_eq!(out, rgba);
    }

    #[test]
    fn area_average_consumes_every_source_pixel_not_just_a_2x2_neighborhood() {
        // 5×1 → 1×1 (factor 5): a single white pixel in the MIDDLE of a black
        // row must still contribute 1/5 of its value. Bilinear sampling would
        // read only the two central-ish pixels and could miss it entirely.
        let mut row = solid(5, 1, [0, 0, 0, 255]);
        row[8..12].copy_from_slice(&[255, 255, 255, 255]);
        let out = area_downscale_rgba(5, 1, &row, 1, 1);
        assert_eq!(out, vec![51, 51, 51, 255]);
    }

    #[test]
    fn area_average_weights_fractional_edge_coverage() {
        // 3 → 2: output 0 covers src[0] fully + half of src[1]; output 1 covers
        // the other half of src[1] + src[2]. Values 0, 90, 180 → 30 and 150.
        let row: Vec<u8> = [0u8, 90, 180]
            .iter()
            .flat_map(|&v| [v, v, v, 255])
            .collect();
        let out = area_downscale_rgba(3, 1, &row, 2, 1);
        assert_eq!(out, vec![30, 30, 30, 255, 150, 150, 150, 255]);
    }

    #[test]
    fn png_round_trip_preserves_pixels_and_reads_dimensions_from_the_header() {
        let rgba: Vec<u8> = (0..(4 * 3 * 4)).map(|i| (i * 5) as u8).collect();
        let png = encode_png(4, 3, &rgba).unwrap();
        assert_eq!(png_dimensions(&png).unwrap(), (4, 3));
        assert_eq!(decode_png_rgba(&png).unwrap(), (4, 3, rgba));
    }

    #[test]
    fn shrink_png_base64_downscales_only_oversized_images() {
        let big = STANDARD.encode(encode_png(40, 20, &solid(40, 20, [9, 9, 9, 255])).unwrap());
        let shrunk = shrink_png_base64(&big, 10).unwrap().expect("should shrink");
        let bytes = STANDARD.decode(shrunk).unwrap();
        assert_eq!(png_dimensions(&bytes).unwrap(), (10, 5));

        assert_eq!(shrink_png_base64(&big, 40).unwrap(), None);
    }

    #[test]
    fn downscale_request_images_applies_the_limit_and_keeps_undecodable_images() {
        let big = STANDARD.encode(encode_png(40, 20, &solid(40, 20, [1, 1, 1, 255])).unwrap());
        let mut request = LlmStreamRequest {
            model: "m".to_string(),
            messages: vec![LlmMessage {
                role: LlmRole::User,
                parts: vec![
                    LlmContentPart::Image { image_base64: big.clone() },
                    LlmContentPart::Image { image_base64: "not-a-png".to_string() },
                    LlmContentPart::Text { text: "t".to_string() },
                ],
            }],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: Some(20),
            request_id: None,
        };

        assert_eq!(downscale_request_images(&mut request), 1);
        let LlmContentPart::Image { image_base64 } = &request.messages[0].parts[0] else {
            panic!("expected image");
        };
        let bytes = STANDARD.decode(image_base64).unwrap();
        assert_eq!(png_dimensions(&bytes).unwrap(), (20, 10));
        assert_eq!(
            request.messages[0].parts[1],
            LlmContentPart::Image { image_base64: "not-a-png".to_string() }
        );

        // No limit → untouched.
        let mut unlimited = request.clone();
        unlimited.max_image_edge = None;
        assert_eq!(downscale_request_images(&mut unlimited), 0);
    }
}
