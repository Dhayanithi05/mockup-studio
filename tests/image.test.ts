import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadImage, readRasterDimensions, releaseImage } from '../src/engine/image';

function png(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: 'image/png' });
}
function setupDecoder(width: number, height: number, fallback = false) {
  class Bitmap {
    width = width;
    height = height;
    close = vi.fn();
  }
  class HtmlImage {
    src = '';
    naturalWidth = width;
    naturalHeight = height;
    decode = vi.fn(async () => {});
  }
  const decoded = new Bitmap();
  const decode = fallback
    ? vi.fn().mockRejectedValue(new Error('No bitmap support'))
    : vi.fn().mockResolvedValue(decoded);
  vi.stubGlobal('ImageBitmap', Bitmap);
  vi.stubGlobal('HTMLImageElement', HtmlImage);
  vi.stubGlobal('Image', HtmlImage);
  vi.stubGlobal('createImageBitmap', decode);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { decoded, decode, revoke };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('original source preservation', () => {
  it('retains the exact uploaded Blob and decodes tall artwork without resize options', async () => {
    const { decode, decoded } = setupDecoder(3000, 24000);
    const original = png(3000, 24000);
    const asset = await loadImage(original, 'full-design.png');
    expect(asset.blob).toBe(original);
    expect(asset.bitmap).toBe(decoded);
    expect(asset.width).toBe(3000);
    expect(asset.height).toBe(24000);
    expect(decode).toHaveBeenCalledWith(original, { imageOrientation: 'from-image' });
    expect(new Uint8Array(await asset.blob.arrayBuffer())).toEqual(
      new Uint8Array(await original.arrayBuffer()),
    );
  });
  it('accepts EXIF-oriented dimension swaps without treating them as downsizing', async () => {
    setupDecoder(800, 1200);
    expect((await loadImage(png(1200, 800), 'oriented.png')).width).toBe(800);
  });
  it('rejects browser-downsized pixels and releases the failed full-resolution import', async () => {
    const { decoded, revoke } = setupDecoder(1500, 12000);
    await expect(loadImage(png(3000, 24000), 'full-design.png')).rejects.toThrow(
      'preserve the original resolution',
    );
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:original');
  });
  it('checks native dimensions on the HTML image fallback too', async () => {
    setupDecoder(1500, 12000, true);
    await expect(loadImage(png(3000, 24000), 'full-design.png')).rejects.toThrow(
      'preserve the original resolution',
    );
  });
  it('releases the original image resources after replacement', async () => {
    const { decoded, revoke } = setupDecoder(1200, 800);
    const asset = await loadImage(png(1200, 800), 'mockup.png');
    releaseImage(asset);
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:original');
  });
});

describe('original image dimension headers', () => {
  it('reads PNG dimensions without decoding or scaling', async () => {
    expect(await readRasterDimensions(png(3000, 24000))).toEqual({ width: 3000, height: 24000 });
  });
  it('skips JPEG metadata payloads to locate progressive frame dimensions', async () => {
    const bytes = new Uint8Array(120);
    bytes.set([0xff, 0xd8, 0xff, 0xe1, 0, 100]);
    bytes.set([0xff, 0xc2, 0, 11, 8, 0x03, 0x20, 0x04, 0xb0], 104);
    expect(await readRasterDimensions(new Blob([bytes]))).toEqual({ width: 1200, height: 800 });
  });
  it.each(['VP8X', 'VP8 ', 'VP8L'])('reads %s WebP pixel dimensions', async (chunk) => {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    bytes.set(new TextEncoder().encode('WEBP'), 8);
    bytes.set(new TextEncoder().encode(chunk), 12);
    if (chunk === 'VP8X') {
      bytes.set([0xaf, 0x04, 0, 0x1f, 0x03, 0], 24);
    } else if (chunk === 'VP8 ') {
      bytes.set([0x9d, 0x01, 0x2a], 23);
      view.setUint16(26, 1200, true);
      view.setUint16(28, 800, true);
    } else {
      bytes[20] = 0x2f;
      view.setUint32(21, 1199 | (799 << 14), true);
    }
    expect(await readRasterDimensions(new Blob([bytes]))).toEqual({ width: 1200, height: 800 });
  });
  it('allows the decoder to reject malformed or unsupported source headers', async () => {
    expect(await readRasterDimensions(new Blob([new Uint8Array([1, 2, 3])]))).toBeNull();
  });
});
