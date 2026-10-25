import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
// @ts-expect-error — plain ESM script without type declarations
import { defaultDir, sha256, unzip } from '../../scripts/fetch-ocr.mjs';

/** A minimal zip (local headers + central directory) with the given entries. */
function zip(entries: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('fetch-ocr script', () => {
  it('extracts stored and deflated members from a wheel', () => {
    const archive = zip([
      { name: 'pkg/a.txt', data: Buffer.from('stored'), deflate: false },
      { name: 'pkg/model.onnx', data: Buffer.from('x'.repeat(1000)), deflate: true },
      { name: 'pkg/other', data: Buffer.from('skip me'), deflate: true },
    ]);
    const out = unzip(archive, ['pkg/model.onnx', 'pkg/a.txt']);
    expect(out.get('pkg/a.txt').toString()).toBe('stored');
    expect(out.get('pkg/model.onnx').toString()).toBe('x'.repeat(1000));
    expect(out.has('pkg/other')).toBe(false);
  });

  it('fails loudly on a missing member or a non-zip', () => {
    const archive = zip([{ name: 'a', data: Buffer.from('1'), deflate: false }]);
    expect(() => unzip(archive, ['b'])).toThrow('b not found');
    expect(() => unzip(Buffer.from('nope'), ['a'])).toThrow('not a zip');
  });

  it('installs where the app looks: AI_HELPER_OCR_DIR, else the app data folder', () => {
    expect(defaultDir({ AI_HELPER_OCR_DIR: 'D:/ocr' })).toBe('D:/ocr');
    expect(defaultDir({ LOCALAPPDATA: 'C:/Users/u/AppData/Local' })).toBe(
      join('C:/Users/u/AppData/Local', 'com.aihelper.app', 'ocr'),
    );
  });

  it('hashes with SHA-256', () => {
    expect(sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
