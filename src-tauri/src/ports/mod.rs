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

/// Raw captured audio drained from a recorder: interleaved `f32` samples plus
/// the format needed to interpret them. `infra::audio` downmixes/resamples this
/// into the 16 kHz mono WAV the STT endpoint wants.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedAudio {
    /// Interleaved samples (`channels` values per frame).
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Loopback audio recorder (phase 9): captures the OUTPUT device (the
/// interlocutor's voice) between `start` and `stop`. Toggle-driven, not a live
/// stream — the webview starts recording on a hotkey, and drains the buffer via
/// `take_audio` at send time. `start`/`stop` are idempotent so a double toggle
/// or a stop-without-start can't panic.
pub trait AudioRecorder: Send + Sync {
    /// Begin capturing loopback audio, discarding anything previously buffered.
    fn start(&self) -> Result<(), String>;
    /// Stop capturing. Buffered samples are retained until `take_audio`.
    fn stop(&self) -> Result<(), String>;
    /// Drain and return everything captured since `start`, clearing the buffer.
    fn take_audio(&self) -> Result<RecordedAudio, String>;
}
