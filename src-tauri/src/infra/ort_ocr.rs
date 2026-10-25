//! Local OCR engine (phase 6): PaddleOCR (PP-OCR) detection + recognition run
//! through ONNX Runtime. The pure pre/post-processing lives in `infra::ocr`;
//! this file owns the files, the sessions and the model runs.
//!
//! Nothing is bundled: `onnxruntime.dll` and the models are fetched once by
//! `pnpm ocr:fetch` into the OCR folder (see `ocr_dir`) and loaded lazily on
//! the first request (`ort` `load-dynamic`). Until then the engine reports
//! itself unavailable and the webview falls back to screenshots only.
//!
//! Recognition uses two models: the main PP-OCR one (Latin, digits, code
//! symbols) and, when installed, an East-Slavic one for Cyrillic. Every line
//! is read by both and the more confident reading wins.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;
use ort::environment::Environment;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;

use crate::dto::{CaptureRegion, OcrBox, OcrRequest, OcrResult};
use crate::infra::image::decode_png_rgba;
use crate::infra::ocr::det::{self, DetParams};
use crate::infra::ocr::imaging::{Bgr, Rect};
use crate::infra::ocr::layout::{gutter_probes, layout_text, Word};
use crate::infra::ocr::rec::{self, Dictionary, Recognized};
use crate::ports::{OcrEngine, OcrStatus};

/// Files of the OCR folder (written by `scripts/fetch-ocr.mjs`). The
/// dictionaries are optional: RapidOCR's models carry theirs in the model
/// metadata.
const RUNTIME_DLL: &str = "onnxruntime.dll";
const DET_MODEL: &str = "det.onnx";
const REC_MODEL: &str = "rec.onnx";
const REC_DICT: &str = "rec_dict.txt";
const CYRILLIC_MODEL: &str = "rec_cyrillic.onnx";
const CYRILLIC_DICT: &str = "rec_cyrillic_dict.txt";

/// Lines read below this confidence are dropped (RapidOCR `text_score`).
const MIN_CONFIDENCE: f32 = 0.5;
/// Crops per recognition run (RapidOCR `rec_batch_num`).
const REC_BATCH: usize = 6;
/// Width, in characters, of a probe strip (`layout::gutter_probes`).
const PROBE_COLUMNS: usize = 40;

/// The OCR folder: `AI_HELPER_OCR_DIR` when set; otherwise `ocr` next to the
/// executable when it exists (a bundled build); otherwise the app's local data
/// folder, `%LOCALAPPDATA%\com.aihelper.app\ocr` — where `pnpm ocr:fetch`
/// puts the files by default.
pub fn ocr_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("AI_HELPER_OCR_DIR").filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(bundled) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("ocr")))
        .filter(|p| p.join(DET_MODEL).exists())
    {
        return bundled;
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local").join("share")))
        .unwrap_or_default();
    base.join("com.aihelper.app").join("ocr")
}

struct RecModel {
    session: Session,
    dict: Dictionary,
}

struct Models {
    det: Session,
    rec: RecModel,
    cyrillic: Option<RecModel>,
}

pub struct OrtOcr {
    dir: PathBuf,
    /// Loaded on first use; a failed load is retried on the next request (the
    /// user may fetch the models while the app runs).
    models: Mutex<Option<Models>>,
}

/// ONNX Runtime allows one environment per process; it outlives every retry.
static ENVIRONMENT: OnceLock<Environment> = OnceLock::new();

impl OrtOcr {
    pub fn new() -> Self {
        Self::with_dir(ocr_dir())
    }

    pub fn with_dir(dir: PathBuf) -> Self {
        OrtOcr { dir, models: Mutex::new(None) }
    }

    fn missing_files(&self) -> Vec<&'static str> {
        [RUNTIME_DLL, DET_MODEL, REC_MODEL]
            .into_iter()
            .filter(|f| !self.dir.join(f).exists())
            .collect()
    }

    fn load(&self) -> Result<Models, String> {
        let missing = self.missing_files();
        if !missing.is_empty() {
            return Err(format!(
                "локальный OCR не установлен: нет {} в {} — выполните `pnpm ocr:fetch`",
                missing.join(", "),
                self.dir.display()
            ));
        }
        let env = environment(&self.dir.join(RUNTIME_DLL))?;
        let det = session(env, &self.dir.join(DET_MODEL))?;
        let rec = rec_model(env, &self.dir.join(REC_MODEL), &self.dir.join(REC_DICT))?;
        // Optional: a broken Cyrillic model must not take the main OCR down.
        let cyrillic = if self.dir.join(CYRILLIC_MODEL).exists() {
            rec_model(env, &self.dir.join(CYRILLIC_MODEL), &self.dir.join(CYRILLIC_DICT))
                .map_err(|e| eprintln!("{e} — continuing without Cyrillic"))
                .ok()
        } else {
            None
        };
        Ok(Models { det, rec, cyrillic })
    }

    fn with_models<T>(&self, f: impl FnOnce(&mut Models) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.models.lock().map_err(|_| "OCR state poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(self.load()?);
        }
        f(guard.as_mut().expect("models just loaded"))
    }
}

