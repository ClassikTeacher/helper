//! Text detection (PaddleOCR DB model): input preparation and the
//! probability-map post-processing. Pure — the model run itself lives in
//! `infra::ort_ocr`.
//!
//! Screens carry horizontal text only, so boxes are axis-aligned rectangles
//! (connected components of the thresholded map) rather than the rotated
//! quadrilaterals generic PaddleOCR produces — no contour tracing or polygon
//! clipping needed.

use super::imaging::{Bgr, Rect};

/// Detection parameters (RapidOCR / PaddleOCR defaults unless noted).
#[derive(Debug, Clone, Copy)]
pub struct DetParams {
    /// The SHORT side is scaled up to at least this (`limit_type: min`).
    pub min_side: usize,
    /// …but the LONG side never exceeds this (cost cap; small code fonts need
    /// resolution, so it is generous).
    pub max_side: usize,
    /// Pixel probability threshold for the text mask.
    pub thresh: f32,
    /// Minimum mean probability of a box.
    pub box_thresh: f32,
    /// How far a box is grown back out (DB shrinks text regions in training).
    pub unclip_ratio: f32,
}

impl Default for DetParams {
    fn default() -> Self {
        DetParams { min_side: 736, max_side: 2560, thresh: 0.3, box_thresh: 0.5, unclip_ratio: 1.6 }
    }
}

/// A detected text region in SOURCE image pixels, with its mean probability.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextRegion {
    /// Grown back out ("unclipped") — what the recognizer reads.
    pub rect: Rect,
    /// The detected core, before growing: its edges track the glyphs, so the
    /// layout uses it for columns (the growth depends on the box size and
    /// would make indentation jitter).
    pub core: Rect,
    pub score: f32,
}

/// Model input size for a `width × height` image: short side up to
/// `min_side`, long side capped at `max_side`, both rounded to multiples of 32.
pub fn input_size(width: usize, height: usize, params: &DetParams) -> (usize, usize) {
    let (short, long) = (width.min(height) as f32, width.max(height) as f32);
    let mut ratio = if short < params.min_side as f32 { params.min_side as f32 / short } else { 1.0 };
    if long * ratio > params.max_side as f32 {
        ratio = params.max_side as f32 / long;
    }
    let round32 = |v: f32| (((v / 32.0).round() as usize) * 32).max(32);
    (round32(width as f32 * ratio), round32(height as f32 * ratio))
}

/// The detector's NCHW input for `image` resized to `(width, height)`.
pub fn input_tensor(image: &Bgr, width: usize, height: usize) -> Vec<f32> {
    let resized = image.resize(width, height);
    let mut out = vec![0.0f32; 3 * width * height];
    resized.write_normalized_chw(&mut out, width);
    out
}

/// Turns the `map_w × map_h` probability map into text regions in source
/// coordinates (`src_w × src_h`).
pub fn regions_from_map(
    prob: &[f32],
    map_w: usize,
    map_h: usize,
    src_w: usize,
    src_h: usize,
    params: &DetParams,
) -> Vec<TextRegion> {
    const MIN_SIZE: f32 = 3.0;
    let mask = dilate_2x2(&threshold(prob, params.thresh), map_w, map_h);
    let sx = src_w as f32 / map_w as f32;
    let sy = src_h as f32 / map_h as f32;

    let mut regions = Vec::new();
    for c in components(&mask, map_w, map_h) {
        let (w, h) = ((c.x1 - c.x0) as f32, (c.y1 - c.y0) as f32);
        if w.min(h) < MIN_SIZE {
            continue;
        }
        let score = mean_in_rect(prob, map_w, c);
        if score < params.box_thresh {
            continue;
        }
        // DB "unclip": grow by area * ratio / perimeter on every side.
        let d = w * h * params.unclip_ratio / (2.0 * (w + h));
        if (w + 2.0 * d).min(h + 2.0 * d) < MIN_SIZE + 2.0 {
            continue;
        }
        let clamp = |v: f32, max: usize| v.round().clamp(0.0, max as f32) as usize;
        let core = Rect {
            x0: clamp(c.x0 as f32 * sx, src_w),
            y0: clamp(c.y0 as f32 * sy, src_h),
            x1: clamp(c.x1 as f32 * sx, src_w),
            y1: clamp(c.y1 as f32 * sy, src_h),
        };
        let rect = Rect {
            x0: clamp((c.x0 as f32 - d) * sx, src_w),
            y0: clamp((c.y0 as f32 - d) * sy, src_h),
            x1: clamp((c.x1 as f32 + d) * sx, src_w),
            y1: clamp((c.y1 as f32 + d) * sy, src_h),
        };
        if rect.width() > 3 && rect.height() > 3 {
            regions.push(TextRegion { rect, core, score });
        }
    }
    regions
}

