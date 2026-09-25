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
use crate::infra::image::{downscale_to_long_edge, encode_png, MAX_CAPTURE_LONG_EDGE_PX};
use crate::ports::ScreenCapturer;

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

        let target = select_target(request.display_index, request.display_name.as_deref())?;

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

        let (crop_width, crop_height, rgba) =
            bgra_to_rgba(width, height, &bgra, request.region.as_ref())?;
        // Cap at the largest size any model uses (R4/R17): a 4K frame is
        // area-downscaled once here; the per-request cap (route/model
        // specific) is applied later in `llm_stream`. 2560×1440 passes as-is.
        let (out_width, out_height, rgba) =
            downscale_to_long_edge(crop_width, crop_height, rgba, MAX_CAPTURE_LONG_EDGE_PX);
        let png = encode_png(out_width, out_height, &rgba)?;

        Ok(CaptureResult {
            image_base64: STANDARD.encode(&png),
            width: out_width,
            height: out_height,
            captured_at: now_millis(),
        })
    }
}

/// Pick the capture target. An explicit `display_index` selects the Nth
/// display (out-of-range is a hard error — the caller asked for it). Otherwise
/// `display_name` (the monitor under the cursor, resolved by `capture_screen`)
/// is matched against the displays' device names; no match, or no name, falls
/// back to scap's main display (`None`) — cursor detection is best-effort.
fn select_target(
    display_index: Option<u32>,
    display_name: Option<&str>,
) -> Result<Option<Target>, String> {
    let displays = || {
        get_all_targets()
            .into_iter()
            .filter(|t| matches!(t, Target::Display(_)))
            .collect::<Vec<_>>()
    };
    if let Some(idx) = display_index {
        return displays()
            .into_iter()
            .nth(idx as usize)
            .map(Some)
            .ok_or_else(|| format!("display index {idx} out of range"));
    }
    let Some(name) = display_name else {
        return Ok(None);
    };
    let mut displays = displays();
    let titles: Vec<&str> = displays
        .iter()
        .map(|t| match t {
            Target::Display(d) => d.title.as_str(),
            _ => "",
        })
        .collect();
    Ok(match_display(&titles, name).map(|i| displays.swap_remove(i)))
}

/// Index of the display whose device name equals `name` (case-insensitive —
/// Windows device names are `\\.\DISPLAYn`, casing is not guaranteed). Pure.
fn match_display(titles: &[&str], name: &str) -> Option<usize> {
    titles.iter().position(|t| t.eq_ignore_ascii_case(name))
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
    fn match_display_finds_the_cursor_monitor_by_device_name() {
        let titles = [r"\\.\DISPLAY1", r"\\.\DISPLAY2"];
        assert_eq!(match_display(&titles, r"\\.\display2"), Some(1));
        assert_eq!(match_display(&titles, r"\\.\DISPLAY9"), None);
    }

    #[test]
    fn rejects_undersized_buffer() {
        let bgra = vec![0u8; 4]; // claims 2x2 but only holds 1 pixel
        assert!(bgra_to_rgba(2, 2, &bgra, None).is_err());
    }
}
