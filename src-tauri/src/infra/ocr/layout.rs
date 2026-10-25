//! Rebuilds plain text from recognized boxes: groups them into lines,
//! restores indentation and blank lines from the geometry (code is
//! monospaced, so x offsets map to columns), and drops the editor's
//! line-number gutter. Pure.

use super::imaging::Rect;

/// A recognized box: its source-pixel rectangle and text.
#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    pub rect: Rect,
    pub text: String,
}

/// The text of `words` laid out as on screen.
pub fn layout_text(words: &[Word]) -> String {
    let words: Vec<&Word> = words.iter().filter(|w| !w.text.trim().is_empty()).collect();
    if words.is_empty() {
        return String::new();
    }
    let mut lines = group_lines(&words);
    drop_line_number_gutter(&mut lines);
    lines.retain(|l| !l.is_empty());
    if lines.is_empty() {
        return String::new();
    }

    let char_w = char_width(&lines);
    let left = base_column(&lines, char_w);
    let pitch = line_pitch(&lines);

    let mut out: Vec<String> = Vec::new();
    let mut previous_center: Option<f32> = None;
    for line in &lines {
        let center = center_y(line[0]);
        if let (Some(prev), Some(pitch)) = (previous_center, pitch) {
            // A gap of more than ~1.5 lines held blank lines (code paragraphs).
            let blank = ((center - prev) / pitch).round() as i64 - 1;
            for _ in 0..blank.clamp(0, 3) {
                out.push(String::new());
            }
        }
        previous_center = Some(center);

        let mut text = " ".repeat(columns(line[0].rect.x0.saturating_sub(left), char_w));
        for (i, word) in line.iter().enumerate() {
            if i > 0 {
                // Boxes split inside a token (`attempts` `.append`) sit closer
                // than half a character: no space between them.
                let gap = word.rect.x0.saturating_sub(line[i - 1].rect.x1) as f32 / char_w;
                if gap >= 0.5 {
                    text.push_str(&" ".repeat((gap.round() as usize).max(1)));
                }
            }
            text.push_str(&normalize(word.text.trim()));
        }
        out.push(text.trim_end().to_string());
    }
    out.join("\n")
}

fn center_y(w: &Word) -> f32 {
    (w.rect.y0 + w.rect.y1) as f32 / 2.0
}

/// Words sharing a line: sorted top-down, a word joins the current line when
/// it overlaps the line's FIRST word by at least half the smaller height. The
/// reference does not grow with the line — otherwise one tall box (two lines
/// detected as one) would chain the next lines into this one.
fn group_lines<'a>(words: &[&'a Word]) -> Vec<Vec<&'a Word>> {
    let mut sorted = words.to_vec();
    sorted.sort_by(|a, b| center_y(a).total_cmp(&center_y(b)));
    let mut lines: Vec<Vec<&Word>> = Vec::new();
    for word in sorted {
        let joins = lines.last().is_some_and(|line| {
            let seed = line[0].rect;
            let overlap = word.rect.y1.min(seed.y1) as f32 - word.rect.y0.max(seed.y0) as f32;
            overlap >= 0.5 * (word.rect.height().min(seed.height())) as f32
        });
        if joins {
            lines.last_mut().unwrap().push(word);
        } else {
            lines.push(vec![word]);
        }
    }
    for line in &mut lines {
        line.sort_by_key(|w| w.rect.x0);
    }
    lines
}

/// Removes the editor's line-number column (see `gutter_lines`).
fn drop_line_number_gutter(lines: &mut [Vec<&Word>]) {
    for i in gutter_lines(lines) {
        lines[i].remove(0);
    }
}

/// Indices of the lines that start with an editor line number — when most
/// lines start with a bare number and the numbers mostly increase. Empty when
/// there is no such gutter.
fn gutter_lines(lines: &[Vec<&Word>]) -> Vec<usize> {
    let numbered: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| is_gutter_number(l))
        .map(|(i, _)| i)
        .collect();
    if numbered.len() < 3 || numbered.len() * 2 < lines.len() {
        return Vec::new();
    }
    let values: Vec<u64> = numbered.iter().filter_map(|&i| lines[i][0].text.trim().parse().ok()).collect();
    let increasing = values.windows(2).filter(|w| w[1] > w[0]).count();
    if increasing * 10 < (values.len() - 1) * 8 {
        return Vec::new();
    }
    numbered
}

