import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PNG_SEQUENCE_LIMITS, renderFrameSequence } from '../src/engine/frame-sequence';
import { renderComposition } from '../src/engine/renderer';
import { createDefaults } from '../src/state/defaults';
import type { Assets, CompositionState } from '../src/types';

vi.mock('../src/engine/renderer', () => ({ renderComposition: vi.fn() }));
const assets = {
  mockup: { id: 'original' },
  design: null,
  background: null,
  foreground: null,
} as Assets;
const encode = vi.fn<() => Promise<Blob>>();
const canvases: FakeCanvas[] = [];
class FakeCanvas {
  width: number;
  height: number;
  ctx = { getImageData: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    canvases.push(this);
  }
  getContext() {
    return this.ctx;
  }
  convertToBlob = encode;
}
function composition(): CompositionState {
  const result = createDefaults();
  result.video = {
    ...result.video,
    width: 320,
    height: 180,
    fps: 2,
    duration: 1.1,
    format: 'png-sequence',
  };
  return result;
}

async function unpack(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const directoryStart = offset;
  const result = new Map<string, { data: Uint8Array; crc: number }>();
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    expect(view.getUint16(offset + 10, true)).toBe(0); // STORE; no transcoding.
    expect(view.getUint16(offset + 8, true)).toBe(0x0800);
    const size = view.getUint32(offset + 20, true);
    expect(view.getUint32(offset + 24, true)).toBe(size);
    const crc = view.getUint32(offset + 16, true);
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const local = view.getUint32(offset + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    expect(view.getUint32(local + 22, true)).toBe(size);
    expect(new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + nameLength))).toBe(
      name,
    );
    result.set(name, {
      data: bytes.slice(local + 30 + nameLength, local + 30 + nameLength + size),
      crc,
    });
    offset += 46 + nameLength;
  }
  expect(offset).toBe(end);
  expect(view.getUint32(end + 12, true)).toBe(offset - directoryStart);
  return result;
}

beforeEach(() => {
  canvases.length = 0;
  vi.mocked(renderComposition).mockReset();
  // A known CRC-32 check vector stands in for encoded bytes in the canvas mock.
  encode.mockReset().mockResolvedValue(new Blob(['123456789'], { type: 'image/png' }));
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
});
afterEach(() => vi.unstubAllGlobals());

