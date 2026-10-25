//! Local OCR pipeline (phase 6): PaddleOCR text detection + recognition run
//! through ONNX Runtime (`infra::ort_ocr`), plus the pure pre/post-processing
//! here. Tuned for screens: horizontal text, code in a monospaced font.

pub mod det;
pub mod imaging;
pub mod layout;
pub mod rec;
