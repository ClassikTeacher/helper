//! Spike 9.0 (tasks.md фаза 9): де-риск WASAPI loopback-захвата устройства
//! ВЫВОДА через крейт `wasapi`. Throwaway-код в смысле «работает / не работает»,
//! но, в отличие от спайков scap/llm_stream, он гоняет РЕАЛЬНЫЙ прод-рекордер
//! (`WasapiLoopbackRecorder`) — тем самым проверяет ровно то, что попадёт в
//! команды `audio_start_capture`/`transcribe_audio`.
//!
//! Причина спайка: `cpal` (исходный план) не умеет loopback на Windows, поэтому
//! выбран `wasapi` (см. decisions.md ADR #14). Спайк подтверждает, что выбранный
//! путь реально снимает звук вывода, а не тишину.
//!
//! Запуск (из app/src-tauri):
//!   cargo run --example spike_audio_loopback
//! Во время 5-секундной записи ДОЛЖЕН играть звук на устройстве вывода
//! (музыка/видео/речь), иначе RMS будет близок к тишине.

use std::thread::sleep;
use std::time::Duration;

use ai_helper_lib::infra::audio::{
    downmix_to_mono, resample_linear, rms, samples_to_wav, STT_SAMPLE_RATE,
};
use ai_helper_lib::infra::wasapi_loopback::WasapiLoopbackRecorder;
use ai_helper_lib::ports::AudioRecorder;

const RECORD_SECS: u64 = 5;
/// Below this RMS we treat the capture as effectively silent.
const SILENCE_RMS: f32 = 1e-4;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== spike: WASAPI loopback capture ({RECORD_SECS}s) ===");
    println!("▶ Играйте звук на устройстве вывода (музыка/видео/речь) прямо сейчас...");

    let recorder = WasapiLoopbackRecorder::new();
    recorder.start()?;
    sleep(Duration::from_secs(RECORD_SECS));
    recorder.stop()?;

    let audio = recorder.take_audio()?;
    println!(
        "Формат устройства: {} Гц, {} канал(ов); захвачено сэмплов (interleaved): {}",
        audio.sample_rate,
        audio.channels,
        audio.samples.len()
    );

    if audio.samples.is_empty() {
        eprintln!("BLOCKER: не получено ни одного сэмпла — loopback не отдал данные.");
        std::process::exit(1);
    }

    let mono = downmix_to_mono(&audio.samples, audio.channels);
    let resampled = resample_linear(&mono, audio.sample_rate, STT_SAMPLE_RATE);
    let level = rms(&resampled);
    println!("RMS уровень (16 кГц моно): {level:.6}");

    // Write a WAV so the capture can be listened to manually.
    let wav = samples_to_wav(&audio.samples, audio.sample_rate, audio.channels);
    let out = std::env::temp_dir().join("spike_loopback.wav");
    std::fs::write(&out, &wav)?;
    println!("WAV записан: {} ({} байт)", out.display(), wav.len());

    if level < SILENCE_RMS {
        eprintln!("ВНИМАНИЕ: сигнал близок к тишине (RMS {level:.6}).");
        eprintln!("Если во время записи звук ТОЧНО играл — это блокер loopback; иначе перезапустите с играющим звуком.");
        std::process::exit(2);
    }

    println!("=== spike loopback: OK — есть сигнал, механизм loopback работает ===");
    Ok(())
}
