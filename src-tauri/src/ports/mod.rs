//! Ports (traits) — the replaceable seams inside the Rust core. Any concrete
//! implementation in `infra/` can be swapped as long as it honors these traits.

use crate::dto::{CaptureRequest, CaptureResult, OcrRequest, OcrResult};

pub trait ScreenCapturer: Send + Sync {
    fn capture(&self, request: &CaptureRequest) -> Result<CaptureResult, String>;
}

pub trait OcrEngine: Send + Sync {
    fn recognize(&self, request: &OcrRequest) -> Result<OcrResult, String>;
}

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
}
