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

/// Full pipeline: raw interleaved `f32` capture -> 16 kHz mono PCM16 WAV bytes,
/// ready to POST to the STT endpoint. Used by `commands::audio::transcribe_audio`
/// and the phase-9 spike.
pub fn samples_to_wav(interleaved: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let mono = downmix_to_mono(interleaved, channels);
    let resampled = resample_linear(&mono, sample_rate, STT_SAMPLE_RATE);
    let pcm = f32_to_pcm16(&resampled);
    encode_wav_pcm16_mono(&pcm, STT_SAMPLE_RATE)
}

/// Root-mean-square amplitude of a signal — a cheap "is this silence?" check
/// used by the phase-9 spike to confirm loopback actually captured sound.
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
}
