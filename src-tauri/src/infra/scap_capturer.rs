//! `ScreenCapturer` implementation backed by the `scap` crate (Windows Graphics
//! Capture / PipeWire). Ports the proven phase-0.5 spike (`examples/spike_scap.rs`)
//! into the production command path.
//!
//! The capture path per invocation is: build a one-shot `Capturer`, grab a single
//! BGRA frame, convert to RGBA, optionally crop to the requested region, encode to
//! PNG, and base64 it for the IPC seam (`CaptureResult.imageBase64`). See
//! architecture.md §3 (contract) and decisions.md (спайк scap).
//!
//! NOTE: uses the patched vendor copy of `scap` (see `vendor/scap/NOTES.md`) — the
//! published crate does not compile on Windows against `windows-capture` 1.5.0.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use scap::{
    capturer::{Capturer, Options, Resolution},
    frame::{Frame, FrameType, VideoFrame},
    get_all_targets, is_supported, Target,
};

use crate::dto::{CaptureRegion, CaptureRequest, CaptureResult};
use crate::ports::ScreenCapturer;

/// Longest edge (px) a captured frame is downscaled to before PNG-encoding.
/// 1568 px is the Anthropic vision sweet spot: anything larger is resized
/// server-side anyway, so sending more pixels only inflates upload time (TTFT)
/// and, on tile-priced fallback models (gpt-4o-mini), token cost — see
/// agents-improvement.md R4. Code text on a 2560-wide screenshot stays legible
/// at this size.
const MAX_IMAGE_LONG_EDGE_PX: u32 = 1568;

pub struct ScapCapturer;

