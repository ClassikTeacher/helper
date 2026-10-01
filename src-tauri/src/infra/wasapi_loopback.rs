//! `WasapiLoopbackRecorder` — production impl of `AudioRecorder` (phase 9).
//! Captures the OUTPUT device via WASAPI loopback (record-what-you-hear) on a
//! dedicated background thread, accumulating raw interleaved `f32` samples until
//! drained. The `wasapi` crate enables loopback implicitly when an *output*
//! (render) device's audio client is initialized with `Direction::Capture` in
//! shared mode (see wasapi `api.rs::initialize_client` streamflags — it sets
//! `AUDCLNT_STREAMFLAGS_LOOPBACK` for exactly that combination).
//!
//! Why `wasapi` and not `cpal`: cpal has no Windows loopback support (see
//! decisions.md ADR #14 phase-9 de-risk notes). Windows-only, like the app's
//! `keyring` backend; the project is Windows-first.
//!
//! COM/threading: WASAPI COM objects are not `Send`, so every wasapi handle is
//! created and used entirely inside the capture thread. Only plain data crosses
//! the boundary — an `AtomicBool` stop flag and `Mutex`-guarded byte/format
//! buffers — which keeps the recorder `Send + Sync` for `AppState`.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use wasapi::{initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

use crate::infra::audio::STT_SAMPLE_RATE;
use crate::ports::{AudioRecorder, RecordedAudio};

/// How long the capture thread waits for the next "buffer ready" event before
/// looping back to re-check the stop flag. Short enough that `stop` returns
/// promptly even when the output is silent (no events fire during silence).
const EVENT_TIMEOUT_MS: u32 = 200;

/// Length of the rolling window a recording keeps: the LAST this-many seconds.
/// Bounds both the capture buffer's memory and the STT upload size (the
/// OpenAI-compatible endpoint rejects very large files) — 60 s of 16 kHz mono
/// PCM16 is ~1.9 MB. The window ROLLS instead of stopping (P0): the question
/// usually comes at the END of the interlocutor's speech, so a longer
/// recording drops its oldest audio, never its newest. Overridable at runtime
/// via `AI_HELPER_MAX_RECORDING_SECS`.
const DEFAULT_MAX_RECORDING_SECS: u32 = 60;

/// Environment variable overriding [`DEFAULT_MAX_RECORDING_SECS`] (whole seconds).
const MAX_RECORDING_SECS_ENV: &str = "AI_HELPER_MAX_RECORDING_SECS";

/// Parse the max-recording-seconds override, falling back to the default on an
/// absent/blank/invalid/zero value. Pure (env read is done by the caller) so it
/// is unit-tested directly.
fn resolve_max_secs(raw: Option<&str>) -> u32 {
    raw.and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_MAX_RECORDING_SECS)
}

/// Configured rolling-window length in seconds (env override or default).
/// Public: `audio_start_capture` reports it so the HUD can say "last N s".
pub fn max_recording_secs() -> u32 {
    resolve_max_secs(std::env::var(MAX_RECORDING_SECS_ENV).ok().as_deref())
}

/// Byte budget for the raw interleaved `f32` capture buffer at the given format:
/// `secs * sample_rate * channels * 4` — the rolling window's size.
fn max_bytes_for(secs: u32, sample_rate: u32, channels: u16) -> usize {
    secs as usize * sample_rate as usize * channels as usize * std::mem::size_of::<f32>()
}

/// Shared state written by the capture thread, drained by `take_audio`.
struct Capture {
    /// Raw interleaved `f32` little-endian bytes as delivered by WASAPI — a
    /// rolling window (oldest frames dropped past the byte budget). A deque so
    /// dropping from the front is O(dropped), not a memmove of the whole buffer.
    bytes: VecDeque<u8>,
    /// Device format discovered once at stream start: (sample_rate, channels).
    format: Option<(u32, u16)>,
}

struct Inner {
    running: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    capture: Arc<Mutex<Capture>>,
    /// Error surfaced from the capture thread (COM/WASAPI failure), reported by
    /// the next `stop`.
    thread_error: Arc<Mutex<Option<String>>>,
}

pub struct WasapiLoopbackRecorder {
    inner: Mutex<Inner>,
}

impl WasapiLoopbackRecorder {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                running: Arc::new(AtomicBool::new(false)),
                handle: None,
                capture: Arc::new(Mutex::new(Capture {
                    bytes: VecDeque::new(),
                    format: None,
                })),
                thread_error: Arc::new(Mutex::new(None)),
            }),
        }
    }

    /// Stop the capture thread (if any) and surface a thread error. Assumes the
    /// caller already holds the `inner` lock.
    fn stop_locked(inner: &mut Inner) -> Result<(), String> {
        inner.running.store(false, Ordering::SeqCst);
        if let Some(handle) = inner.handle.take() {
            let _ = handle.join();
        }
        if let Some(err) = inner
            .thread_error
            .lock()
            .map_err(|_| "audio state poisoned".to_string())?
            .take()
        {
            return Err(err);
        }
        Ok(())
    }
}

