//! OcrEngine implementation.
//!
//! STUB (phase 0): returns empty text.
//! TODO(phase 6): implement with `ort` (ONNX Runtime) + RapidOCR/PP-OCRv4.

use crate::dto::{OcrRequest, OcrResult};
use crate::ports::OcrEngine;

pub struct OrtOcr;

impl OrtOcr {
    pub fn new() -> Self {
        Self
    }
}

impl Default for OrtOcr {
    fn default() -> Self {
        Self::new()
    }
}

impl OcrEngine for OrtOcr {
    fn recognize(&self, _request: &OcrRequest) -> Result<OcrResult, String> {
        Ok(OcrResult {
            full_text: String::new(),
            boxes: Vec::new(),
        })
    }
}
