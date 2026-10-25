//! Pixel helpers for the OCR pipeline. Pure — no ONNX Runtime — so they are
//! unit-tested directly.

/// A tightly packed 8-bit BGR image. PaddleOCR models are trained on OpenCV's
/// BGR channel order, so the pipeline keeps that order end to end.
#[derive(Debug, Clone, PartialEq)]
pub struct Bgr {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

/// An axis-aligned pixel rectangle: `[x0, x1) × [y0, y1)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
}

impl Rect {
    pub fn width(&self) -> usize {
        self.x1 - self.x0
    }
    pub fn height(&self) -> usize {
        self.y1 - self.y0
    }
}

impl Bgr {
    /// Drops alpha and swaps R/B.
    pub fn from_rgba(width: usize, height: usize, rgba: &[u8]) -> Self {
        let data = rgba.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0]]).collect();
        Bgr { width, height, data }
    }

    /// The pixels inside `rect` (clamped to the image).
    pub fn crop(&self, rect: Rect) -> Bgr {
        let x0 = rect.x0.min(self.width);
        let x1 = rect.x1.clamp(x0, self.width);
        let y0 = rect.y0.min(self.height);
        let y1 = rect.y1.clamp(y0, self.height);
        let mut data = Vec::with_capacity((x1 - x0) * (y1 - y0) * 3);
        for y in y0..y1 {
            let row = (y * self.width) * 3;
            data.extend_from_slice(&self.data[row + x0 * 3..row + x1 * 3]);
        }
        Bgr { width: x1 - x0, height: y1 - y0, data }
    }

    /// Bilinear resize (pixel centers aligned, like OpenCV's INTER_LINEAR).
    pub fn resize(&self, width: usize, height: usize) -> Bgr {
        if width == self.width && height == self.height {
            return self.clone();
        }
        let mut data = vec![0u8; width * height * 3];
        if self.width == 0 || self.height == 0 {
            return Bgr { width, height, data };
        }
        let sx = self.width as f32 / width as f32;
        let sy = self.height as f32 / height as f32;
        let xs: Vec<(usize, usize, f32)> = (0..width)
            .map(|x| source_taps((x as f32 + 0.5) * sx - 0.5, self.width))
            .collect();
        for y in 0..height {
            let (y0, y1, fy) = source_taps((y as f32 + 0.5) * sy - 0.5, self.height);
            for (x, &(x0, x1, fx)) in xs.iter().enumerate() {
                for c in 0..3 {
                    let p = |xx: usize, yy: usize| self.data[(yy * self.width + xx) * 3 + c] as f32;
                    let top = p(x0, y0) * (1.0 - fx) + p(x1, y0) * fx;
                    let bottom = p(x0, y1) * (1.0 - fx) + p(x1, y1) * fx;
                    data[(y * width + x) * 3 + c] = (top * (1.0 - fy) + bottom * fy).round() as u8;
                }
            }
        }
        Bgr { width, height, data }
    }

    /// NCHW float tensor data for one image, normalized as PaddleOCR does:
    /// `(px / 255 - 0.5) / 0.5`, written into `out` (`3 × height × out_width`,
    /// zero-padded on the right when `out_width > self.width`).
    pub fn write_normalized_chw(&self, out: &mut [f32], out_width: usize) {
        let plane = self.height * out_width;
        debug_assert!(out.len() >= plane * 3);
        for y in 0..self.height {
            for x in 0..self.width.min(out_width) {
                for c in 0..3 {
                    let v = self.data[(y * self.width + x) * 3 + c] as f32;
                    out[c * plane + y * out_width + x] = (v / 255.0 - 0.5) / 0.5;
                }
            }
        }
    }
}