impl Default for WasapiLoopbackRecorder {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioRecorder for WasapiLoopbackRecorder {
    fn start(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "audio recorder poisoned".to_string())?;

        // Idempotent: a stray double-start (or leftover thread) is stopped first.
        Self::stop_locked(&mut inner)?;

        {
            let mut cap = inner
                .capture
                .lock()
                .map_err(|_| "audio buffer poisoned".to_string())?;
            cap.bytes.clear();
            cap.format = None;
        }
        *inner
            .thread_error
            .lock()
            .map_err(|_| "audio state poisoned".to_string())? = None;

        inner.running.store(true, Ordering::SeqCst);
        let running = inner.running.clone();
        let capture = inner.capture.clone();
        let thread_error = inner.thread_error.clone();

        let handle = std::thread::Builder::new()
            .name("wasapi-loopback".to_string())
            .spawn(move || {
                if let Err(e) = capture_loop(&running, &capture) {
                    if let Ok(mut slot) = thread_error.lock() {
                        *slot = Some(e);
                    }
                    running.store(false, Ordering::SeqCst);
                }
            })
            .map_err(|e| format!("Failed to spawn capture thread: {e}"))?;

        inner.handle = Some(handle);
        Ok(())
    }

    fn stop(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "audio recorder poisoned".to_string())?;
        Self::stop_locked(&mut inner)
    }

    fn take_audio(&self) -> Result<RecordedAudio, String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "audio recorder poisoned".to_string())?;
        let mut cap = inner
            .capture
            .lock()
            .map_err(|_| "audio buffer poisoned".to_string())?;

        let (sample_rate, channels) = cap.format.unwrap_or((STT_SAMPLE_RATE, 1));
        let bytes: Vec<u8> = std::mem::take(&mut cap.bytes).into();
        cap.format = None;

        Ok(RecordedAudio {
            samples: bytes_to_f32(&bytes),
            sample_rate,
            channels,
        })
    }
}

/// Drops the OLDEST bytes past `max_bytes`, in whole frames (`frame_bytes` =
/// channels × 4) so the interleaved channel order never shifts. Returns
/// whether anything was dropped. Pure — unit-tested.
fn keep_latest(buf: &mut VecDeque<u8>, max_bytes: usize, frame_bytes: usize) -> bool {
    if buf.len() <= max_bytes || frame_bytes == 0 {
        return false;
    }
    let excess = buf.len() - max_bytes;
    let drop = excess.div_ceil(frame_bytes) * frame_bytes;
    buf.drain(..drop.min(buf.len()));
    true
}

/// Reinterpret a little-endian `f32` byte buffer as samples. A trailing partial
/// sample (never expected from WASAPI, which delivers whole frames) is dropped.
fn bytes_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn map_wasapi<E: std::fmt::Display>(e: E) -> String {
    format!("WASAPI error: {e}")
}

