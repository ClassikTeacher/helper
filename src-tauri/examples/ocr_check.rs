//! Runs the local OCR on PNG files and prints the recognized text — a manual
//! check of the phase-6 pipeline with real models (not a unit test: it needs
//! the OCR folder from `pnpm ocr:fetch`).
//!
//!   cargo run --example ocr_check -- [--dir <ocr folder>] <image.png>...
//!
//! Without `--dir`, the folder the app uses (`AI_HELPER_OCR_DIR` or
//! `%LOCALAPPDATA%\com.aihelper.app\ocr`).

use std::path::PathBuf;
use std::time::Instant;

use ai_helper_lib::dto::OcrRequest;
use ai_helper_lib::infra::ort_ocr::{ocr_dir, OrtOcr};
use ai_helper_lib::ports::OcrEngine;
use base64::Engine as _;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let dir = match args.iter().position(|a| a == "--dir") {
        Some(i) => {
            let dir = PathBuf::from(args.get(i + 1).expect("--dir needs a path"));
            args.drain(i..=i + 1);
            dir
        }
        None => ocr_dir(),
    };
    let ocr = OrtOcr::with_dir(dir);
    println!("status: {:?}", ocr.status());

    for path in args {
        let png = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let request = OcrRequest {
            image_base64: base64::engine::general_purpose::STANDARD.encode(png),
            languages: None,
        };
        let started = Instant::now();
        match ocr.recognize(&request) {
            Ok(result) => {
                println!(
                    "=== {path}: {} boxes, {:.0} ms\n{}\n=== end",
                    result.boxes.len(),
                    started.elapsed().as_secs_f64() * 1000.0,
                    result.full_text
                );
            }
            Err(e) => println!("=== {path}: ERROR {e}"),
        }
    }
}
