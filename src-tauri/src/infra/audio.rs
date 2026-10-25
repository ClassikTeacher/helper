//! Pure audio DSP for the phase-9 STT path: downmix to mono, resample to the
//! rate Whisper expects (16 kHz), quantize to signed 16-bit PCM, and wrap the
//! result in a WAV container. All framework-free and deterministic, so they are
//! unit-tested directly (same pattern as `scap_capturer::bgra_to_rgba`). The
//! live WASAPI loopback capture that produces the raw interleaved samples lives
//! in `wasapi_loopback.rs`; the command in `commands/audio.rs` ties the two
//! together and hands the WAV to `stt_client`.

/// Target sample rate for the STT upload. Whisper-family models operate at
/// 16 kHz internally; uploading anything higher just wastes bytes/tokens.
pub const STT_SAMPLE_RATE: u32 = 16_000;

/// Downmix interleaved multi-channel `f32` samples to mono by averaging the
/// channels of each frame. `channels <= 1` returns the input unchanged. A
/// trailing partial frame (should not happen with WASAPI, but guard anyway) is
/// dropped by `chunks_exact`.
pub fn downmix_to_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    let ch = channels as usize;
    interleaved
        .chunks_exact(ch)
        .map(|frame| frame.iter().sum::<f32>() / ch as f32)
        .collect()
}

/// Resample a mono signal from `from_rate` to `to_rate` with linear
/// interpolation. Good enough for speech STT (Whisper is robust to mild
/// resampling artifacts); a polyphase/sinc resampler would be overkill and add
/// a dependency (KISS / narrow native surface).
pub fn resample_linear(mono: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || mono.len() < 2 {
        return mono.to_vec();
    }
    let ratio = to_rate as f64 / from_rate as f64;
    let out_len = ((mono.len() as f64) * ratio).round().max(1.0) as usize;
    let last = mono.len() - 1;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let idx = src.floor() as usize;
        let frac = src - idx as f64;
        let a = mono[idx.min(last)] as f64;
        let b = mono[(idx + 1).min(last)] as f64;
        out.push((a + (b - a) * frac) as f32);
    }
    out
}

/// Quantize `f32` samples (nominally in [-1.0, 1.0]) to signed 16-bit PCM,
/// clamping out-of-range values so a hot signal saturates to full-scale instead
/// of wrapping.
pub fn f32_to_pcm16(mono: &[f32]) -> Vec<i16> {
    mono.iter()
        .map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            (clamped * i16::MAX as f32).round() as i16
        })
        .collect()
}

/// Wrap mono PCM16 samples in a canonical 44-byte-header WAV (RIFF/WAVE) so the
/// STT endpoint can decode it. Hand-written rather than pulling in `hound` — the
/// header is fixed and tiny, and keeping the native dependency set narrow is a
/// project principle (see architecture.md §1).
pub fn encode_wav_pcm16_mono(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    const CHANNELS: u16 = 1;
    const BITS_PER_SAMPLE: u16 = 16;
    let block_align: u16 = CHANNELS * (BITS_PER_SAMPLE / 8);
    let byte_rate: u32 = sample_rate * block_align as u32;
    let data_len: u32 = (samples.len() * 2) as u32;

    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
    wav.extend_from_slice(&1u16.to_le_bytes()); // audio format = 1 (PCM)
    wav.extend_from_slice(&CHANNELS.to_le_bytes());
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        wav.extend_from_slice(&s.to_le_bytes());
    }
    wav
}

/// Full pipeline WITHOUT the silence gate: raw interleaved `f32` capture ->
/// 16 kHz mono PCM16 WAV bytes. Used by the phase-9 spike (which wants to
/// hear exactly what was captured); the command path uses `prepare_stt_audio`.
pub fn samples_to_wav(interleaved: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let mono = downmix_to_mono(interleaved, channels);
    let resampled = resample_linear(&mono, sample_rate, STT_SAMPLE_RATE);
    let pcm = f32_to_pcm16(&resampled);
    encode_wav_pcm16_mono(&pcm, STT_SAMPLE_RATE)
}

// --- Silence gate (2026-10 review §3.2) ------------------------------------
// Whisper is known to hallucinate plausible phrases ("Продолжение следует…",
// subtitle credits, "Thank you for watching") on silence and noise, and the
// solver prompt is told the transcript is MORE recent than the screenshot —
// so silent audio must never reach STT. The gate also trims the silence at
// both ends (a smaller upload = a faster answer).