/// The capture thread body: sets up a loopback capture client on the default
/// render device and appends captured bytes to `capture` until `running` clears.
fn capture_loop(running: &AtomicBool, capture: &Mutex<Capture>) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init (MTA) failed: {e}"))?;

    let enumerator = DeviceEnumerator::new().map_err(map_wasapi)?;
    // Default RENDER (output) device — its audio, captured via loopback.
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(map_wasapi)?;
    let mut audio_client = device.get_iaudioclient().map_err(map_wasapi)?;

    // Capture in the device's native rate/channel count but forced to `f32`
    // (autoconvert handles any int->float). Downmix + 16 kHz resample happen
    // later in pure Rust (`infra::audio`) rather than relying on loopback SRC.
    let mix = audio_client.get_mixformat().map_err(map_wasapi)?;
    let sample_rate = mix.get_samplespersec();
    let channels = mix.get_nchannels();
    let desired = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        sample_rate as usize,
        channels as usize,
        None,
    );

    let (_default_period, min_period) = audio_client.get_device_period().map_err(map_wasapi)?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: min_period,
    };
    // Render device + Direction::Capture + shared mode => loopback.
    audio_client
        .initialize_client(&desired, &Direction::Capture, &mode)
        .map_err(map_wasapi)?;

    let h_event = audio_client.set_get_eventhandle().map_err(map_wasapi)?;
    let capture_client = audio_client.get_audiocaptureclient().map_err(map_wasapi)?;

    {
        let mut cap = capture
            .lock()
            .map_err(|_| "audio buffer poisoned".to_string())?;
        cap.format = Some((sample_rate, channels));
    }

    audio_client.start_stream().map_err(map_wasapi)?;

    // Keep only the last `max_recording_secs()` of audio: bounded memory and
    // STT upload, and the newest speech (the actual question) is never lost.
    let max_bytes = max_bytes_for(max_recording_secs(), sample_rate, channels);
    let frame_bytes = channels as usize * std::mem::size_of::<f32>();

    let mut queue: VecDeque<u8> = VecDeque::new();
    while running.load(Ordering::SeqCst) {
        capture_client
            .read_from_device_to_deque(&mut queue)
            .map_err(map_wasapi)?;
        if !queue.is_empty() {
            let mut cap = capture
                .lock()
                .map_err(|_| "audio buffer poisoned".to_string())?;
            cap.bytes.extend(queue.drain(..));
            keep_latest(&mut cap.bytes, max_bytes, frame_bytes);
        }
        // Times out during silence (no events fire) — that's expected; we just
        // loop and re-check `running`.
        let _ = h_event.wait_for_event(EVENT_TIMEOUT_MS);
    }

    let _ = audio_client.stop_stream();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_to_f32_reads_little_endian_samples() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&1.0f32.to_le_bytes());
        bytes.extend_from_slice(&(-0.5f32).to_le_bytes());
        assert_eq!(bytes_to_f32(&bytes), vec![1.0, -0.5]);
    }

    #[test]
    fn keep_latest_drops_the_oldest_whole_frames_and_keeps_the_newest() {
        // 2-channel f32 frames are 8 bytes; budget = 2 frames.
        let mut buf: VecDeque<u8> = (0u8..32).collect(); // 4 frames
        assert!(keep_latest(&mut buf, 16, 8));
        assert_eq!(buf.iter().copied().collect::<Vec<_>>(), (16u8..32).collect::<Vec<_>>());
        // Within budget: untouched.
        assert!(!keep_latest(&mut buf, 16, 8));
        assert_eq!(buf.len(), 16);
    }

    #[test]
    fn keep_latest_rounds_up_to_a_whole_frame() {
        // 20 bytes, budget 16, frame 8 → excess 4 rounds up to one frame (8).
        let mut buf: VecDeque<u8> = (0u8..20).collect();
        keep_latest(&mut buf, 16, 8);
        assert_eq!(buf.len(), 12);
        assert_eq!(buf.front(), Some(&8));
    }

    #[test]
    fn bytes_to_f32_drops_trailing_partial_sample() {
        let mut bytes = 1.0f32.to_le_bytes().to_vec();
        bytes.push(0x00); // stray 5th byte
        assert_eq!(bytes_to_f32(&bytes), vec![1.0]);
    }

    #[test]
    fn take_audio_on_a_fresh_recorder_returns_empty() {
        let recorder = WasapiLoopbackRecorder::new();
        let audio = recorder.take_audio().unwrap();
        assert!(audio.samples.is_empty());
    }

    #[test]
    fn stop_without_start_is_ok() {
        let recorder = WasapiLoopbackRecorder::new();
        assert!(recorder.stop().is_ok());
    }

    #[test]
    fn resolve_max_secs_uses_the_override_when_valid() {
        assert_eq!(resolve_max_secs(Some("30")), 30);
        assert_eq!(resolve_max_secs(Some("  90 ")), 90);
    }

    #[test]
    fn resolve_max_secs_falls_back_on_absent_blank_invalid_or_zero() {
        assert_eq!(resolve_max_secs(None), DEFAULT_MAX_RECORDING_SECS);
        assert_eq!(resolve_max_secs(Some("")), DEFAULT_MAX_RECORDING_SECS);
        assert_eq!(resolve_max_secs(Some("abc")), DEFAULT_MAX_RECORDING_SECS);
        assert_eq!(resolve_max_secs(Some("0")), DEFAULT_MAX_RECORDING_SECS);
    }

    #[test]
    fn max_bytes_for_bounds_the_buffer_to_the_duration() {
        // 2 s of 16 kHz mono f32 = 2 * 16000 * 1 * 4.
        assert_eq!(max_bytes_for(2, 16_000, 1), 128_000);
        // Stereo doubles it.
        assert_eq!(max_bytes_for(2, 16_000, 2), 256_000);
        // The cap is always a whole number of 4-byte samples.
        assert_eq!(max_bytes_for(60, 48_000, 2) % 4, 0);
    }
}
