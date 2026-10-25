//! Text recognition (PaddleOCR CTC model): batch preparation and decoding.
//! Pure — the model run itself lives in `infra::ort_ocr`.

use super::imaging::Bgr;

/// Input height of the PP-OCR recognition models.
pub const REC_HEIGHT: usize = 48;
/// Narrowest batch width (PaddleOCR's `rec_img_shape` 3×48×320).
const MIN_WIDTH: usize = 320;

/// The label list of a recognition model: index 0 is the CTC blank, then the
/// model's dictionary, then a space (PaddleOCR's `use_space_char`).
#[derive(Debug, Clone)]
pub struct Dictionary {
    labels: Vec<String>,
}

impl Dictionary {
    /// From the dictionary text: one symbol per line (the file shipped with
    /// the model, or the `character` metadata RapidOCR embeds in the model).
    pub fn from_text(text: &str) -> Self {
        let mut labels = vec![String::new()];
        labels.extend(text.lines().map(|l| l.trim_end_matches('\r').to_string()));
        // A trailing newline in the file must not add an empty symbol.
        if labels.len() > 1 && labels.last().is_some_and(String::is_empty) {
            labels.pop();
        }
        labels.push(" ".to_string());
        Dictionary { labels }
    }

    pub fn len(&self) -> usize {
        self.labels.len()
    }
}

/// One recognized line: text and mean per-character confidence.
#[derive(Debug, Clone, PartialEq)]
pub struct Recognized {
    pub text: String,
    pub confidence: f32,
}

/// The batch input for `crops`: every crop scaled to `REC_HEIGHT` keeping its
/// aspect ratio, left-aligned and zero-padded to the widest one. Returns the
/// NCHW data and the batch width.
pub fn batch_tensor(crops: &[&Bgr]) -> (Vec<f32>, usize) {
    let width_for = |c: &Bgr| ((REC_HEIGHT as f32 * c.width as f32 / c.height.max(1) as f32).ceil() as usize).max(1);
    let batch_width = crops.iter().map(|c| width_for(c)).max().unwrap_or(MIN_WIDTH).max(MIN_WIDTH);
    let per_image = 3 * REC_HEIGHT * batch_width;
    let mut out = vec![0.0f32; per_image * crops.len()];
    for (i, crop) in crops.iter().enumerate() {
        let resized = crop.resize(width_for(crop).min(batch_width), REC_HEIGHT);
        resized.write_normalized_chw(&mut out[i * per_image..(i + 1) * per_image], batch_width);
    }
    (out, batch_width)
}

/// Greedy CTC decoding of one sequence of per-step class probabilities
/// (`steps × classes`, row-major): take the best class per step, collapse
/// repeats, drop blanks. Confidence is the mean probability of the kept steps.
pub fn ctc_decode(probs: &[f32], classes: usize, dict: &Dictionary) -> Recognized {
    let mut text = String::new();
    let mut confidences = Vec::new();
    let mut previous = usize::MAX;
    for step in probs.chunks_exact(classes) {
        let (best, p) = step
            .iter()
            .enumerate()
            .fold((0, f32::MIN), |acc, (i, &p)| if p > acc.1 { (i, p) } else { acc });
        if best != 0 && best != previous {
            if let Some(label) = dict.labels.get(best) {
                text.push_str(label);
                confidences.push(p);
            }
        }
        previous = best;
    }
    let confidence = if confidences.is_empty() {
        0.0
    } else {
        confidences.iter().sum::<f32>() / confidences.len() as f32
    };
    Recognized { text, confidence }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dictionary_adds_blank_first_and_space_last() {
        let d = Dictionary::from_text("a\nb\r\nc\n");
        assert_eq!(d.labels, vec!["", "a", "b", "c", " "]);
        assert_eq!(d.len(), 5);
    }

    /// One-hot probability rows for the given class indices.
    fn steps(indices: &[usize], classes: usize) -> Vec<f32> {
        indices
            .iter()
            .flat_map(|&i| (0..classes).map(move |c| if c == i { 0.9 } else { 0.1 / classes as f32 }))
            .collect()
    }

    #[test]
    fn ctc_collapses_repeats_and_drops_blanks() {
        let d = Dictionary::from_text("a\nb\nl");
        // a a _ b _ b l l _ (space) → "abbl "
        let probs = steps(&[1, 1, 0, 2, 0, 2, 3, 3, 0, 4], d.len());
        let r = ctc_decode(&probs, d.len(), &d);
        assert_eq!(r.text, "abbl ");
        assert!((r.confidence - 0.9).abs() < 1e-6);
    }

    #[test]
    fn ctc_of_all_blanks_is_empty_with_zero_confidence() {
        let d = Dictionary::from_text("a");
        let r = ctc_decode(&steps(&[0, 0, 0], d.len()), d.len(), &d);
        assert_eq!(r, Recognized { text: String::new(), confidence: 0.0 });
    }

    #[test]
    fn batch_is_padded_to_the_widest_crop_at_rec_height() {
        let narrow = Bgr { width: 10, height: 10, data: vec![255; 300] };
        let wide = Bgr { width: 100, height: 10, data: vec![255; 3000] };
        let (data, width) = batch_tensor(&[&narrow, &wide]);
        assert_eq!(width, 480); // 48 * 100 / 10
        assert_eq!(data.len(), 2 * 3 * REC_HEIGHT * 480);
        // The narrow crop fills 48 columns, the rest of its row is padding.
        assert_eq!(data[47], 1.0);
        assert_eq!(data[48], 0.0);
    }
}
