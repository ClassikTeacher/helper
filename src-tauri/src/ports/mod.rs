//! Ports (traits) — the replaceable seams inside the Rust core. Any concrete
//! implementation in `infra/` can be swapped as long as it honors these traits.

use crate::dto::{CaptureRegion, CaptureResult, OcrRequest, OcrResult};

/// What `capture_screen` resolved a request to: the DTO's optional display
/// fields and `target` become one explicit choice, so the capturer never
/// guesses (and the fallback order lives in exactly one place — the command).
#[derive(Debug, Clone, PartialEq)]
pub enum CaptureTargetSpec {
    /// scap's main display — the fallback when nothing better is known.
    MainDisplay,
    /// The Nth display (out of range is a hard error — the caller asked for it).
    DisplayIndex(u32),
    /// A display by OS device name (`\\.\DISPLAY2`), e.g. the monitor under
    /// the cursor; an unknown name falls back to the main display.
    DisplayName(String),
    /// A top-level window by native handle (F5: the active window).
    Window { hwnd: isize },
}

#[derive(Debug, Clone, PartialEq)]
pub struct CaptureSpec {
    pub target: CaptureTargetSpec,
    /// Optional sub-region of the target (physical pixels).
    pub region: Option<CaptureRegion>,
}

impl CaptureSpec {
    pub fn is_window(&self) -> bool {
        matches!(self.target, CaptureTargetSpec::Window { .. })
    }
}

pub trait ScreenCapturer: Send + Sync {
    fn capture(&self, spec: &CaptureSpec) -> Result<CaptureResult, String>;
}

/// Whether the local OCR is installed (phase 6) — from the files alone.
#[derive(Debug, Clone, PartialEq)]
pub struct OcrStatus {
    pub available: bool,
    /// The optional Cyrillic recognition model is installed.
    pub cyrillic: bool,
    /// The OCR folder looked at.
    pub dir: String,
    /// What is missing, when not available.
    pub detail: Option<String>,
}

pub trait OcrEngine: Send + Sync {
    fn recognize(&self, request: &OcrRequest) -> Result<OcrResult, String>;
    /// Whether the engine can run (installed files) — cheap, loads nothing.
    fn status(&self) -> OcrStatus;
}

/// OS credential store. `get` is NATIVE-ONLY: it backs the provider calls
/// (`llm_stream`, `transcribe_audio`) and is deliberately not exposed as an
/// IPC command — the webview only ever gets `secret_has`/`secret_set`/
/// `secret_delete` (see `commands/secrets.rs`).
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    /// Remove the secret. A key that is not set is not an error.
    fn delete(&self, key: &str) -> Result<(), String>;
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
    /// Keeps a rolling window of the last `window_secs` seconds (F2: chosen in
    /// settings; the command resolves env > settings > default).
    fn start(&self, window_secs: u32) -> Result<(), String>;
    /// Stop capturing. Buffered samples are retained until `take_audio`.
    fn stop(&self) -> Result<(), String>;
    /// Drain and return everything captured since `start`, clearing the buffer.
    fn take_audio(&self) -> Result<RecordedAudio, String>;
}