impl Default for OrtOcr {
    fn default() -> Self {
        Self::new()
    }
}

impl OcrEngine for OrtOcr {
    fn recognize(&self, request: &OcrRequest) -> Result<OcrResult, String> {
        let png = base64::engine::general_purpose::STANDARD
            .decode(&request.image_base64)
            .map_err(|e| format!("OCR: bad base64 image: {e}"))?;
        let (w, h, rgba) = decode_png_rgba(&png)?;
        let image = Bgr::from_rgba(w as usize, h as usize, &rgba);
        // `languages` narrows the scripts; Cyrillic is on unless excluded.
        let cyrillic = request
            .languages
            .as_ref()
            .map_or(true, |langs| langs.iter().any(|l| l.starts_with("ru") || l == "cyrillic"));
        self.with_models(|models| run_pipeline(models, &image, cyrillic))
    }

    fn status(&self) -> OcrStatus {
        let missing = self.missing_files();
        OcrStatus {
            available: missing.is_empty(),
            cyrillic: self.dir.join(CYRILLIC_MODEL).exists(),
            dir: self.dir.display().to_string(),
            detail: if missing.is_empty() {
                None
            } else {
                Some(format!("нет файлов: {}", missing.join(", ")))
            },
        }
    }
}

fn environment(dll: &Path) -> Result<&'static Environment, String> {
    if let Some(env) = ENVIRONMENT.get() {
        return Ok(env);
    }
    let env = ort::init_from(dll)
        .map_err(|e| format!("OCR: не удалось загрузить {}: {e}", dll.display()))?
        .with_name("ai-helper-ocr")
        .build()
        .map_err(|e| format!("OCR: ONNX Runtime: {e}"))?;
    Ok(ENVIRONMENT.get_or_init(|| env))
}

fn session(env: &Environment, model: &Path) -> Result<Session, String> {
    let fail = |e: &dyn std::fmt::Display| format!("OCR: модель {}: {e}", model.display());
    Session::builder(env)
        .map_err(|e| fail(&e))?
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|e| fail(&e))?
        .commit_from_file(model)
        .map_err(|e| fail(&e))
}

/// A recognition model with its dictionary: the `.txt` next to it, or the
/// `character` metadata RapidOCR embeds in its models.
fn rec_model(env: &Environment, model: &Path, dict_file: &Path) -> Result<RecModel, String> {
    let session = session(env, model)?;
    let text = match std::fs::read_to_string(dict_file) {
        Ok(text) => text,
        Err(_) => session
            .metadata()
            .ok()
            .and_then(|m| m.custom("character"))
            .ok_or_else(|| format!("OCR: нет словаря {} для {}", dict_file.display(), model.display()))?,
    };
    Ok(RecModel { session, dict: Dictionary::from_text(&text) })
}

fn run_pipeline(models: &mut Models, image: &Bgr, cyrillic: bool) -> Result<OcrResult, String> {
    let regions = detect(&mut models.det, image)?;
    let crops: Vec<Bgr> = regions.iter().map(|r| image.crop(r.rect)).collect();
    let mut readings = recognize(&mut models.rec, &crops)?;

    // The main model reads Cyrillic as confident Latin look-alikes
    // ("Bonpoc Ha" for «Вопрос на»), so a low score cannot flag those lines:
    // with the Cyrillic model installed, every line is read by both and the
    // more confident reading wins.
    if let (true, Some(cyr)) = (cyrillic, models.cyrillic.as_mut()) {
        for (reading, second) in readings.iter_mut().zip(recognize(cyr, &crops)?) {
            if second.confidence > reading.confidence {
                *reading = second;
            }
        }
    }

    let mut words: Vec<(Rect, Recognized)> = regions
        .iter()
        .zip(readings)
        .filter(|(_, r)| r.confidence >= MIN_CONFIDENCE && !r.text.trim().is_empty())
        .map(|(region, r)| (region.core, r))
        .collect();

    // Lone `}` / `)` lines the detector missed: look for ink in the empty
    // numbered rows and read just that.
    let found: Vec<Word> = words.iter().map(|(rect, r)| Word { rect: *rect, text: r.text.clone() }).collect();
    // (crop to read, x where the glyph's ink starts — its column)
    let glyphs: Vec<(Rect, usize)> = gutter_probes(&found, image.width, PROBE_COLUMNS)
        .into_iter()
        .filter_map(|probe| {
            let ink = image.crop(probe).ink_bounds()?;
            // Pad like the detector's unclip, within the strip.
            let pad = probe.height() / 3;
            let crop = Rect {
                x0: (probe.x0 + ink.x0).saturating_sub(pad),
                y0: probe.y0,
                x1: (probe.x0 + ink.x1 + pad).min(image.width),
                y1: probe.y1,
            };
            Some((crop, probe.x0 + ink.x0))
        })
        .collect();
    if !glyphs.is_empty() {
        let crops: Vec<Bgr> = glyphs.iter().map(|&(crop, _)| image.crop(crop)).collect();
        for ((crop, ink_x0), r) in glyphs.into_iter().zip(recognize(&mut models.rec, &crops)?) {
            if r.confidence >= MIN_CONFIDENCE && !r.text.trim().is_empty() {
                let core = Rect { x0: ink_x0, ..crop };
                words.push((core, Recognized { text: r.text.trim().to_string(), ..r }));
            }
        }
    }
    let layout: Vec<Word> = words.iter().map(|(rect, r)| Word { rect: *rect, text: r.text.clone() }).collect();
    Ok(OcrResult {
        full_text: layout_text(&layout),
        boxes: words
            .into_iter()
            .map(|(rect, r)| OcrBox {
                text: r.text,
                confidence: r.confidence,
                box_region: CaptureRegion {
                    x: rect.x0 as u32,
                    y: rect.y0 as u32,
                    width: rect.width() as u32,
                    height: rect.height() as u32,
                },
            })
            .collect(),
    })
}

