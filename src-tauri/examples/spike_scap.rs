//! Spike (Фаза 0.5, tasks.md): де-риск `scap` на текущей Windows-конфигурации.
//!
//! Throwaway-код: цель — ответить «работает / не работает» на текущей машине
//! (DPI-масштаб, мульти-монитор), а не стать частью прод-пути. Прод-реализация
//! `ScreenCapturer` появится в фазе 1 (`src/infra/scap_capturer.rs`).
//!
//! Запуск: `cargo run --example spike_scap` из `app/src-tauri`.
//! Результат: лог в консоль + `spike_scap_output.bmp` рядом с бинарником —
//! открыть глазами и проверить, что скриншот реального экрана, без искажений
//! от DPI-масштабирования или обрезки на неверном мониторе.
//!
//! ВАЖНО: используется патченная vendor-копия `scap` (см. `vendor/scap/NOTES.md`)
//! — опубликованный на crates.io крейт не компилируется на Windows против
//! актуальной `windows-capture` 1.5.0 (upstream issue #180, не исправлен).

use scap::{
    capturer::{Capturer, Options, Resolution},
    frame::{Frame, FrameType, VideoFrame},
    get_all_targets, get_main_display, has_permission, is_supported, request_permission, Target,
};
use std::fs::File;
use std::io::Write;

fn main() {
    println!("=== spike: scap screen capture ===");

    if !is_supported() {
        eprintln!("BLOCKER: scap::is_supported() == false — платформа не поддерживается сборкой scap");
        std::process::exit(1);
    }
    println!("is_supported: OK");

    if !has_permission() {
        println!("permission not granted yet, requesting...");
        if !request_permission() {
            eprintln!("BLOCKER: request_permission() отклонён пользователем/ОС");
            std::process::exit(1);
        }
    }
    println!("has_permission: OK");

    let targets = get_all_targets();
    println!("targets найдено: {}", targets.len());
    for t in &targets {
        match t {
            Target::Display(d) => println!("  Display id={} title={:?}", d.id, d.title),
            Target::Window(w) => println!("  Window  id={} title={:?}", w.id, w.title),
        }
    }

    let main_display = get_main_display();
    println!(
        "main display: id={} title={:?} (сверить width/height захваченного кадра ниже с реальным разрешением этого монитора — расхождение означает DPI-масштабирование)",
        main_display.id, main_display.title
    );

    let options = Options {
        fps: 1,
        target: None, // None => основной дисплей
        show_cursor: true,
        show_highlight: false,
        output_type: FrameType::BGRAFrame,
        output_resolution: Resolution::Captured, // без ресемплинга — сырые пиксели
        ..Default::default()
    };

    let mut capturer = match Capturer::build(options) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("BLOCKER: Capturer::build() failed: {e}");
            std::process::exit(1);
        }
    };

    capturer.start_capture();
    let frame_result = capturer.get_next_frame();
    capturer.stop_capture();

    match frame_result {
        Ok(Frame::Video(VideoFrame::BGRA(f))) => {
            let expected_bytes = (f.width as usize) * (f.height as usize) * 4;
            println!(
                "OK: захвачен кадр {}x{}, {} байт (ожидалось {})",
                f.width,
                f.height,
                f.data.len(),
                expected_bytes
            );
            if f.data.len() != expected_bytes {
                println!("ВНИМАНИЕ: фактический размер данных не совпадает с width*height*4 — возможен неучтённый stride/padding");
            }
            match write_bmp("spike_scap_output.bmp", f.width as u32, f.height as u32, &f.data) {
                Ok(()) => println!(
                    "Записан spike_scap_output.bmp — открыть глазами и свериться с реальным экраном (DPI/мульти-монитор)"
                ),
                Err(e) => eprintln!("Не удалось записать BMP: {e}"),
            }
        }
        Ok(_) => {
            eprintln!("BLOCKER: пришёл кадр не в ожидаемом формате BGRA (проверить output_type)");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("BLOCKER: get_next_frame() failed: {e:?}");
            std::process::exit(1);
        }
    }
}

/// Минимальный BMP-writer для 32bpp BGRA без внешних зависимостей (throwaway).
/// Использует top-down BMP (отрицательная высота в заголовке) — данные scap
/// уже в порядке строк сверху вниз и в порядке байт B,G,R,A, что совпадает
/// с раскладкой 32bpp BI_RGB в BMP, поэтому пиксели пишутся как есть.
fn write_bmp(path: &str, width: u32, height: u32, bgra: &[u8]) -> std::io::Result<()> {
    let pixel_data_size = bgra.len() as u32;
    let file_header_size: u32 = 14;
    let info_header_size: u32 = 40;
    let data_offset = file_header_size + info_header_size;
    let file_size = data_offset + pixel_data_size;

    let mut buf = Vec::with_capacity(file_size as usize);

    // BITMAPFILEHEADER
    buf.extend_from_slice(b"BM");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(&0u16.to_le_bytes()); // reserved1
    buf.extend_from_slice(&0u16.to_le_bytes()); // reserved2
    buf.extend_from_slice(&data_offset.to_le_bytes());

    // BITMAPINFOHEADER
    buf.extend_from_slice(&info_header_size.to_le_bytes());
    buf.extend_from_slice(&(width as i32).to_le_bytes());
    buf.extend_from_slice(&(-(height as i64) as i32).to_le_bytes()); // negative = top-down
    buf.extend_from_slice(&1u16.to_le_bytes()); // planes
    buf.extend_from_slice(&32u16.to_le_bytes()); // bpp
    buf.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB, no compression
    buf.extend_from_slice(&pixel_data_size.to_le_bytes());
    buf.extend_from_slice(&2835i32.to_le_bytes()); // x ppm (~72 dpi)
    buf.extend_from_slice(&2835i32.to_le_bytes()); // y ppm
    buf.extend_from_slice(&0u32.to_le_bytes()); // colors used
    buf.extend_from_slice(&0u32.to_le_bytes()); // important colors

    buf.extend_from_slice(bgra);

    let mut file = File::create(path)?;
    file.write_all(&buf)
}
