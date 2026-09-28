import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const results = path.resolve('test-results/multiscreen');
await mkdir(results, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let page;
const passed = [];
const check = (description) => {
  passed.push(description);
  console.log(`PASS ${description}`);
};
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4175');
  await page.waitForFunction(() =>
    document.querySelector('.asset-metadata strong')?.textContent.includes('Portfolio'),
  );
  const state = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .findLast((r) => r.name.includes('/src/state/store.ts'))?.name;
      const { useEditor } = await import(url || '/src/state/store.ts');
      const s = useEditor.getState();
      return {
        c: s.composition,
        selectedScreen: s.selectedScreen,
        candidates: s.candidates,
        busy: s.busy,
        error: s.error,
        assets: Object.fromEntries(
          Object.entries(s.assets).map(([key, a]) => [
            key,
            a
              ? {
                  name: a.name,
                  width: a.width,
                  height: a.height,
                  size: a.size,
                }
              : null,
          ]),
        ),
      };
    });
  const screens = (s) => [s.c.screen, ...(s.c.extraScreens ?? [])];
  const tab = (name) => page.locator('nav').getByRole('button', { name, exact: true }).click();
  const waitIdle = async () => {
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 90000 });
    assert.equal((await state()).error, '', 'No application error after operation');
  };
  const upload = async (target, filePath) => {
    await tab(target === 'mockup' ? 'Mockup' : 'Design');
    const chooser = page.waitForEvent('filechooser');
    await page
      .locator('.left-sidebar')
      .getByRole('button', {
        name: target === 'mockup' ? 'Replace Mockup' : 'Upload Design',
        exact: true,
      })
      .click();
    await (await chooser).setFiles(filePath);
    await waitIdle();
  };
  const makeFixture = async (name) => {
    const svg = await readFile(`tests/fixtures/${name}.svg`, 'utf8');
    const data = await page.evaluate(async (text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      const image = new Image();
      image.src = url;
      await image.decode();
      const cv = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
      cv.getContext('2d').drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      cv.width = cv.height = 1;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, svg);
    const filename = path.join(results, `${name}.png`);
    await writeFile(filename, Buffer.from(data, 'base64'));
    return filename;
  };
  const originalDownload = async (target, original) => {
    await tab(target === 'mockup' ? 'Mockup' : 'Design');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download original file', exact: true }).click();
    const destination = path.join(results, `downloaded-${target}.png`);
    await (await event).saveAs(destination);
    assert.deepEqual(
      await readFile(destination),
      await readFile(original),
      `${target} original bytes must be unchanged`,
    );
  };
  const pixels = (bytes, points) =>
    page.evaluate(
      async ({ encoded, points }) => {
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      },
      { encoded: bytes.toString('base64'), points },
    );

  const designBase64 = await page.evaluate(async () => {
    const cv = new OffscreenCanvas(3000, 8000);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#00bb55';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // Single-pixel lines remain present in the stored original, with no proxy image.
    for (let x = 0; x < 3000; x += 2) {
      ctx.fillStyle = '#0055bb';
      ctx.fillRect(x, 0, 1, 100);
    }
    ctx.fillStyle = '#ee0077';
    ctx.fillRect(0, 7900, cv.width, 100);
    const blob = await cv.convertToBlob({ type: 'image/png' });
    cv.width = cv.height = 1;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  });
  const designBytes = Buffer.from(designBase64, 'base64');
  const designPath = path.join(results, 'original-design-3000x8000.png');
  await writeFile(designPath, designBytes);
  await upload('design', designPath);
  assert.deepEqual((await state()).assets.design, {
    name: path.basename(designPath),
    width: 3000,
    height: 8000,
    size: designBytes.length,
  });
  await originalDownload('design', designPath);
  check('3000 × 8000 design preserves original dimensions and exact PNG bytes');

  const dualPath = await makeFixture('dual-display');
  await upload('mockup', dualPath);
  assert.equal(screens(await state()).length, 2);
  assert.ok(screens(await state()).every((screen) => screen.enabled !== false));
  assert.equal(await page.locator('.screen-row').count(), 2);
  check('Dual-display mockup automatically detects and fills two distinct screens');

  const triplePath = await makeFixture('triple-display');
  await upload('mockup', triplePath);
  assert.equal(screens(await state()).length, 3);
  assert.ok(screens(await state()).every((screen) => screen.enabled !== false));
  assert.equal(await page.locator('.screen-row').count(), 3);
  check('Triple mockup detects portrait, landscape, and perspective screens');
  await originalDownload('mockup', triplePath);
  check('Uploaded mockup download preserves exact original PNG bytes');

  await tab('Screen');
  await page.getByRole('button', { name: 'Select screen 2', exact: true }).click();
  await page.getByLabel('Screen name', { exact: true }).fill('Middle display');
  await page.getByLabel('Screen name', { exact: true }).blur();
  assert.equal(screens(await state())[1].name, 'Middle display');
  const beforeEdit = screens(await state());
  const topLeft = page.getByLabel('Top left X', { exact: true });
  await topLeft.fill(String(Number(await topLeft.inputValue()) + 4));
  await topLeft.blur();
  const afterEdit = screens(await state());
  assert.notDeepEqual(afterEdit[1].quad, beforeEdit[1].quad);
  assert.deepEqual(afterEdit[0], beforeEdit[0]);
  assert.deepEqual(afterEdit[2], beforeEdit[2]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(screens(await state()), beforeEdit);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.deepEqual(screens(await state()), afterEdit);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check('Selected-screen name and corner edits preserve other screens, with working undo/redo');

  const beforeAppearance = screens(await state());
  await page.getByRole('button', { name: 'Realistic', exact: true }).click();
  const afterAppearance = screens(await state());
  assert.equal(afterAppearance[1].brightness, 103);
  assert.equal(afterAppearance[1].reflection, 0.09);
  assert.deepEqual(afterAppearance[0], beforeAppearance[0]);
  assert.deepEqual(afterAppearance[2], beforeAppearance[2]);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  assert.deepEqual(screens(await state()), beforeAppearance);
  check(
    'Display appearance presets only affect the selected screen and Original restores neutral rendering',
  );

  await page.getByLabel('Show screen 2', { exact: true }).uncheck();
  assert.equal(screens(await state())[1].enabled, false);
  await page.getByLabel('Show screen 2', { exact: true }).check();
  assert.equal(screens(await state())[1].enabled, true);
  await page.getByRole('button', { name: 'Select screen 3 on canvas', exact: true }).click();
  assert.equal((await state()).selectedScreen, 2);
  await page.getByRole('button', { name: 'Add screen', exact: true }).click();
  assert.equal(screens(await state()).length, 4);
  assert.equal((await state()).selectedScreen, 3);
  await page.getByRole('button', { name: 'Remove screen 4', exact: true }).click();
  assert.equal(screens(await state()).length, 3);
  check('Screen visibility, canvas selection, and manual add/remove controls work');

  await tab('Export');
  await page.getByRole('button', { name: 'Native-size PNG', exact: true }).click();
  const native = await state();
  assert.equal(native.c.output.width, 1800);
  assert.equal(native.c.output.height, 1000);
  assert.equal(native.c.screenshot.format, 'png');
  assert.equal(native.c.screenshot.scale, 1);
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export screenshot', exact: true }).click();
  const exportedPath = path.join(results, 'native-triple-composition.png');
  await (await exportEvent).saveAs(exportedPath);
  const exported = await readFile(exportedPath);
  assert.equal(exported.readUInt32BE(16), 1800);
  assert.equal(exported.readUInt32BE(20), 1000);
  const screenPixels = await pixels(exported, [
    [300, 400],
    [900, 450],
    [1500, 500],
  ]);
  screenPixels.forEach((pixel, index) =>
    assert.deepEqual(
      pixel,
      [0, 187, 85, 255],
      `Screen ${index + 1} must contain the uploaded design`,
    ),
  );
  const outside = [
    [0, 0],
    [1799, 999],
    [700, 100],
  ];
  assert.deepEqual(
    await pixels(exported, outside),
    await pixels(await readFile(triplePath), outside),
  );
  check(
    'Native-size lossless PNG renders all three screens and unchanged mockup pixels outside them',
  );

  await tab('Project');
  await page.getByLabel('Project name', { exact: true }).fill('QA multiscreen originals');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.getByText('Project saved on this device.', { exact: true }).waitFor();
  const saved = await state();
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector('.asset-metadata strong')?.textContent.includes('Portfolio'),
  );
  await tab('Project');
  await page.getByRole('button', { name: /^QA multiscreen originals/ }).click();
  await page.waitForFunction(() =>
    document.querySelector('.project-name')?.textContent.includes('QA multiscreen originals'),
  );
  await waitIdle();
  const restored = await state();
  assert.deepEqual(restored.c, saved.c);
  assert.deepEqual(restored.assets, saved.assets);
  await originalDownload('design', designPath);
  await originalDownload('mockup', triplePath);
  check('Saved projects restore every screen and exact original design/mockup file bytes');

  await tab('Export');
  await page.getByLabel('Resolution preset', { exact: true }).selectOption('8K');
  const viewportInfo = () =>
    page
      .locator('.canvas-position > canvas')
      .first()
      .evaluate((canvas) => {
        const stage = document.querySelector('.stage-scroll');
        return {
          width: canvas.width,
          height: canvas.height,
          cssWidth: parseFloat(canvas.style.width),
          cssHeight: parseFloat(canvas.style.height),
          left: parseFloat(canvas.style.left),
          top: parseFloat(canvas.style.top),
          dpr: devicePixelRatio,
          stageWidth: stage.clientWidth,
          stageHeight: stage.clientHeight,
          scrollWidth: stage.scrollWidth,
          scrollLeft: stage.scrollLeft,
          sample: [
            ...canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), 4, 1, 1).data,
          ],
        };
      });
  for (const zoom of ['1', '2']) {
    await page.getByLabel('Preview zoom', { exact: true }).selectOption(zoom);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.canvas-position > canvas');
      return canvas.width === Math.round(parseFloat(canvas.style.width) * devicePixelRatio);
    });
    const initial = await viewportInfo();
    assert.equal(initial.dpr, 2);
    assert.equal(initial.width, Math.round(initial.cssWidth * initial.dpr));
    assert.equal(initial.height, Math.round(initial.cssHeight * initial.dpr));
    assert.ok(initial.width <= (initial.stageWidth + 1) * initial.dpr);
    assert.ok(initial.height <= (initial.stageHeight + 1) * initial.dpr);
    assert.ok(initial.scrollWidth >= 7680 * Number(zoom));
    const moveTo = Math.min(initial.scrollWidth - initial.stageWidth, initial.scrollLeft + 1200);
    await page.locator('.stage-scroll').evaluate((element, x) => {
      element.scrollTo({ left: x });
      element.dispatchEvent(new Event('scroll'));
    }, moveTo);
    await page.waitForFunction(
      (left) => parseFloat(document.querySelector('.canvas-position > canvas').style.left) > left,
      initial.left,
    );
    const moved = await viewportInfo();
    assert.ok(moved.left > initial.left);
    check(
      `8K canvas at ${Number(zoom) * 100}% renders the visible tile at physical DPR 2 and updates after scrolling`,
    );
  }
  await page.getByLabel('Preview zoom', { exact: true }).selectOption('fit');
  await tab('Screen');
  await page.getByRole('button', { name: 'Select screen 2', exact: true }).click();
  await page.screenshot({ path: path.join(results, 'multiscreen-editor.png') });
  await tab('Export');
  await page.getByRole('button', { name: 'Native-size PNG', exact: true }).click();
  await page.screenshot({ path: path.join(results, 'native-quality-export.png') });

  // Exercise the actual application download, including its distinct lossless format controls.
  await page.getByRole('switch', { name: 'Lock aspect ratio', exact: true }).uncheck();
  await page.getByLabel('Width', { exact: true }).fill('320');
  await page.getByLabel('Height', { exact: true }).fill('180');
  await page.getByLabel('Height', { exact: true }).blur();
  const stillEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export screenshot', exact: true }).click();
  const sequenceReferencePath = path.join(results, 'sequence-first-frame-reference.png');
  await (await stillEvent).saveAs(sequenceReferencePath);
  await waitIdle();
  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByLabel('Motion export format', { exact: true }).selectOption('png-sequence');
  await page.getByLabel('Frame rate', { exact: true }).selectOption('24');
  await page.getByLabel('Duration', { exact: true }).fill('1');
  await page.getByLabel('Duration', { exact: true }).blur();
  assert.equal(await page.getByLabel('Video bitrate', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Codec', { exact: true }).count(), 0);
  const sequenceEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG sequence', exact: true }).click();
  const sequenceDownload = await sequenceEvent;
  assert.match(sequenceDownload.suggestedFilename(), /\.zip$/);
  const sequencePath = path.join(results, 'lossless-motion-320x180.zip');
  await sequenceDownload.saveAs(sequencePath);
  await waitIdle();
  const zip = await readFile(sequencePath);
  const entries = new Map();
  let entryOffset = 0;
  while (zip.readUInt32LE(entryOffset) === 0x04034b50) {
    assert.equal(
      zip.readUInt16LE(entryOffset + 8),
      0,
      'PNG bytes should be stored unchanged in ZIP',
    );
    const size = zip.readUInt32LE(entryOffset + 18);
    const nameLength = zip.readUInt16LE(entryOffset + 26);
    const extraLength = zip.readUInt16LE(entryOffset + 28);
    const dataOffset = entryOffset + 30 + nameLength + extraLength;
    const name = zip.subarray(entryOffset + 30, entryOffset + 30 + nameLength).toString('utf8');
    entries.set(name, zip.subarray(dataOffset, dataOffset + size));
    entryOffset = dataOffset + size;
  }
  assert.equal(zip.readUInt32LE(entryOffset), 0x02014b50, 'ZIP contains a central directory');
  assert.equal(entries.size, 25);
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(manifest.frameCount, 24);
  assert.equal(manifest.fps, 24);
  assert.equal(manifest.duration, 1);
  assert.equal(manifest.width, 320);
  assert.equal(manifest.height, 180);
  for (let index = 1; index <= 24; index++) {
    const frame = entries.get(`frame-${String(index).padStart(6, '0')}.png`);
    assert.ok(frame, `Frame ${index} is present`);
    assert.equal(frame.readUInt32BE(16), 320);
    assert.equal(frame.readUInt32BE(20), 180);
  }
  const firstFrame = entries.get('frame-000001.png');
  assert.notDeepEqual(firstFrame, entries.get('frame-000024.png'), 'Motion advances across frames');
  const frameDifferences = await page.evaluate(
    async ({ first, reference }) => {
      const decode = async (encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [a, b] = await Promise.all([decode(first), decode(reference)]);
      return a.reduce((count, channel, index) => count + (channel !== b[index] ? 1 : 0), 0);
    },
    {
      first: firstFrame.toString('base64'),
      reference: (await readFile(sequenceReferencePath)).toString('base64'),
    },
  );
  assert.equal(
    frameDifferences,
    0,
    'First lossless motion frame matches screenshot pixels exactly',
  );
  await page.getByLabel('Motion export format', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(results, 'lossless-motion-export.png') });
  check(
    'Lossless motion UI downloads 24 exact-size PNG frames, correct timing manifest, and an exact-pixel first frame',
  );
  assert.deepEqual(errors, []);
  const report = {
    checks: passed,
    sourceSha256: {
      design: createHash('sha256')
        .update(await readFile(designPath))
        .digest('hex'),
      mockup: createHash('sha256')
        .update(await readFile(triplePath))
        .digest('hex'),
    },
    errors,
  };
  await writeFile(path.join(results, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Multiscreen acceptance passed: ${passed.length} checks.`);
} catch (error) {
  if (page) {
    const snapshot = await page.locator('body').ariaSnapshot();
    await writeFile(path.join(results, 'failure-ui.txt'), snapshot);
    console.log(snapshot.slice(0, 6000));
    await page.screenshot({ path: path.join(results, 'failure.png') });
  }
  throw error;
} finally {
  await browser.close();
}
