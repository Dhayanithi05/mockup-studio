import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectCapabilities,
  estimateVideoSize,
  renderVideo,
  setWebmDuration,
  validateExportDimensions,
  validateVideoSettings,
} from '../src/engine/export';
import type { Assets, VideoSettings } from '../src/types';
import { createDefaults } from '../src/state/defaults';

const settings: VideoSettings = {
  width: 3840,
  height: 2160,
  fps: 60,
  bitrate: 48,
  duration: 10,
  codec: 'auto',
  mode: 'maximum',
};

afterEach(() => vi.unstubAllGlobals());

describe('export dimensions and memory safety', () => {
  it('accepts exact UHD and 8K sizes without reducing pixels', () => {
    expect(validateExportDimensions(3840, 2160)).toEqual({
      width: 3840,
      height: 2160,
      pixels: 8_294_400,
    });
    expect(validateExportDimensions(7680, 4320).width).toBe(7680);
  });
  it.each([
    [0, 1080],
    [1920, -1],
    [1920.5, 1080],
    [NaN, 1080],
    [Infinity, 1080],
  ])('rejects invalid dimensions %s × %s', (width, height) => {
    expect(() => validateExportDimensions(width, height)).toThrow('positive whole pixels');
  });
  it('rejects excessive allocations instead of changing the requested resolution', () => {
    expect(() => validateExportDimensions(16385, 2)).toThrow('safe canvas limit');
    expect(() => validateExportDimensions(12000, 12000)).toThrow('safe canvas limit');
  });
  it('converts megabits to estimated bytes including container overhead', () => {
    expect(estimateVideoSize({ bitrate: 48, duration: 10 })).toBe(61_200_000);
    expect(estimateVideoSize({ bitrate: 0, duration: 10 })).toBe(0);
  });
  it('prevents excessive in-memory video output', () => {
    expect(() => validateVideoSettings({ ...settings, duration: 600 })).toThrow('1 GB');
    expect(() => validateVideoSettings({ ...settings, fps: 121 })).toThrow('120 FPS');
  });
});

describe('codec detection', () => {
  it('never silently substitutes real-time recording for frame-by-frame export', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('VideoFrame', undefined);
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    class Canvas {
      captureStream() {}
    }
    vi.stubGlobal('HTMLCanvasElement', Canvas);
    const composition = createDefaults();
    composition.video = { ...settings, mode: 'maximum' };
    const progress = vi.fn();
    await expect(renderVideo(composition, { mockup: {} } as Assets, progress)).rejects.toThrow(
      'Frame-by-frame export is unavailable',
    );
    expect(progress).not.toHaveBeenCalledWith(
      expect.objectContaining({ phase: expect.stringContaining('Using real-time') }),
    );
  });
  it('checks the exact requested resolution, framerate and bits per second', async () => {
    const check = vi.fn(async (config: VideoEncoderConfig) => ({
      supported: config.codec.startsWith('vp09'),
      config,
    }));
    vi.stubGlobal('VideoEncoder', { isConfigSupported: check });
    vi.stubGlobal('VideoFrame', class {});
    const result = await detectCapabilities(settings);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ width: 3840, height: 2160, framerate: 60, bitrate: 48_000_000 }),
    );
    expect(result.recommendedCodec).toBe('vp9');
    expect(result.codecs.find((codec) => codec.id === 'av1')?.webCodecs).toBe(false);
    expect(result.codecs.every((codec) => codec.mimeType.startsWith('video/webm'))).toBe(true);
  });
  it('returns explicit unsupported results when browser APIs are absent', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('MediaRecorder', undefined);
    const result = await detectCapabilities(settings);
    expect(result.recommendedCodec).toBeNull();
    expect(result.webCodecs).toBe(false);
    expect(result.mediaRecorder).toBe(false);
    expect(result.diagnostics.join(' ')).toContain('WebCodecs is unavailable');
  });
  it('does not call browser encoders for unsafe requested dimensions', async () => {
    const check = vi.fn();
    vi.stubGlobal('VideoEncoder', { isConfigSupported: check });
    vi.stubGlobal('VideoFrame', class {});
    const result = await detectCapabilities({ ...settings, width: 20000 });
    expect(check).not.toHaveBeenCalled();
    expect(result.recommendedCodec).toBeNull();
  });
});

describe('WebM duration metadata', () => {
  it('sets full requested duration rather than the last frame start', () => {
    // Segment (unknown size), Info, then an eight-byte Duration float.
    const bytes = new Uint8Array([
      0x18, 0x53, 0x80, 0x67, 0xff, 0x15, 0x49, 0xa9, 0x66, 0x8b, 0x44, 0x89, 0x88, 0, 0, 0, 0, 0,
      0, 0, 0,
    ]);
    setWebmDuration(bytes.buffer, 12000);
    expect(new DataView(bytes.buffer).getFloat64(13)).toBe(12000);
    expect(bytes.slice(0, 13)).toEqual(
      new Uint8Array([
        0x18, 0x53, 0x80, 0x67, 0xff, 0x15, 0x49, 0xa9, 0x66, 0x8b, 0x44, 0x89, 0x88,
      ]),
    );
  });
  it('rejects malformed containers instead of patching arbitrary bytes', () => {
    expect(() => setWebmDuration(new ArrayBuffer(4), 1000)).toThrow('duration metadata');
  });
});