fn threshold(prob: &[f32], thresh: f32) -> Vec<bool> {
    prob.iter().map(|&p| p > thresh).collect()
}

/// OpenCV `dilate` with a 2×2 kernel (anchor at its center = bottom-right
/// cell): a pixel is set when it or its left/top/top-left neighbour is.
fn dilate_2x2(mask: &[bool], w: usize, h: usize) -> Vec<bool> {
    let mut out = vec![false; mask.len()];
    for y in 0..h {
        for x in 0..w {
            let at = |xx: usize, yy: usize| mask[yy * w + xx];
            out[y * w + x] = at(x, y)
                || (x > 0 && at(x - 1, y))
                || (y > 0 && at(x, y - 1))
                || (x > 0 && y > 0 && at(x - 1, y - 1));
        }
    }
    out
}

/// Bounding rectangles of the 8-connected components of `mask`.
fn components(mask: &[bool], w: usize, h: usize) -> Vec<Rect> {
    let mut seen = vec![false; mask.len()];
    let mut rects = Vec::new();
    let mut stack = Vec::new();
    for start in 0..mask.len() {
        if !mask[start] || seen[start] {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let mut r = Rect { x0: usize::MAX, y0: usize::MAX, x1: 0, y1: 0 };
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            r.x0 = r.x0.min(x);
            r.y0 = r.y0.min(y);
            r.x1 = r.x1.max(x + 1);
            r.y1 = r.y1.max(y + 1);
            for dy in -1i64..=1 {
                for dx in -1i64..=1 {
                    let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i64 || ny >= h as i64 {
                        continue;
                    }
                    let n = ny as usize * w + nx as usize;
                    if mask[n] && !seen[n] {
                        seen[n] = true;
                        stack.push(n);
                    }
                }
            }
        }
        rects.push(r);
    }
    rects
}

fn mean_in_rect(prob: &[f32], w: usize, r: Rect) -> f32 {
    let mut sum = 0.0f32;
    for y in r.y0..r.y1 {
        sum += prob[y * w + r.x0..y * w + r.x1].iter().sum::<f32>();
    }
    sum / (r.width() * r.height()) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_size_scales_the_short_side_up_caps_the_long_side_and_rounds_to_32() {
        let p = DetParams::default();
        // A 2560×1440 screen already exceeds the short-side minimum: kept as is.
        assert_eq!(input_size(2560, 1440, &p), (2560, 1440));
        // A small crop is scaled up so its short side reaches 736.
        assert_eq!(input_size(400, 200, &p), (1472, 736));
        // A very wide strip hits the long-side cap first.
        assert_eq!(input_size(4000, 100, &p), (2560, 64));
    }

    /// A map with two filled blocks on a 20×10 grid.
    fn two_blocks() -> Vec<f32> {
        let mut prob = vec![0.0f32; 20 * 10];
        for y in 2..6 {
            for x in 1..8 {
                prob[y * 20 + x] = 0.9;
            }
            for x in 12..18 {
                prob[y * 20 + x] = 0.8;
            }
        }
        prob
    }

    #[test]
    fn regions_are_the_separate_blocks_grown_back_and_scaled_to_the_source() {
        let p = DetParams::default();
        let regions = regions_from_map(&two_blocks(), 20, 10, 40, 20, &p);
        assert_eq!(regions.len(), 2);
        let first = regions.iter().find(|r| r.rect.x0 < 10).unwrap();
        // Component (after the 2×2 dilation) x 1..9, y 2..7; grown by ~1.5 px; ×2.
        assert!(first.rect.x0 <= 2 && first.rect.x1 >= 18, "{:?}", first.rect);
        assert!(first.rect.y0 <= 4 && first.rect.y1 >= 14, "{:?}", first.rect);
        assert!(first.score > 0.5);
        // The core is the component itself (x 1..9 after dilation), scaled.
        assert_eq!((first.core.x0, first.core.x1), (2, 18));
    }

    #[test]
    fn weak_and_tiny_blobs_are_dropped() {
        let p = DetParams::default();
        let mut prob = vec![0.0f32; 20 * 10];
        // A 1-pixel speck.
        prob[5 * 20 + 5] = 0.99;
        // A block barely over the pixel threshold but under box_thresh.
        for y in 1..5 {
            for x in 10..18 {
                prob[y * 20 + x] = 0.35;
            }
        }
        assert!(regions_from_map(&prob, 20, 10, 20, 10, &p).is_empty());
    }
}