describe('lossless PNG sequence', () => {
  it('packages unchanged frame bytes in a valid ZIP with CRC and accurate timing metadata', async () => {
    const progress = vi.fn();
    const result = await renderFrameSequence(composition(), assets, progress);
    expect(result.type).toBe('application/zip');
    const files = await unpack(result);
    expect([...files.keys()]).toEqual([
      'frame-000001.png',
      'frame-000002.png',
      'frame-000003.png',
      'manifest.json',
    ]);
    for (const [name, file] of files) {
      if (name.endsWith('.png')) {
        expect(new TextDecoder().decode(file.data)).toBe('123456789');
        expect(file.crc).toBe(0xcbf43926);
      }
    }
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!.data));
    expect(manifest).toMatchObject({
      width: 320,
      height: 180,
      fps: 2,
      duration: 1.1,
      frameCount: 3,
      colorSpace: 'srgb',
      bitDepth: 8,
      alpha: true,
    });
    expect(manifest.lastFrameDuration).toBeCloseTo(0.1);
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'Lossless PNG sequence ready',
      progress: 1,
    });
  });

  it('renders exact output dimensions and sample times with original assets and per-screen timeline motion', async () => {
    const original = composition();
    await renderFrameSequence(original, assets);
    const frames = vi.mocked(renderComposition).mock.calls.map(([frame]) => frame);
    expect(frames.map((frame) => frame.currentTime)).toEqual([0, 0.5, 1]);
    for (const frame of frames) {
      expect(frame).toMatchObject({ width: 320, height: 180, quality: 'export' });
      expect(frame.assets).toBe(assets);
      expect(frame.composition).not.toBe(original);
      expect(frame).not.toHaveProperty('scrollY');
      expect(frame).not.toHaveProperty('viewport');
    }
    expect(canvases[0].width).toBe(1);
    expect(canvases[0].height).toBe(1);
  });

  it('freezes job settings while the editor changes and ignores lossy codec/bitrate settings', async () => {
    const original = composition();
    original.video.bitrate = 0;
    original.video.mode = 'realtime';
    await renderFrameSequence(original, assets, ({ progress }) => {
      if (progress === 0) {
        original.video.width = 8000;
        original.video.fps = 120;
      }
    });
    expect(renderComposition).toHaveBeenCalledTimes(3);
    expect(vi.mocked(renderComposition).mock.calls[0][0].composition.video.width).toBe(320);
  });

  it('cancels before allocating a canvas', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      renderFrameSequence(composition(), assets, undefined, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvases).toHaveLength(0);
  });

  it('cancels between frames and releases the export canvas', async () => {
    const abort = new AbortController();
    await expect(
      renderFrameSequence(
        composition(),
        assets,
        ({ progress }) => {
          if (progress > 0) abort.abort();
        },
        abort.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderComposition).toHaveBeenCalledTimes(1);
    expect(canvases[0].width).toBe(1);
  });

  it('cancels while the PNG encoder is completing and does not package the frame', async () => {
    const abort = new AbortController();
    encode.mockImplementation(async () => {
      abort.abort();
      return new Blob(['123'], { type: 'image/png' });
    });
    await expect(
      renderFrameSequence(composition(), assets, undefined, abort.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvases[0].height).toBe(1);
  });

  it.each([
    ['width', 16385, 'safe canvas limit'],
    ['height', 0, 'positive whole pixels'],
    ['fps', 0, '120 FPS'],
    ['fps', 121, '120 FPS'],
    ['duration', 0, '3,600 seconds'],
    ['duration', Infinity, '3,600 seconds'],
    ['duration', 3601, '3,600 seconds'],
  ] as const)('rejects invalid %s=%s before allocation', async (key, value, message) => {
    const current = composition();
    current.video[key] = value;
    await expect(renderFrameSequence(current, assets)).rejects.toThrow(message);
    expect(canvases).toHaveLength(0);
  });

  it('requires a mockup and rejects frame counts that would exceed standard ZIP capacity', async () => {
    await expect(renderFrameSequence(composition(), { ...assets, mockup: null })).rejects.toThrow(
      'Add a mockup',
    );
    const current = composition();
    current.video.duration = 600;
    current.video.fps = 120;
    await expect(renderFrameSequence(current, assets)).rejects.toThrow('65,534 frames');
    expect(canvases).toHaveLength(0);
  });

  it('refuses archive overflow before reading a large PNG, without rescaling', async () => {
    class OversizedBlob extends Blob {
      override get size() {
        return PNG_SEQUENCE_LIMITS.maxBytes;
      }
      override stream = vi.fn(() => {
        throw new Error('Must reject before reading');
      });
    }
    const huge = new OversizedBlob(['x'], { type: 'image/png' });
    encode.mockResolvedValue(huge);
    await expect(renderFrameSequence(composition(), assets)).rejects.toThrow(
      '512 MB archive limit',
    );
    expect(huge.stream).not.toHaveBeenCalled();
    expect(renderComposition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(renderComposition).mock.calls[0][0].width).toBe(320);
    expect(canvases[0].width).toBe(1);
  });

  it.each(['image/jpeg', ''])(
    'rejects %s instead of silently substituting an export format',
    async (type) => {
      encode.mockResolvedValue(new Blob(['123'], { type }));
      await expect(renderFrameSequence(composition(), assets)).rejects.toThrow(
        'valid lossless PNG frame',
      );
      expect(canvases[0].height).toBe(1);
    },
  );

  it('releases the canvas on render or encoding failure', async () => {
    vi.mocked(renderComposition).mockImplementation(() => {
      throw new Error('Allocation failed');
    });
    await expect(renderFrameSequence(composition(), assets)).rejects.toThrow('Allocation failed');
    expect(canvases[0].width).toBe(1);
  });

  it('supports a browser HTML canvas when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const html = {
      width: 0,
      height: 0,
      getContext: () => ({ getImageData: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(new Blob(['123456789'], { type: 'image/png' })),
    };
    vi.stubGlobal('document', { createElement: () => html });
    expect((await unpack(await renderFrameSequence(composition(), assets))).size).toBe(4);
    expect(html.width).toBe(1);
  });
});
