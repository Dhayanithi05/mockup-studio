import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// Uses real browser PNG encoding/decoding, independently reads ZIP structures,
// and compares every frame against the full-resolution composition renderer.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/__sequence-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Lossless sequence verification</title>',
    }),
  );
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:4175'}/__sequence-check`);
  const generated = await page.evaluate(async () => {
    const { renderFrameSequence } = await import('/src/engine/frame-sequence.ts');
    const { loadImage } = await import('/src/engine/image.ts');
    const { createDefaults } = await import('/src/state/defaults.ts');
    const source = async (width, height, design = false) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          image.data[i] = (x * 17 + y) % 256;
          image.data[i + 1] = (x + y * 3) % 256;
          image.data[i + 2] = (x * 7 + y * 11) % 256;
          image.data[i + 3] = design || x > 3 ? 255 : 0;
        }
      }
      ctx.putImageData(image, 0, 0);
      return loadImage(await canvas.convertToBlob({ type: 'image/png' }), 'pattern.png');
    };
    const assets = {
      mockup: await source(128, 96),
      design: await source(32, 192, true),
      foreground: null,
      background: null,
    };
    const composition = createDefaults();
    composition.output = {
      ...composition.output,
      width: 128,
      height: 96,
      framing: 'original',
      background: 'transparent',
    };
    composition.video = {
      ...composition.video,
      format: 'png-sequence',
      width: 128,
      height: 96,
      fps: 4,
      duration: 1.125,
    };
    composition.motion = {
      ...composition.motion,
      mode: 'cinematic',
      duration: 1.125,
      delay: 0,
      endHold: 0,
      easing: 'linear',
    };
    const rectangle = (x, y, width, height) => [
      { x: x / 128, y: y / 96 },
      { x: (x + width) / 128, y: y / 96 },
      { x: (x + width) / 128, y: (y + height) / 96 },
      { x: x / 128, y: (y + height) / 96 },
    ];
    composition.screen.quad = rectangle(8, 8, 32, 48);
    composition.extraScreens = [
      { ...structuredClone(composition.screen), id: 'second', quad: rectangle(80, 32, 32, 32) },
    ];
    const progress = [];
    const archive = await renderFrameSequence(composition, assets, (update) => {
      progress.push(update.progress);
    });
    globalThis.sequenceFixture = { composition, assets };

    const controller = new AbortController();
    let completedBeforeAbort = 0;
    let cancellation = null;
    try {
      await renderFrameSequence(
        composition,
        assets,
        (update) => {
          if (update.progress > 0 && update.progress < 1) {
            completedBeforeAbort++;
            controller.abort();
          }
        },
        controller.signal,
      );
    } catch (error) {
      cancellation = error.name;
    }
    return {
      archive: Array.from(new Uint8Array(await archive.arrayBuffer())),
      type: archive.type,
      progress,
      cancellation,
      completedBeforeAbort,
    };
  });
  assert.equal(generated.type, 'application/zip');
  assert.equal(generated.cancellation, 'AbortError');
  assert.equal(generated.completedBeforeAbort, 1, 'Cancellation must stop after the first frame');
  assert.equal(generated.progress[0], 0);
  assert.equal(generated.progress.at(-1), 1);
  assert.equal(
    generated.progress.every((value, index, all) => index === 0 || value >= all[index - 1]),
    true,
  );

  const zip = Buffer.from(generated.archive);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, 'Valid end-of-central-directory record');
  assert.equal(zip.readUInt16LE(end + 4), 0, 'Single-disk archive');
  assert.equal(zip.readUInt16LE(end + 6), 0);
  const entryCount = zip.readUInt16LE(end + 10);
  assert.equal(zip.readUInt16LE(end + 8), entryCount);
  assert.equal(entryCount, 6, 'Five PNG frames plus manifest');
  const directoryOffset = zip.readUInt32LE(end + 16);
  const directorySize = zip.readUInt32LE(end + 12);
  assert.equal(directoryOffset + directorySize, end);
  const entries = [];
  let cursor = directoryOffset;
  let expectedLocalOffset = 0;
  const crc32 = (data) => {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (let index = 0; index < entryCount; index++) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, 'Valid central-directory entry');
    assert.equal(zip.readUInt16LE(cursor + 10), 0, 'ZIP STORE must keep PNG bytes untouched');
    const checksum = zip.readUInt32LE(cursor + 16);
    const size = zip.readUInt32LE(cursor + 20);
    assert.equal(zip.readUInt32LE(cursor + 24), size);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const offset = zip.readUInt32LE(cursor + 42);
    assert.equal(
      offset,
      expectedLocalOffset,
      'Directory offsets point to contiguous local entries',
    );
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    assert.equal(zip.readUInt16LE(offset + 8), 0);
    assert.equal(zip.readUInt32LE(offset + 14), checksum);
    assert.equal(zip.readUInt32LE(offset + 18), size);
    assert.equal(zip.readUInt32LE(offset + 22), size);
    const localNameLength = zip.readUInt16LE(offset + 26);
    const localExtraLength = zip.readUInt16LE(offset + 28);
    assert.equal(zip.subarray(offset + 30, offset + 30 + localNameLength).toString('utf8'), name);
    const dataOffset = offset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataOffset, dataOffset + size);
    assert.equal(crc32(data), checksum, `${name} has a valid CRC32`);
    entries.push({ name, data });
    expectedLocalOffset = dataOffset + size;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, end);
  assert.equal(expectedLocalOffset, directoryOffset);
  assert.deepEqual(
    entries.map(({ name }) => name),
    [
      'frame-000001.png',
      'frame-000002.png',
      'frame-000003.png',
      'frame-000004.png',
      'frame-000005.png',
      'manifest.json',
    ],
  );
  const manifest = JSON.parse(entries.at(-1).data.toString('utf8'));
  assert.equal(manifest.format, 'png-sequence');
  assert.deepEqual([manifest.width, manifest.height], [128, 96]);
  assert.equal(manifest.fps, 4);
  assert.equal(manifest.duration, 1.125);
  assert.equal(manifest.frameCount, 5);
  assert.equal(manifest.firstFrameTime, 0);
  assert.equal(manifest.frameInterval, 0.25);
  assert.equal(manifest.lastFrameDuration, 0.125);
  assert.equal(manifest.colorSpace, 'srgb');
  assert.equal(manifest.bitDepth, 8);
  assert.equal(manifest.alpha, true);
  const frames = await page.evaluate(
    async (pngs) => {
      const { renderComposition } = await import('/src/engine/renderer.ts');
      const { composition, assets } = globalThis.sequenceFixture;
      const canvas = new OffscreenCanvas(128, 96);
      const ctx = canvas.getContext('2d');
      const decoded = new OffscreenCanvas(128, 96);
      const decodedCtx = decoded.getContext('2d');
      const result = [];
      const hash = (bytes) => {
        let value = 0x811c9dc5;
        for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0;
        return value;
      };
      for (let index = 0; index < pngs.length; index++) {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(pngs[index])], { type: 'image/png' }),
        );
        decodedCtx.clearRect(0, 0, 128, 96);
        decodedCtx.drawImage(bitmap, 0, 0);
        const actual = decodedCtx.getImageData(0, 0, 128, 96).data;
        renderComposition({
          ctx,
          width: 128,
          height: 96,
          composition,
          assets,
          currentTime: index / composition.video.fps,
          quality: 'export',
        });
        const expected = ctx.getImageData(0, 0, 128, 96).data;
        let mismatches = 0;
        for (let channel = 0; channel < expected.length; channel++) {
          if (actual[channel] !== expected[channel]) mismatches++;
        }
        result.push({
          dimensions: [bitmap.width, bitmap.height],
          mismatches,
          transparentAlpha: actual[3],
          primaryHash: hash(decodedCtx.getImageData(8, 8, 32, 48).data),
          secondaryHash: hash(decodedCtx.getImageData(80, 32, 32, 32).data),
        });
        bitmap.close();
      }
      return result;
    },
    entries.slice(0, -1).map(({ data }) => Array.from(data)),
  );
  for (const [index, frame] of frames.entries()) {
    assert.deepEqual(frame.dimensions, [128, 96]);
    assert.equal(frame.mismatches, 0, `Frame ${index + 1} must retain every rendered pixel`);
    assert.equal(frame.transparentAlpha, 0, 'PNG sequence must preserve transparency');
  }
  assert.equal(
    new Set(frames.map(({ primaryHash }) => primaryHash)).size,
    5,
    'Primary screen moves in every frame',
  );
  assert.equal(
    new Set(frames.map(({ secondaryHash }) => secondaryHash)).size,
    5,
    'Second screen moves in every frame',
  );
  console.log(
    JSON.stringify(
      {
        archiveBytes: zip.length,
        entries: entries.length,
        frames: frames.length,
        dimensions: [128, 96],
        fps: 4,
        duration: 1.125,
        differingChannels: frames.map(({ mismatches }) => mismatches),
        crc32: 'all valid',
        transparency: 'preserved',
        cancellation: generated.cancellation,
      },
      null,
      2,
    ),
  );
  console.log(
    'Real PNG sequence ZIP structure, CRC32, timing, multi-screen motion, lossless pixels, and cancellation checks passed.',
  );
} finally {
  await browser.close();
}