fn detect(session: &mut Session, image: &Bgr) -> Result<Vec<det::TextRegion>, String> {
    let params = DetParams::default();
    let (w, h) = det::input_size(image.width, image.height, &params);
    let input = Tensor::from_array(([1usize, 3, h, w], det::input_tensor(image, w, h)))
        .map_err(|e| format!("OCR det input: {e}"))?;
    let outputs = session.run(ort::inputs![input]).map_err(|e| format!("OCR det: {e}"))?;
    let (shape, prob) = outputs[0].try_extract_tensor::<f32>().map_err(|e| format!("OCR det output: {e}"))?;
    // [1, 1, H, W]
    let (map_h, map_w) = (shape[2] as usize, shape[3] as usize);
    Ok(det::regions_from_map(prob, map_w, map_h, image.width, image.height, &params))
}

/// Reads every crop, batching crops of similar aspect ratio (less padding).
fn recognize(model: &mut RecModel, crops: &[Bgr]) -> Result<Vec<Recognized>, String> {
    let mut order: Vec<usize> = (0..crops.len()).collect();
    order.sort_by(|&a, &b| ratio(&crops[a]).total_cmp(&ratio(&crops[b])));
    let mut out = vec![Recognized { text: String::new(), confidence: 0.0 }; crops.len()];
    for chunk in order.chunks(REC_BATCH) {
        let batch: Vec<&Bgr> = chunk.iter().map(|&i| &crops[i]).collect();
        let (data, width) = rec::batch_tensor(&batch);
        let input = Tensor::from_array(([batch.len(), 3, rec::REC_HEIGHT, width], data))
            .map_err(|e| format!("OCR rec input: {e}"))?;
        let outputs = model.session.run(ort::inputs![input]).map_err(|e| format!("OCR rec: {e}"))?;
        let (shape, probs) = outputs[0].try_extract_tensor::<f32>().map_err(|e| format!("OCR rec output: {e}"))?;
        // [N, steps, classes]
        let (steps, classes) = (shape[1] as usize, shape[2] as usize);
        for (k, &i) in chunk.iter().enumerate() {
            let seq = &probs[k * steps * classes..(k + 1) * steps * classes];
            out[i] = rec::ctc_decode(seq, classes, &model.dict);
        }
    }
    Ok(out)
}

fn ratio(img: &Bgr) -> f32 {
    img.width as f32 / img.height.max(1) as f32
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_install_is_reported_not_panicked() {
        let ocr = OrtOcr::with_dir(PathBuf::from("Z:/definitely/not/here"));
        let status = ocr.status();
        assert!(!status.available);
        assert!(status.detail.unwrap().contains(DET_MODEL));
        let err = ocr
            .recognize(&OcrRequest { image_base64: String::new(), languages: None })
            .unwrap_err();
        // Empty base64 decodes to empty bytes → PNG error, before any model use.
        assert!(err.contains("png"), "{err}");
    }


    /// Real-model check (needs the OCR folder): set `OCR_CHECK_DIR` and
    /// `OCR_CHECK_IMAGES` (paths separated by `;`), then
    /// `cargo test --lib ocr_on_real_images -- --ignored --nocapture`.
    /// Same as `examples/ocr_check.rs`, for toolchains that cannot link the
    /// example (mingw: "export ordinal too large" on the cdylib).
    #[test]
    #[ignore]
    fn ocr_on_real_images() {
        let dir = std::env::var("OCR_CHECK_DIR").expect("OCR_CHECK_DIR");
        let images = std::env::var("OCR_CHECK_IMAGES").expect("OCR_CHECK_IMAGES");
        let ocr = OrtOcr::with_dir(PathBuf::from(dir));
        println!("status: {:?}", ocr.status());
        for path in images.split(';').filter(|p| !p.is_empty()) {
            let png = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
            let request = OcrRequest {
                image_base64: base64::engine::general_purpose::STANDARD.encode(png),
                languages: None,
            };
            let started = std::time::Instant::now();
            let result = ocr.recognize(&request).unwrap_or_else(|e| panic!("{path}: {e}"));
            println!(
                "=== {path}: {} boxes, {:.0} ms\n{}\n=== end",
                result.boxes.len(),
                started.elapsed().as_secs_f64() * 1000.0,
                result.full_text
            );
        }
    }
}