impl Bgr {
    /// The bounding box of the "ink" — pixels clearly off the background (the
    /// median brightness) — or `None` for a blank image. Classical
    /// binarization, for a strip known to hold at most a line of text.
    pub fn ink_bounds(&self) -> Option<Rect> {
        const CONTRAST: i32 = 60;
        const MIN_PIXELS: usize = 4;
        let luma: Vec<i32> = self
            .data
            .chunks_exact(3)
            .map(|p| (p[0] as i32 * 29 + p[1] as i32 * 150 + p[2] as i32 * 77) >> 8)
            .collect();
        if luma.is_empty() {
            return None;
        }
        let mut sorted = luma.clone();
        sorted.sort_unstable();
        let background = sorted[sorted.len() / 2];
        let mut bounds: Option<Rect> = None;
        let mut count = 0;
        for (i, &l) in luma.iter().enumerate() {
            if (l - background).abs() < CONTRAST {
                continue;
            }
            count += 1;
            let (x, y) = (i % self.width, i / self.width);
            let b = bounds.get_or_insert(Rect { x0: x, y0: y, x1: x + 1, y1: y + 1 });
            b.x0 = b.x0.min(x);
            b.y0 = b.y0.min(y);
            b.x1 = b.x1.max(x + 1);
            b.y1 = b.y1.max(y + 1);
        }
        bounds.filter(|_| count >= MIN_PIXELS)
    }
}

/// The two neighbouring source indices and the weight of the second one.
fn source_taps(pos: f32, len: usize) -> (usize, usize, f32) {
    let pos = pos.clamp(0.0, (len - 1) as f32);
    let i0 = pos.floor() as usize;
    let i1 = (i0 + 1).min(len - 1);
    (i0, i1, pos - i0 as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(width: usize, height: usize, f: impl Fn(usize, usize) -> [u8; 3]) -> Bgr {
        let f = &f;
        let data = (0..height).flat_map(|y| (0..width).flat_map(move |x| f(x, y))).collect();
        Bgr { width, height, data }
    }

    #[test]
    fn from_rgba_swaps_to_bgr_and_drops_alpha() {
        let img = Bgr::from_rgba(1, 1, &[10, 20, 30, 255]);
        assert_eq!(img.data, vec![30, 20, 10]);
    }

    #[test]
    fn crop_takes_the_rect_and_clamps_to_the_image() {
        let img = image(4, 3, |x, y| [(x + 10 * y) as u8, 0, 0]);
        let c = img.crop(Rect { x0: 1, y0: 1, x1: 3, y1: 9 });
        assert_eq!((c.width, c.height), (2, 2));
        assert_eq!(c.data.iter().step_by(3).copied().collect::<Vec<_>>(), vec![11, 12, 21, 22]);
    }

    #[test]
    fn resize_keeps_a_flat_image_flat_and_interpolates_gradients() {
        let flat = image(5, 3, |_, _| [7, 8, 9]).resize(11, 2);
        assert!(flat.data.chunks(3).all(|p| p == [7, 8, 9]));

        let ramp = image(2, 1, |x, _| [if x == 0 { 0 } else { 200 }, 0, 0]).resize(4, 1);
        let reds: Vec<u8> = ramp.data.iter().step_by(3).copied().collect();
        assert_eq!(reds, vec![0, 50, 150, 200]);
    }

    #[test]
    fn ink_bounds_finds_the_glyph_on_either_background_and_skips_blank_strips() {
        let dark = image(20, 8, |x, y| if (5..7).contains(&x) && (2..6).contains(&y) { [230; 3] } else { [20; 3] });
        assert_eq!(dark.ink_bounds(), Some(Rect { x0: 5, y0: 2, x1: 7, y1: 6 }));
        let light = image(20, 8, |x, y| if x == 12 && y < 4 { [0; 3] } else { [250; 3] });
        assert_eq!(light.ink_bounds(), Some(Rect { x0: 12, y0: 0, x1: 13, y1: 4 }));
        // Faint noise is not ink.
        assert_eq!(image(20, 8, |x, _| [(20 + x) as u8; 3]).ink_bounds(), None);
    }

    #[test]
    fn normalized_chw_is_planar_scaled_and_zero_padded() {
        let img = image(1, 1, |_, _| [255, 0, 0]);
        let mut out = vec![9.0; 3 * 2];
        out.iter_mut().for_each(|v| *v = 0.0);
        img.write_normalized_chw(&mut out, 2);
        // c0 (B) = 1.0, c1 (G) = -1.0, c2 (R) = -1.0; the padded column stays 0.
        assert_eq!(out, vec![1.0, 0.0, -1.0, 0.0, -1.0, 0.0]);
    }
}
