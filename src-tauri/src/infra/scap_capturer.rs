//! ScreenCapturer implementation.
//!
//! STUB (phase 0): returns a 1x1 transparent PNG so the command path works end
//! to end before the native capture crate is wired.
//! TODO(phase 1): implement with the `scap` crate (Windows Graphics Capture /
//! PipeWire) and honor `CaptureRequest.region` / `display_index`.

use crate::dto::{CaptureRequest, CaptureResult};
use crate::ports::ScreenCapturer;

/// 1x1 transparent PNG, base64.
const TINY_PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
    fn capture(&self, _request: &CaptureRequest) -> Result<CaptureResult, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Ok(CaptureResult {
            image_base64: TINY_PNG.to_string(),
            width: 1,
            height: 1,
            captured_at: now,
        })
    }
}