/// Default level below which a 20 ms frame counts as silence. −50 dBFS is far
/// under speech through a loopback device (speech sits around −30…−10 dBFS)
/// but above the noise floor of an idle output (−90 dBFS and below).
pub const DEFAULT_SILENCE_DBFS: f32 = -50.0;
/// Override: a dBFS value (≤ 0), or `off` to disable the gate.
const SILENCE_DBFS_ENV: &str = "AI_HELPER_STT_SILENCE_DBFS";
/// Analysis window of the gate.
const GATE_FRAME_MS: u32 = 20;
/// Audio kept around the detected speech so word onsets/tails are not clipped.
const GATE_PAD_MS: u32 = 200;
/// Shorter activity than this is a click or a pop, not speech.
const MIN_SPEECH_MS: u32 = 300;

/// dBFS → linear amplitude (full scale = 1.0).
pub fn dbfs_to_amplitude(dbfs: f32) -> f32 {
    10f32.powf(dbfs / 20.0)
}

/// The gate threshold (linear amplitude) from the process environment;
/// `None` = the gate is off and the clip is uploaded exactly as recorded.
pub fn silence_threshold_from_env() -> Option<f32> {
    resolve_silence_threshold(std::env::var(SILENCE_DBFS_ENV).ok().as_deref())
}

/// The gate threshold for one transcription (F2): `AI_HELPER_STT_SILENCE_DBFS`
/// when set (operator override), else the request's settings (`gate` off →
/// `None`; on → `dbfs`, the default level when absent/invalid), else the
/// default. Pure — unit-tested.
pub fn resolve_silence_threshold_with(
    env_raw: Option<&str>,
    gate: Option<bool>,
    dbfs: Option<f32>,
) -> Option<f32> {
    if let Some(raw) = env_raw.map(str::trim).filter(|v| !v.is_empty()) {
        return resolve_silence_threshold(Some(raw));
    }
    if gate == Some(false) {
        return None;
    }
    let level = dbfs
        .filter(|d| d.is_finite() && *d <= 0.0)
        .unwrap_or(DEFAULT_SILENCE_DBFS);
    Some(dbfs_to_amplitude(level))
}

/// The raw `AI_HELPER_STT_SILENCE_DBFS` value, for [`resolve_silence_threshold_with`].
pub fn silence_threshold_env_raw() -> Option<String> {
    std::env::var(SILENCE_DBFS_ENV).ok()
}

/// `off` → `None` (gate disabled); a finite dBFS ≤ 0 → that level;
/// unset/blank/invalid → the default. Pure — unit-tested.
fn resolve_silence_threshold(raw: Option<&str>) -> Option<f32> {
    let default = Some(dbfs_to_amplitude(DEFAULT_SILENCE_DBFS));
    match raw.map(str::trim) {
        Some(v) if v.eq_ignore_ascii_case("off") => None,
        Some(v) if !v.is_empty() => v
            .parse::<f32>()
            .ok()
            .filter(|d| d.is_finite() && *d <= 0.0)
            .map_or(default, |dbfs| Some(dbfs_to_amplitude(dbfs))),
        _ => default,
    }
}

/// The sample range `[start, end)` worth transcribing: from `GATE_PAD_MS`
/// before the first 20 ms frame whose RMS exceeds `threshold` to `GATE_PAD_MS`
/// after the last one. `None` when no frame exceeds the threshold, or the
/// activity spans less than `MIN_SPEECH_MS` — i.e. the clip is silent. Pure.
pub fn speech_span(mono: &[f32], sample_rate: u32, threshold: f32) -> Option<(usize, usize)> {
    let frame = (sample_rate * GATE_FRAME_MS / 1000).max(1) as usize;
    let mut first = None;
    let mut last = None;
    for (i, chunk) in mono.chunks(frame).enumerate() {
        if rms(chunk) > threshold {
            first.get_or_insert(i);
            last = Some(i);
        }
    }
    let (first, last) = (first?, last?);
    let span_ms = ((last - first + 1) * frame) as u64 * 1000 / sample_rate as u64;
    if span_ms < MIN_SPEECH_MS as u64 {
        return None;
    }
    let pad = (sample_rate * GATE_PAD_MS / 1000) as usize;
    let start = (first * frame).saturating_sub(pad);
    let end = ((last + 1) * frame + pad).min(mono.len());
    Some((start, end))
}

