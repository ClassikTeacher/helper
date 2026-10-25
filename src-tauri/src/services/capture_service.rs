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

// Proves the DI seam against a mock capturer with no native dependencies. A
// lib test rather than `tests/*.rs`: an integration test links the crate's
// `cdylib`, which the mingw cross-link rejects ("export ordinal too large"),
// so it never ran outside MSVC.
#[cfg(test)]
mod tests {
    use super::*;

    struct MockCapturer;

    impl ScreenCapturer for MockCapturer {
        fn capture(&self, _request: &CaptureRequest) -> Result<CaptureResult, String> {
            Ok(CaptureResult {
                image_base64: "AAAA".to_string(),
                width: 1920,
                height: 1080,
                captured_at: 42,
            })
        }
    }

    #[test]
    fn capture_service_delegates_to_capturer() {
        let service = CaptureService::new(Box::new(MockCapturer));
        let result = service.capture(&CaptureRequest::default()).unwrap();
        assert_eq!(result.width, 1920);
        assert_eq!(result.height, 1080);
        assert_eq!(result.captured_at, 42);
    }
}
