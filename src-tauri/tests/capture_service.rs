//! Example Rust unit/integration test — proves the DI seam: CaptureService
//! works against a mock ScreenCapturer with no native dependencies.

use ai_helper_lib::dto::{CaptureRequest, CaptureResult};
use ai_helper_lib::ports::ScreenCapturer;
use ai_helper_lib::services::capture_service::CaptureService;

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