/// Rows worth a second look. The detector misses tiny lone glyphs — a line
/// holding just `}` or `)` — but the editor's line numbers are detected
/// reliably, so a numbered line with nothing next to it is either blank or
/// such a glyph. Returns, for each, a strip of the code column at that row
/// (`max_columns` characters wide, clamped to `image_width`) for the
/// recognizer to read directly.
pub fn gutter_probes(words: &[Word], image_width: usize, max_columns: usize) -> Vec<Rect> {
    let words: Vec<&Word> = words.iter().filter(|w| !w.text.trim().is_empty()).collect();
    let lines = group_lines(&words);
    let gutter = gutter_lines(&lines);
    if gutter.is_empty() {
        return Vec::new();
    }
    let code: Vec<Vec<&Word>> = lines.iter().filter(|l| l.len() > 1).map(|l| l[1..].to_vec()).collect();
    if code.is_empty() {
        return Vec::new();
    }
    let char_w = char_width(&code);
    let gutter_right = gutter.iter().map(|&i| lines[i][0].rect.x1).max().unwrap_or(0);
    // From just past the numbers: the probe must not cut into the code column.
    let x0 = gutter_right + (char_w / 2.0) as usize;
    let x1 = (x0 + (max_columns as f32 * char_w) as usize).min(image_width);
    gutter
        .iter()
        .filter(|&&i| lines[i].len() == 1)
        .map(|&i| {
            // The number's box hugs its digits; give the strip some margin.
            let r = lines[i][0].rect;
            let pad = r.height() / 4;
            Rect { x0, y0: r.y0.saturating_sub(pad), x1, y1: r.y1 + pad }
        })
        .filter(|r| r.x1 > r.x0)
        .collect()
}

fn is_gutter_number(line: &[&Word]) -> bool {
    let first = line[0];
    let text = first.text.trim();
    !text.is_empty() && text.len() <= 5 && text.chars().all(|c| c.is_ascii_digit())
}

/// The x of column 0: the leftmost line start shared by at least two lines
/// (within half a character) — so a lone element further left (an editor tab
/// label, a heading) does not shift the whole block's indentation. Lines left
/// of it get no indentation.
fn base_column(lines: &[Vec<&Word>], char_w: f32) -> usize {
    let mut starts: Vec<usize> = lines.iter().map(|l| l[0].rect.x0).collect();
    starts.sort_unstable();
    let near = |a: usize, b: usize| (a.abs_diff(b) as f32) < char_w / 2.0;
    starts
        .iter()
        .find(|&&x| starts.iter().filter(|&&y| near(x, y)).count() >= 2)
        .copied()
        .unwrap_or(starts[0])
}

/// Maps full-width forms (the CJK dictionaries' `，` `：` `（`) and the
/// ideographic space/full stop to their ASCII equivalents: on a screen of code
/// they are always misreads of the ASCII symbols.
fn normalize(text: &str) -> String {
    text.chars()
        .map(|c| match c as u32 {
            0xFF01..=0xFF5E => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            0x3000 => ' ',
            0x3002 => '.',
            _ => c,
        })
        .collect()
}

/// The width of one character (the font's advance). Box widths grow by one
/// advance per character, but a box spans the ink, not whole cells, so the
/// slope of width over length (least squares) is the advance — a plain
/// width / length ratio comes out a few percent short, and over a deep
/// indentation that is a whole column. Falls back to a median ratio when the
/// words are too uniform for a slope.
fn char_width(lines: &[Vec<&Word>]) -> f32 {
    let samples: Vec<(f32, f32)> = lines
        .iter()
        .flatten()
        .map(|w| (w.text.chars().count() as f32, w.rect.width() as f32))
        .filter(|&(n, _)| n >= 2.0)
        .collect();
    let mut ratios: Vec<f32> = samples.iter().filter(|s| s.0 >= 3.0).map(|&(n, w)| w / (n - 0.4)).collect();
    if ratios.is_empty() {
        ratios = lines.iter().flatten().map(|w| w.rect.height() as f32 * 0.5).collect();
    }
    ratios.sort_by(f32::total_cmp);
    let median = ratios[ratios.len() / 2].max(1.0);

    if samples.len() >= 5 {
        let k = samples.len() as f32;
        let (mn, mw) = samples.iter().fold((0.0, 0.0), |(a, b), &(n, w)| (a + n / k, b + w / k));
        let var: f32 = samples.iter().map(|&(n, _)| (n - mn) * (n - mn)).sum();
        let cov: f32 = samples.iter().map(|&(n, w)| (n - mn) * (w - mw)).sum();
        if var > 0.0 {
            let slope = cov / var;
            // A misread-heavy screen can skew the fit; trust it only near the median.
            if slope > median * 0.8 && slope < median * 1.25 {
                return slope;
            }
        }
    }
    median
}

/// Median distance between consecutive line centers, if there are lines enough.
fn line_pitch(lines: &[Vec<&Word>]) -> Option<f32> {
    let mut gaps: Vec<f32> = lines.windows(2).map(|w| center_y(w[1][0]) - center_y(w[0][0])).collect();
    if gaps.len() < 2 {
        return None;
    }
    gaps.sort_by(f32::total_cmp);
    Some(gaps[gaps.len() / 2].max(1.0))
}