impl ScapCapturer {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ScapCapturer {
    fn default() -> Self {
        Self::new()
    }
}

impl ScreenCapturer for ScapCapturer {
    fn capture(&self, request: &CaptureRequest) -> Result<CaptureResult, String> {
        if !is_supported() {
            return Err("screen capture is not supported on this platform build".to_string());
        }

        let target = select_target(request.display_index)?;

        let options = Options {
            fps: 1,
            target,
            show_cursor: true,
            show_highlight: false,
            output_type: FrameType::BGRAFrame,
            // Captured => raw pixels, no resampling (must match the crop math below).
            output_resolution: Resolution::Captured,
            ..Default::default()
        };

        let mut capturer =
            Capturer::build(options).map_err(|e| format!("Capturer::build failed: {e}"))?;
        capturer.start_capture();
        // We take a single frame. NOTE (WGC first-frame caveat): on some
        // GPUs/configs the very first Windows Graphics Capture frame can arrive
        // blank/delayed. We deliberately do NOT discard-and-refetch to "warm up":
        // `get_next_frame` blocks on a channel that is only fed when the
        // compositor produces a frame, so on a *static* screen a second fetch can
        // block until something on screen changes. A blank-first-frame, if it
        // shows up on other hardware, must be caught by manual testing (in the
        // phase-1 DoD) and fixed with a time-boxed strategy, not a naive discard.
        let frame_result = capturer.get_next_frame();
        capturer.stop_capture();

        let frame = frame_result.map_err(|e| format!("get_next_frame failed: {e:?}"))?;
        let (width, height, bgra) = match frame {
            Frame::Video(VideoFrame::BGRA(f)) => (f.width as u32, f.height as u32, f.data),
            _ => return Err("unexpected frame format (expected BGRA)".to_string()),
        };

        let (out_width, out_height, rgba) =
            bgra_to_rgba(width, height, &bgra, request.region.as_ref())?;
        let (out_width, out_height, rgba) =
            downscale_to_long_edge(out_width, out_height, rgba, MAX_IMAGE_LONG_EDGE_PX);
        let png = encode_png(out_width, out_height, &rgba)?;

        Ok(CaptureResult {
            image_base64: STANDARD.encode(&png),
            width: out_width,
            height: out_height,
            captured_at: now_millis(),
        })
    }
}

/// Pick the capture target. `None` => scap's main display (the common case). A
/// `display_index` selects the Nth display among all targets; out-of-range is a
/// hard error rather than a silent fallback to the wrong screen.
fn select_target(display_index: Option<u32>) -> Result<Option<Target>, String> {
    match display_index {
        None => Ok(None),
        Some(idx) => get_all_targets()
            .into_iter()
            .filter(|t| matches!(t, Target::Display(_)))
            .nth(idx as usize)
            .map(Some)
            .ok_or_else(|| format!("display index {idx} out of range")),
    }
}

/// Convert a top-down BGRA frame to RGBA, optionally cropping to `region`. scap
/// yields bytes in B,G,R,A order (row-major, top-down); PNG wants R,G,B,A, so the
/// blue/red channels are swapped per pixel. The region is clamped to the frame.
///
/// INVARIANT: the incoming buffer is expected to be tightly packed — exactly
/// `width * height * 4` bytes, one pixel per 4 bytes with no row padding. The
/// vendored `scap` guarantees this: on Windows it always applies a crop (default
/// = full display) and returns the frame via `Frame::buffer_crop().as_nopadding_buffer()`
/// (see `vendor/scap/src/capturer/engine/win/mod.rs`), which strips the D3D row
/// pitch/stride. We assert exact equality (below) rather than `>=` so that if a
/// future scap version ever leaks a padded (stride > width*4) buffer we fail
/// loudly instead of producing a skewed image — the classic WGC stride pitfall.
fn bgra_to_rgba(
    width: u32,
    height: u32,
    bgra: &[u8],
    region: Option<&CaptureRegion>,
) -> Result<(u32, u32, Vec<u8>), String> {
    let expected = (width as usize) * (height as usize) * 4;
    if bgra.len() != expected {
        return Err(format!(
            "unexpected frame buffer size {} (expected {expected} = {width}x{height}x4); \
             a mismatch means row padding/stride the capturer did not strip",
            bgra.len()
        ));
    }

    let (rx, ry, rw, rh) = match region {
        None => (0u32, 0u32, width, height),
        // DPI CAVEAT (dormant — no region-select UI yet): these coordinates are
        // interpreted as PHYSICAL device pixels against the captured frame. When a
        // future webview region-picker lands, it will hand over LOGICAL (CSS) pixels
        // that must be multiplied by the display scale factor (125%/150%/…) before
        // reaching here, or the crop will be offset/undersized on scaled displays.
        Some(r) => {
            let rx = r.x.min(width);
            let ry = r.y.min(height);
            let rw = r.width.min(width - rx);
            let rh = r.height.min(height - ry);
            if rw == 0 || rh == 0 {
                return Err("capture region is empty or outside the frame".to_string());
            }
            (rx, ry, rw, rh)
        }
    };

    let mut rgba = vec![0u8; (rw as usize) * (rh as usize) * 4];
    for row in 0..rh {
        let src_y = (ry + row) as usize;
        for col in 0..rw {
            let src_x = (rx + col) as usize;
            let si = (src_y * width as usize + src_x) * 4;
            let di = ((row as usize) * rw as usize + col as usize) * 4;
            rgba[di] = bgra[si + 2]; // R <- B position
            rgba[di + 1] = bgra[si + 1]; // G
            rgba[di + 2] = bgra[si]; // B <- R position
            rgba[di + 3] = bgra[si + 3]; // A
        }
    }
    Ok((rw, rh, rgba))
}

/// Downscales an RGBA image so its longest edge is at most `max_long_edge`,
/// preserving aspect ratio. Returns the input untouched when it already fits —
/// the common case for sub-QHD displays. Pure, so it is unit-tested without a
/// display, like `bgra_to_rgba`.
///
/// Uses AREA AVERAGING (box filter), not bilinear: each dst pixel averages the
/// whole src rectangle it covers, with fractional weights at the edges. At
/// downscale factors above 2x (a 4K frame -> 1568 px is ~2.45x) bilinear's 2x2
/// neighborhood skips src pixels entirely, aliasing exactly the thing this
/// capture exists for — small code text. Area averaging consumes every src
/// pixel, so thin glyph strokes dim proportionally instead of dropping out
/// (review finding, 2026-07-22).
fn downscale_to_long_edge(
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    max_long_edge: u32,
) -> (u32, u32, Vec<u8>) {
    let long_edge = width.max(height);
    if long_edge <= max_long_edge {
        return (width, height, rgba);
    }

    let scale = max_long_edge as f64 / long_edge as f64;
    // Round the short edge, pin the long edge exactly to the cap; both stay >= 1.
    let (dst_w, dst_h) = if width >= height {
        (max_long_edge, ((height as f64 * scale).round() as u32).max(1))
    } else {
        (((width as f64 * scale).round() as u32).max(1), max_long_edge)
    };

    let (sw, sh) = (width as f64, height as f64);
    let mut out = vec![0u8; (dst_w as usize) * (dst_h as usize) * 4];
    for dy in 0..dst_h {
        // The src-space box this dst pixel covers: [y0f, y1f) x [x0f, x1f).
        let y0f = dy as f64 * sh / dst_h as f64;
        let y1f = (dy + 1) as f64 * sh / dst_h as f64;
        for dx in 0..dst_w {
            let x0f = dx as f64 * sw / dst_w as f64;
            let x1f = (dx + 1) as f64 * sw / dst_w as f64;

            let mut acc = [0.0f64; 4];
            let mut sy = y0f.floor() as usize;
            while (sy as f64) < y1f {
                // Overlap of src row [sy, sy+1) with the box — 1.0 for interior
                // rows, fractional at the box edges.
                let wy = (sy as f64 + 1.0).min(y1f) - (sy as f64).max(y0f);
                let mut sx = x0f.floor() as usize;
                while (sx as f64) < x1f {
                    let wx = (sx as f64 + 1.0).min(x1f) - (sx as f64).max(x0f);
                    let si = (sy * width as usize + sx) * 4;
                    let w = wx * wy;
                    for c in 0..4 {
                        acc[c] += rgba[si + c] as f64 * w;
                    }
                    sx += 1;
                }
                sy += 1;
            }

            let area = (x1f - x0f) * (y1f - y0f);
            let di = ((dy as usize) * dst_w as usize + dx as usize) * 4;
            for c in 0..4 {
                out[di + c] = (acc[c] / area).round() as u8;
            }
        }
    }
    (dst_w, dst_h, out)
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
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

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_bgra(width: u32, height: u32, b: u8, g: u8, r: u8, a: u8) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            v.extend_from_slice(&[b, g, r, a]);
        }
        v
    }

    #[test]
    fn swaps_blue_and_red_channels_full_frame() {
        // One pixel, BGRA = (10, 20, 30, 40) -> RGBA = (30, 20, 10, 40).
        let bgra = solid_bgra(1, 1, 10, 20, 30, 40);
        let (w, h, rgba) = bgra_to_rgba(1, 1, &bgra, None).unwrap();
        assert_eq!((w, h), (1, 1));
        assert_eq!(rgba, vec![30, 20, 10, 40]);
    }

    #[test]
    fn crops_to_region_and_swaps_channels() {
        // 2x2 frame, crop the bottom-right 1x1 pixel at (1,1).
        let mut bgra = Vec::new();
        // row 0: p(0,0), p(1,0)
        bgra.extend_from_slice(&[0, 0, 0, 255]); // black
        bgra.extend_from_slice(&[0, 0, 0, 255]);
        // row 1: p(0,1), p(1,1)=BGRA(1,2,3,4)
        bgra.extend_from_slice(&[0, 0, 0, 255]);
        bgra.extend_from_slice(&[1, 2, 3, 4]);

        let region = CaptureRegion { x: 1, y: 1, width: 1, height: 1 };
        let (w, h, rgba) = bgra_to_rgba(2, 2, &bgra, Some(&region)).unwrap();
        assert_eq!((w, h), (1, 1));
        assert_eq!(rgba, vec![3, 2, 1, 4]); // R<-B, G, B<-R, A
    }

    #[test]
    fn clamps_region_to_frame_bounds() {
        let bgra = solid_bgra(2, 2, 5, 6, 7, 8);
        // Request a region that overruns the frame; it clamps to the 2x2 frame.
        let region = CaptureRegion { x: 0, y: 0, width: 99, height: 99 };
        let (w, h, rgba) = bgra_to_rgba(2, 2, &bgra, Some(&region)).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(rgba.len(), 2 * 2 * 4);
    }

    #[test]
    fn rejects_empty_region() {
        let bgra = solid_bgra(2, 2, 0, 0, 0, 255);
        let region = CaptureRegion { x: 2, y: 2, width: 1, height: 1 };
        assert!(bgra_to_rgba(2, 2, &bgra, Some(&region)).is_err());
    }

    #[test]
    fn rejects_undersized_buffer() {
        let bgra = vec![0u8; 4]; // claims 2x2 but only holds 1 pixel
        assert!(bgra_to_rgba(2, 2, &bgra, None).is_err());
    }

    fn solid_rgba(width: u32, height: u32, px: [u8; 4]) -> Vec<u8> {
        let mut v = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..(width * height) {
            v.extend_from_slice(&px);
        }
        v
    }

    #[test]
    fn downscale_is_a_no_op_when_within_the_cap() {
        let rgba = solid_rgba(1568, 900, [1, 2, 3, 4]);
        let (w, h, out) = downscale_to_long_edge(1568, 900, rgba.clone(), 1568);
        assert_eq!((w, h), (1568, 900));
        assert_eq!(out, rgba); // untouched, not resampled
    }

    #[test]
    fn downscale_caps_landscape_long_edge_and_keeps_aspect() {
        // QHD screen: 2560x1440 -> long edge 1568, short edge 1440*(1568/2560)=882.
        let rgba = solid_rgba(2560, 1440, [10, 20, 30, 255]);
        let (w, h, out) = downscale_to_long_edge(2560, 1440, rgba, 1568);
        assert_eq!((w, h), (1568, 882));
        assert_eq!(out.len(), 1568 * 882 * 4);
    }

    #[test]
    fn downscale_caps_portrait_long_edge() {
        let rgba = solid_rgba(1440, 2560, [10, 20, 30, 255]);
        let (w, h, _) = downscale_to_long_edge(1440, 2560, rgba, 1568);
        assert_eq!((w, h), (882, 1568));
    }

    #[test]
    fn downscale_preserves_solid_color_exactly() {
        // Bilinear over a constant image must not shift channel values.
        let rgba = solid_rgba(3200, 200, [7, 130, 200, 255]);
        let (w, h, out) = downscale_to_long_edge(3200, 200, rgba, 1568);
        assert_eq!((w, h), (1568, 98));
        assert!(out.chunks_exact(4).all(|px| px == [7, 130, 200, 255]));
    }

    #[test]
    fn downscale_averages_neighboring_pixels() {
        // 2x1 squeezed into 1x1: the dst pixel covers both src pixels equally
        // -> exact 50/50 average.
        let rgba = vec![0, 0, 0, 255, 200, 100, 50, 255];
        let (w, h, out) = downscale_to_long_edge(2, 1, rgba, 1);
        assert_eq!((w, h), (1, 1));
        assert_eq!(out, vec![100, 50, 25, 255]);
    }

    #[test]
    fn downscale_consumes_every_source_pixel_not_just_a_2x2_neighborhood() {
        // 4x1 -> 1x1 at 4x reduction. Bilinear would sample only the two
        // central pixels (both 0 here) and lose the bright pixel entirely —
        // the small-text aliasing failure mode. Area averaging must weigh all
        // four: (0 + 0 + 0 + 120) / 4 = 30.
        let rgba = vec![
            0, 0, 0, 255, //
            0, 0, 0, 255, //
            0, 0, 0, 255, //
            120, 120, 120, 255,
        ];
        let (w, h, out) = downscale_to_long_edge(4, 1, rgba, 1);
        assert_eq!((w, h), (1, 1));
        assert_eq!(out, vec![30, 30, 30, 255]);
    }

    #[test]
    fn encodes_valid_png_signature() {
        let rgba = vec![255u8, 0, 0, 255];
        let png = encode_png(1, 1, &rgba).unwrap();
        // PNG magic bytes.
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }
}
