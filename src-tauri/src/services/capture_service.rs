//! CaptureService — depends on the ScreenCapturer trait (DI), not a concrete impl.

use crate::dto::CaptureResult;
use crate::ports::{CaptureSpec, ScreenCapturer};

pub struct CaptureService {
    capturer: Box<dyn ScreenCapturer>,
}

impl CaptureService {
    pub fn new(capturer: Box<dyn ScreenCapturer>) -> Self {
        Self { capturer }
    }

    pub fn capture(&self, spec: &CaptureSpec) -> Result<CaptureResult, String> {
        self.capturer.capture(spec)
    }
}

// Proves the DI seam against a mock capturer with no native dependencies. A
// lib test rather than `tests/*.rs`: an integration test links the crate's
// `cdylib`, which the mingw cross-link rejects ("export ordinal too large"),
// so it never ran outside MSVC.
#[cfg(test)]
mod tests {
    use super::*;

    use crate::dto::CaptureSource;
    use crate::ports::CaptureTargetSpec;

    struct MockCapturer;

    impl ScreenCapturer for MockCapturer {
        fn capture(&self, spec: &CaptureSpec) -> Result<CaptureResult, String> {
            Ok(CaptureResult {
                image_base64: "AAAA".to_string(),
                width: 1920,
                height: 1080,
                captured_at: 42,
                source: if spec.is_window() { CaptureSource::Window } else { CaptureSource::Monitor },
            })
        }
    }

    #[test]
    fn capture_service_delegates_to_capturer() {
        let service = CaptureService::new(Box::new(MockCapturer));
        let spec = CaptureSpec {
            target: CaptureTargetSpec::MainDisplay,
            region: None,
        };
        let result = service.capture(&spec).unwrap();
        assert_eq!(result.width, 1920);
        assert_eq!(result.height, 1080);
        assert_eq!(result.captured_at, 42);
        assert_eq!(result.source, CaptureSource::Monitor);

        let window = CaptureSpec {
            target: CaptureTargetSpec::Window { hwnd: 7 },
            region: None,
        };
        assert_eq!(service.capture(&window).unwrap().source, CaptureSource::Window);
    }
}