fn columns(px: usize, char_w: f32) -> usize {
    (px as f32 / char_w).round() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A word at text column `col` of line `row` on a 10 px × 20 px character
    /// grid. Like a detector box, it spans the ink: it stops 4 px short of the
    /// last character's advance.
    fn word(row: usize, col: usize, text: &str) -> Word {
        let (cw, lh) = (10, 20);
        Word {
            rect: Rect {
                x0: 100 + col * cw,
                y0: row * lh + 3,
                x1: 100 + (col + text.len()) * cw - 4,
                y1: row * lh + 17,
            },
            text: text.to_string(),
        }
    }

    #[test]
    fn restores_lines_indentation_spacing_and_blank_lines() {
        let words = vec![
            word(0, 0, "func"),
            word(0, 5, "main()"),
            word(0, 12, "{"),
            word(1, 4, "x"),
            word(1, 6, ":="),
            word(1, 9, "1"),
            word(3, 4, "return"),
            word(4, 0, "}"),
        ];
        assert_eq!(layout_text(&words), "func main() {\n    x := 1\n\n    return\n}");
    }

    #[test]
    fn order_of_input_boxes_does_not_matter() {
        let mut words = vec![word(1, 4, "bbb"), word(0, 0, "aaa"), word(1, 0, "ccc")];
        words.reverse();
        assert_eq!(layout_text(&words), "aaa\nccc bbb");
    }

    #[test]
    fn drops_the_line_number_gutter() {
        let mut words = Vec::new();
        for (row, code) in ["if x {", "    y()", "}"].iter().enumerate() {
            words.push(word(row, 0, &(row + 41).to_string()));
            let indent = code.len() - code.trim_start().len();
            words.push(word(row, 4 + indent, code.trim_start()));
        }
        assert_eq!(layout_text(&words), "if x {\n    y()\n}");
    }

    #[test]
    fn probes_the_numbered_rows_that_have_no_text() {
        let mut words = Vec::new();
        for row in 0..4 {
            words.push(word(row, 0, &(row + 1).to_string()));
        }
        words.push(word(0, 4, "func f() {"));
        words.push(word(1, 8, "x()"));
        // Rows 2 (a lone `}` the detector missed) and 3 (blank) have no text.
        let probes = gutter_probes(&words, 10_000, 20);
        assert_eq!(probes.len(), 2);
        // The number boxes (14 px tall) padded by 3 px.
        assert_eq!((probes[0].y0, probes[0].y1), (2 * 20, 2 * 20 + 20));
        assert_eq!(probes[1].y0, 3 * 20);
        // Starts half a character past the number column (ink x 100..106).
        assert_eq!(probes[0].x0, 111);
        assert_eq!(probes[0].x1, 111 + 200);
    }

    #[test]
    fn no_probes_without_a_gutter() {
        let words = vec![word(0, 0, "a"), word(1, 0, "b"), word(2, 0, "c")];
        assert!(gutter_probes(&words, 1000, 20).is_empty());
    }

    #[test]
    fn keeps_numbers_that_are_not_a_gutter() {
        let words = vec![word(0, 0, "1"), word(1, 0, "1"), word(2, 0, "1"), word(3, 0, "x")];
        assert_eq!(layout_text(&words), "1\n1\n1\nx");
    }

    #[test]
    fn a_lone_element_further_left_does_not_indent_the_block() {
        // A tab label two columns left of the code.
        let mut label = word(0, 0, "main.go");
        label.rect.x0 -= 20;
        label.rect.x1 -= 20;
        let words = vec![label, word(1, 0, "package"), word(2, 0, "func"), word(3, 4, "x")];
        assert_eq!(layout_text(&words), "main.go\npackage\nfunc\n    x");
    }

    #[test]
    fn close_boxes_join_without_a_space_and_full_width_symbols_become_ascii() {
        let mut dot = word(0, 8, ".append（x），");
        dot.rect.x0 -= 1; // 0.3 of a character after the ink of "attempts"
        let words = vec![word(0, 0, "attempts"), dot, word(1, 0, "y")];
        assert_eq!(layout_text(&words), "attempts.append(x),\ny");
    }

    #[test]
    fn character_width_is_the_advance_not_the_ink_ratio() {
        // Ink spans n-1 advances plus 6 px; the advance is 10 px.
        let words = vec![word(0, 0, "ab"), word(1, 0, "abcd"), word(2, 0, "abcdefgh"), word(3, 0, "abc"), word(4, 0, "abcdefghijkl")];
        let lines = group_lines(&words.iter().collect::<Vec<_>>());
        assert!((char_width(&lines) - 10.0).abs() < 0.01, "{}", char_width(&lines));
    }

    #[test]
    fn a_tall_box_does_not_chain_the_following_lines_together() {
        let mut tall = word(0, 10, "xx");
        tall.rect.y1 = 2 * 20 + 3; // spans rows 0 and 1
        let words = vec![word(0, 0, "aaa"), tall, word(1, 0, "bbb"), word(2, 0, "ccc")];
        let text = layout_text(&words);
        assert!(text.ends_with("bbb\nccc"), "{text}");
    }

    #[test]
    fn empty_input_gives_empty_text() {
        assert_eq!(layout_text(&[]), "");
        assert_eq!(layout_text(&[word(0, 0, "  ")]), "");
    }
}
