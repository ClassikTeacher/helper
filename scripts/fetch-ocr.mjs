// Installs the local OCR (phase 6): ONNX Runtime + PaddleOCR models, into the
// folder the app loads them from. Run once per machine:
//
//   pnpm ocr:fetch                 # → %LOCALAPPDATA%\com.aihelper.app\ocr
//   pnpm ocr:fetch -- --dir <path> # elsewhere (then set AI_HELPER_OCR_DIR to it)
//   pnpm ocr:fetch -- --no-cyrillic
//
// Nothing is bundled into the app or the repo: the files (~60 MB on disk) come
// from pinned sources and are verified by SHA-256 before anything is written.
//   - onnxruntime.dll       — the `onnxruntime` 1.31.0 wheel (PyPI)
//   - det.onnx, rec.onnx    — PP-OCRv6 small detection/recognition, from the
//                             `rapidocr` 3.10.0 wheel (PyPI); the recognition
//                             dictionary is embedded in the model's metadata
//   - rec_cyrillic.onnx     — PP-OCRv5 East-Slavic recognition (Cyrillic +
//                             Latin), from RapidOCR's ModelScope repository
//                             (optional: without it, Russian text is not read)
//
// Downloads are cached in <dir>/.cache, so a re-run is offline. Plain Node ESM,
// no dependencies (wheels are zip files; read with node:zlib).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const IDENTIFIER = 'com.aihelper.app'; // tauri.conf.json → identifier

/** Pinned downloads. `files`: member of the archive → name in the OCR folder. */
const SOURCES = [
  {
    name: 'ONNX Runtime 1.31.0 (win_amd64)',
    url: 'https://files.pythonhosted.org/packages/be/ed/b12cea136ccd7b03d924f46b8393faf7ceac21115c0c50e729faa248cf23/onnxruntime-1.31.0-cp312-cp312-win_amd64.whl',
    sha256: '09d56445c1753e66e0912de69d3f0184016ad9a191dcd6925bf5dd570d2bfbe5',
    files: {
      'onnxruntime/capi/onnxruntime.dll': 'onnxruntime.dll',
      'onnxruntime/capi/onnxruntime_providers_shared.dll': 'onnxruntime_providers_shared.dll',
    },
  },
  {
    name: 'PP-OCRv6 small (rapidocr 3.10.0)',
    url: 'https://files.pythonhosted.org/packages/59/07/203065283bba0c5e9c10af3602dc25ab3e59ee54dc2d1d22c8faeabf5ed8/rapidocr-3.10.0-py3-none-any.whl',
    sha256: '2fc34e26cd0f48514804a94f8832283039c7334076bff60768b1fed9ad068050',
    files: {
      'rapidocr/models/PP-OCRv6_det_small.onnx': 'det.onnx',
      'rapidocr/models/PP-OCRv6_rec_small.onnx': 'rec.onnx',
    },
  },
  {
    name: 'PP-OCRv5 East-Slavic recognition (Cyrillic)',
    optional: 'cyrillic',
    url: 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/rec/eslav_PP-OCRv5_rec_mobile.onnx',
    // From rapidocr 3.10.0 default_models.yaml (onnx → eslav_PP-OCRv5_rec_mobile).
    sha256: '08705d6721849b1347d26187f15a5e362c431963a2a62bfff4feac578c489aab',
    file: 'rec_cyrillic.onnx',
  },
];

function parseArgs(argv) {
  const args = { dir: undefined, cyrillic: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--no-cyrillic') args.cyrillic = false;
    else if (argv[i] !== '--') throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

/** Mirrors `ocr_dir()` in src-tauri/src/infra/ort_ocr.rs. */
export function defaultDir(env = process.env) {
  if (env.AI_HELPER_OCR_DIR) return env.AI_HELPER_OCR_DIR;
  const base = env.LOCALAPPDATA ?? join(env.HOME ?? homedir(), '.local', 'share');
  return join(base, IDENTIFIER, 'ocr');
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** The file, from the cache when it verifies, otherwise downloaded and verified. */
async function obtain(source, cacheDir) {
  const cached = join(cacheDir, source.sha256);
  if (existsSync(cached)) {
    const buffer = readFileSync(cached);
    if (sha256(buffer) === source.sha256) return buffer;
  }
  process.stdout.write(`  downloading ${source.url}\n`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${source.url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = sha256(buffer);
  if (actual !== source.sha256) {
    throw new Error(`checksum mismatch for ${source.url}: expected ${source.sha256}, got ${actual}`);
  }
  writeFileSync(cached, buffer);
  return buffer;
}

/**
 * Extracts `members` from a zip archive (a wheel). Reads the central directory
 * — no zip64, no encryption: a wheel of this size never needs either.
 */
export function unzip(buffer, members) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip archive');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const wanted = new Set(members);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (wanted.has(name)) {
      const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(dataStart, dataStart + compressed);
      if (method === 0) out.set(name, Buffer.from(data));
      else if (method === 8) out.set(name, inflateRawSync(data));
      else throw new Error(`unsupported zip compression ${method} for ${name}`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  for (const m of members) if (!out.has(m)) throw new Error(`${m} not found in the archive`);
  return out;
}

/** Writes via a temp name, so a half-written file never looks installed. */
function install(dir, name, data) {
  const target = join(dir, name);
  writeFileSync(`${target}.part`, data);
  renameSync(`${target}.part`, target);
  process.stdout.write(`  ${name} (${(data.length / 1e6).toFixed(1)} MB)\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir ?? defaultDir();
  const cacheDir = join(dir, '.cache');
  mkdirSync(cacheDir, { recursive: true });
  process.stdout.write(`Installing the local OCR into ${dir}\n`);

  let failedOptional = false;
  for (const source of SOURCES) {
    if (source.optional === 'cyrillic' && !args.cyrillic) continue;
    process.stdout.write(`${source.name}\n`);
    try {
      const buffer = await obtain(source, cacheDir);
      if (source.file) {
        install(dir, source.file, buffer);
      } else {
        for (const [member, data] of unzip(buffer, Object.keys(source.files))) {
          install(dir, source.files[member], data);
        }
      }
    } catch (err) {
      if (!source.optional) throw err;
      failedOptional = true;
      process.stdout.write(
        `  skipped: ${err.message}\n  Without it Russian text on screen is not recognized. Download it by hand\n` +
          `  from the URL above (SHA-256 ${source.sha256}) and save it as ${join(dir, source.file)}.\n`,
      );
    }
  }
  process.stdout.write(
    `Done${failedOptional ? ' (without the optional Cyrillic model)' : ''}.` +
      (args.dir ? ` Point the app at it: set AI_HELPER_OCR_DIR=${dir}` : '') +
      '\nEnable the OCR pass for an agent in .env: VITE_AUTO_TRANSCRIBE=all (VITE_TRANSCRIBE_ENGINE=local is the default).\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fetch-ocr.mjs')) {
  main().catch((err) => {
    process.stderr.write(`ocr:fetch failed: ${err.message}\n`);
    process.exit(1);
  });
}
