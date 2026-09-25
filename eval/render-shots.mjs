// Renders an eval case's source file into IDE-like screenshots (R13).
//
//   pnpm eval:shots                       # all cases
//   pnpm eval:shots go-http-cache-review  # one case
//
// Why rendered, not hand-made: a deterministic, re-creatable screenshot of the
// exact ground-truth text — so recognition errors are provable (`httpCli` read
// as `http11`), and resolution / font size / theme become controlled variables
// instead of "whatever the screen looked like that day".
//
// Each variant is rendered at 2560×1440 (a real 1440p frame) with a
// line-number gutter (the reviewer may cite gutter numbers, R14). When the code
// does not fit one frame it is split into consecutive, overlapping frames — the
// multi-screenshot batch the agents must merge. Every full-size frame also gets
// a copy downscaled to a 1568 px long edge in the browser (high-quality canvas
// smoothing): close to, but not bit-identical with, the native box filter in
// `src-tauri/src/infra/image.rs`.
//
// Browser: set PLAYWRIGHT_CHROMIUM_EXECUTABLE, otherwise installed Edge/Chrome
// is used (channel msedge → chrome). Plain Node ESM — no build step.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { codeToHtml } from 'shiki';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = join(ROOT, 'docs', 'prompt-eval', 'cases');
const FRAME = { width: 2560, height: 1440 };
const DOWNSCALED_EDGE = 1568;
const OVERLAP_LINES = 3;

const VARIANTS = [
  { name: 'dark-13px', theme: 'github-dark-default', fontPx: 13 },
  { name: 'light-13px', theme: 'github-light-default', fontPx: 13 },
  { name: 'dark-16px', theme: 'github-dark-default', fontPx: 16 },
];

const LANGS = { '.go': 'go', '.py': 'python', '.ts': 'typescript', '.js': 'javascript', '.sql': 'sql' };

async function launch() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath });
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // try the next channel
    }
  }
  throw new Error('No Chromium found: set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a Chrome/Edge binary.');
}

function pageHtml({ codeHtml, lineCount, firstLine, fileName, variant, dark }) {
  const lineHeight = Math.round(variant.fontPx * 1.3);
  const gutter = Array.from({ length: lineCount }, (_, i) => firstLine + i).join('\n');
  const bg = dark ? '#0d1117' : '#ffffff';
  const chrome = dark ? '#161b22' : '#f6f8fa';
  const muted = dark ? '#6e7681' : '#8c959f';
  const border = dark ? '#30363d' : '#d0d7de';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${FRAME.width}px;height:${FRAME.height}px;overflow:hidden;background:${bg};}
    body{font-family:"JetBrains Mono","Cascadia Code",Consolas,"DejaVu Sans Mono",monospace;font-size:${variant.fontPx}px;}
    .tabs{height:36px;background:${chrome};border-bottom:1px solid ${border};display:flex;align-items:flex-end;padding-left:220px;}
    .tab{padding:8px 16px;background:${bg};color:${dark ? '#e6edf3' : '#1f2328'};border:1px solid ${border};border-bottom:none;font-size:13px;}
    .side{position:absolute;top:0;left:0;width:220px;height:100%;background:${chrome};border-right:1px solid ${border};}
    .editor{position:absolute;top:37px;left:221px;right:0;bottom:0;display:flex;padding-top:8px;}
    .gutter{white-space:pre;text-align:right;color:${muted};padding:0 16px 0 12px;line-height:${lineHeight}px;user-select:none;}
    .code pre{margin:0;background:transparent!important;line-height:${lineHeight}px;}
    .code code{font-family:inherit;}
  </style></head><body>
    <div class="side"></div>
    <div class="tabs"><div class="tab">${fileName}</div></div>
    <div class="editor"><div class="gutter">${gutter}</div><div class="code">${codeHtml}</div></div>
  </body></html>`;
}

/** Splits source lines into consecutive frames that fit the editor height. */
function frames(lines, variant) {
  const lineHeight = Math.round(variant.fontPx * 1.3);
  const perFrame = Math.floor((FRAME.height - 37 - 16) / lineHeight);
  if (lines.length <= perFrame) return [{ first: 1, lines }];
  const out = [];
  for (let start = 0; start < lines.length; start += perFrame - OVERLAP_LINES) {
    out.push({ first: start + 1, lines: lines.slice(start, start + perFrame) });
    if (start + perFrame >= lines.length) break;
  }
  return out;
}

async function downscale(page, pngBuffer) {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  const out = await page.evaluate(
    async ({ src, edge }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = edge / Math.max(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    },
    { src: dataUrl, edge: DOWNSCALED_EDGE },
  );
  return Buffer.from(out.split(',')[1], 'base64');
}

async function renderCase(browser, caseId) {
  const caseDir = join(CASES_DIR, caseId);
  const meta = JSON.parse(await readFile(join(caseDir, 'case.json'), 'utf8'));
  const source = await readFile(join(caseDir, meta.source), 'utf8');
  const lang = LANGS[extname(meta.source)] ?? 'text';
  const lines = source.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const shotsDir = join(caseDir, 'shots');
  await mkdir(shotsDir, { recursive: true });

  const page = await browser.newPage({ viewport: FRAME, deviceScaleFactor: 1 });
  const manifest = {};
  for (const variant of VARIANTS) {
    const dark = variant.theme.includes('dark');
    const full = [];
    const small = [];
    for (const [i, frame] of frames(lines, variant).entries()) {
      const codeHtml = await codeToHtml(frame.lines.join('\n'), { lang, theme: variant.theme });
      await page.setContent(
        pageHtml({
          codeHtml,
          lineCount: frame.lines.length,
          firstLine: frame.first,
          fileName: meta.source,
          variant,
          dark,
        }),
      );
      const png = await page.screenshot({ type: 'png' });
      const suffix = `-${i + 1}.png`;
      const fullName = `${variant.name}-${FRAME.width}${suffix}`;
      const smallName = `${variant.name}-${DOWNSCALED_EDGE}${suffix}`;
      await writeFile(join(shotsDir, fullName), png);
      await writeFile(join(shotsDir, smallName), await downscale(page, png));
      full.push(fullName);
      small.push(smallName);
    }
    manifest[`${variant.name}-${FRAME.width}`] = full;
    manifest[`${variant.name}-${DOWNSCALED_EDGE}`] = small;
  }
  await page.close();
  await writeFile(join(shotsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${caseId}: ${Object.entries(manifest).map(([k, v]) => `${k}×${v.length}`).join(', ')}`);
}

const only = process.argv.slice(2);
const caseIds = only.length > 0 ? only : (await readdir(CASES_DIR, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const browser = await launch();
try {
  for (const caseId of caseIds) await renderCase(browser, caseId);
} finally {
  await browser.close();
}
