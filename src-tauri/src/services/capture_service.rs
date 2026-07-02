//! CaptureService — depends on the ScreenCapturer trait (DI), not a concrete impl.

use crate::dto::{CaptureRequest, CaptureResult};
use crate::ports::ScreenCapturer;

pub struct CaptureService {
    capturer: Box<dyn ScreenCapturer>,
}

impl CaptureService {
    pub fn new(capturer: Box<dyn ScreenCapturer>) -> Self {
        Self { capturer }
    }

    pub fn capture(&self, request: &CaptureRequest) -> Result<CaptureResult, String> {
        self.capturer.capture(request)
    }
}