/// The command-path pipeline: raw interleaved `f32` capture -> 16 kHz mono ->
/// silence gate/trim -> PCM16 WAV bytes ready to POST to STT. `None` when
/// there is nothing to transcribe — the clip is silent under the gate, or
/// empty (not an error). `threshold: None` turns the gate off: the clip is
/// uploaded exactly as recorded.
pub fn prepare_stt_audio(
    interleaved: &[f32],
    sample_rate: u32,
    channels: u16,
    threshold: Option<f32>,
) -> Option<Vec<u8>> {
    let mono = downmix_to_mono(interleaved, channels);
    let resampled = resample_linear(&mono, sample_rate, STT_SAMPLE_RATE);
    let (start, end) = match threshold {
        Some(threshold) => speech_span(&resampled, STT_SAMPLE_RATE, threshold)?,
        None if resampled.is_empty() => return None,
        None => (0, resampled.len()),
    };
    let pcm = f32_to_pcm16(&resampled[start..end]);
    Some(encode_wav_pcm16_mono(&pcm, STT_SAMPLE_RATE))
}

/// Root-mean-square amplitude of a signal — the "is this silence?" measure
/// behind the gate (and the phase-9 spike's sanity check).
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt() as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_averages_stereo_frames_to_mono() {
        // frames: (1.0, 0.0), (0.5, -0.5) -> 0.5, 0.0
        let interleaved = [1.0, 0.0, 0.5, -0.5];
        assert_eq!(downmix_to_mono(&interleaved, 2), vec![0.5, 0.0]);
    }

    #[test]
    fn downmix_passes_mono_through_unchanged() {
        let mono = [0.1, 0.2, 0.3];
        assert_eq!(downmix_to_mono(&mono, 1), vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn resample_is_identity_when_rates_match() {
        let mono = [0.0, 0.5, 1.0, 0.5];
        assert_eq!(resample_linear(&mono, 16_000, 16_000), mono.to_vec());
    }

    #[test]
    fn resample_halving_rate_roughly_halves_length() {
        let mono: Vec<f32> = (0..100).map(|i| i as f32 / 100.0).collect();
        let out = resample_linear(&mono, 32_000, 16_000);
        assert_eq!(out.len(), 50);
        // Linear interpolation keeps the first sample equal to the source.
        assert!((out[0] - 0.0).abs() < 1e-6);
    }

    #[test]
    fn f32_to_pcm16_clamps_out_of_range() {
        let pcm = f32_to_pcm16(&[0.0, 1.0, -1.0, 2.0, -2.0]);
        assert_eq!(pcm, vec![0, i16::MAX, -i16::MAX, i16::MAX, -i16::MAX]);
    }

    #[test]
    fn wav_header_describes_16bit_mono_pcm() {
        let wav = encode_wav_pcm16_mono(&[0, 1, -1], 16_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        // fmt chunk size = 16
        assert_eq!(u32::from_le_bytes([wav[16], wav[17], wav[18], wav[19]]), 16);
        // audio format = 1 (PCM)
        assert_eq!(u16::from_le_bytes([wav[20], wav[21]]), 1);
        // channels = 1 (mono)
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1);
        // sample rate = 16000
        assert_eq!(u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]), 16_000);
        // bits per sample = 16
        assert_eq!(u16::from_le_bytes([wav[34], wav[35]]), 16);
        assert_eq!(&wav[36..40], b"data");
        // data length = 3 samples * 2 bytes
        assert_eq!(u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]), 6);
        assert_eq!(wav.len(), 44 + 6);
    }

    #[test]
    fn rms_is_zero_for_silence_and_positive_for_signal() {
        assert_eq!(rms(&[0.0, 0.0, 0.0]), 0.0);
        assert!(rms(&[0.5, -0.5, 0.5, -0.5]) > 0.0);
    }

    // --- Silence gate -----------------------------------------------------

    const SR: u32 = STT_SAMPLE_RATE; // 16 kHz: a 20 ms frame is 320 samples

    /// `secs` of a ±`amp` square wave (RMS = amp) — "speech" for the gate.
    fn tone(secs: f32, amp: f32) -> Vec<f32> {
        (0..(SR as f32 * secs) as usize)
            .map(|i| if (i / 40) % 2 == 0 { amp } else { -amp })
            .collect()
    }

    fn silence(secs: f32) -> Vec<f32> {
        vec![0.0; (SR as f32 * secs) as usize]
    }

    /// The default gate level, as `speech_span` takes it.
    fn gate() -> f32 {
        dbfs_to_amplitude(DEFAULT_SILENCE_DBFS)
    }

    /// The default gate, as `prepare_stt_audio` takes it (`None` = off).
    fn threshold() -> Option<f32> {
        Some(gate())
    }

    #[test]
    fn silence_threshold_with_request_env_wins_then_request_then_default() {
        let default = Some(dbfs_to_amplitude(DEFAULT_SILENCE_DBFS));
        assert_eq!(resolve_silence_threshold_with(None, None, None), default);
        // Settings: gate off → no gate; gate on with a level → that level.
        assert_eq!(resolve_silence_threshold_with(None, Some(false), Some(-40.0)), None);
        assert_eq!(
            resolve_silence_threshold_with(None, Some(true), Some(-40.0)),
            Some(dbfs_to_amplitude(-40.0))
        );
        // An invalid level falls back to the default level, gate still on.
        assert_eq!(resolve_silence_threshold_with(None, Some(true), Some(5.0)), default);
        assert_eq!(resolve_silence_threshold_with(None, Some(true), Some(f32::NAN)), default);
        // Env wins over the request: `off` disables, a level overrides.
        assert_eq!(resolve_silence_threshold_with(Some("off"), Some(true), Some(-40.0)), None);
        assert_eq!(
            resolve_silence_threshold_with(Some("-30"), Some(false), None),
            Some(dbfs_to_amplitude(-30.0))
        );
        // A blank env var is "unset".
        assert_eq!(resolve_silence_threshold_with(Some("  "), Some(false), None), None);
    }

    #[test]
    fn silence_threshold_env_parses_dbfs_off_and_falls_back_on_garbage() {
        let default = dbfs_to_amplitude(DEFAULT_SILENCE_DBFS);
        assert!((default - 0.00316).abs() < 1e-4);
        assert_eq!(resolve_silence_threshold(None), Some(default));
        assert_eq!(resolve_silence_threshold(Some("")), Some(default));
        assert_eq!(resolve_silence_threshold(Some("abc")), Some(default));
        assert_eq!(resolve_silence_threshold(Some("5")), Some(default)); // positive dBFS is nonsense
        assert_eq!(resolve_silence_threshold(Some("OFF")), None);
        assert!((resolve_silence_threshold(Some(" -40 ")).unwrap() - 0.01).abs() < 1e-6);
    }

    #[test]
    fn speech_span_is_none_for_digital_silence_and_for_noise_under_the_threshold() {
        assert_eq!(speech_span(&silence(3.0), SR, gate()), None);
        // −60 dBFS hiss: audible on a meter, but not speech.
        assert_eq!(speech_span(&tone(3.0, 0.001), SR, gate()), None);
        assert_eq!(speech_span(&[], SR, gate()), None);
    }

    #[test]
    fn speech_span_finds_the_speech_in_the_middle_and_pads_it() {
        let mut clip = silence(3.0);
        clip.extend(tone(1.0, 0.1)); // −20 dBFS, 3.0 s .. 4.0 s
        clip.extend(silence(3.0));

        let (start, end) = speech_span(&clip, SR, gate()).unwrap();
        // 200 ms of padding on each side of the 3.0–4.0 s activity.
        assert_eq!(start, 3 * SR as usize - 3200);
        assert_eq!(end, 4 * SR as usize + 3200);
    }

    #[test]
    fn speech_span_clamps_the_padding_to_the_clip() {
        let clip = tone(1.0, 0.1); // speech from the very first to the very last sample
        assert_eq!(speech_span(&clip, SR, gate()), Some((0, clip.len())));
    }

    #[test]
    fn speech_span_ignores_a_blip_shorter_than_min_speech() {
        let mut clip = silence(1.0);
        clip.extend(tone(0.1, 0.5)); // a 100 ms click
        clip.extend(silence(1.0));
        assert_eq!(speech_span(&clip, SR, gate()), None);
    }

    #[test]
    fn prepare_stt_audio_skips_silence_and_uploads_only_the_trimmed_speech() {
        assert_eq!(prepare_stt_audio(&silence(5.0), SR, 1, threshold()), None);

        let mut clip = silence(3.0);
        clip.extend(tone(1.0, 0.1));
        clip.extend(silence(3.0));
        let wav = prepare_stt_audio(&clip, SR, 1, threshold()).unwrap();
        // 44-byte header + 1.4 s (speech + 2 × 200 ms padding) of PCM16.
        let kept_samples = SR as usize + 2 * 3200;
        assert_eq!(wav.len(), 44 + kept_samples * 2);
    }

    #[test]
    fn prepare_stt_audio_with_the_gate_off_uploads_the_clip_as_recorded() {
        let mut clip = silence(3.0);
        clip.extend(tone(1.0, 0.1));
        clip.extend(silence(3.0));
        // Everything is kept (7 s) — even a clip of pure silence goes up.
        assert_eq!(prepare_stt_audio(&clip, SR, 1, None).unwrap().len(), 44 + clip.len() * 2);
        assert_eq!(prepare_stt_audio(&silence(1.0), SR, 1, None).unwrap().len(), 44 + SR as usize * 2);
        // Only an EMPTY capture has nothing to upload.
        assert_eq!(prepare_stt_audio(&[], SR, 1, None), None);
    }
}
