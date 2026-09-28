import type { Assets, CompositionState, ExportProgress } from '../types';
import { validateExportDimensions } from './export';
import { renderComposition } from './renderer';

export const PNG_SEQUENCE_LIMITS = { maxBytes: 512 * 1024 * 1024, maxFrames: 65534 } as const;
type ExportCanvas = HTMLCanvasElement | OffscreenCanvas;
type ExportContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

async function checksum(blob: Blob, signal?: AbortSignal): Promise<number> {
  // Stream the checksum so a large PNG does not need a second full-size byte buffer.
  const reader = blob.stream().getReader();
  let crc = 0xffffffff;
  let sinceYield = 0;
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      sinceYield += value.length;
      if (sinceYield >= 4 * 1024 * 1024) {
        sinceYield = 0;
        await yieldToBrowser();
      }
    }
    checkAbort(signal);
    return (crc ^ 0xffffffff) >>> 0;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** ZIP STORE retains the PNG bytes; PNG already provides lossless compression. */
class PngArchive {
  private parts: BlobPart[] = [];
  private directory: Uint8Array[] = [];
  private offset = 0;
  private directoryBytes = 0;

  async add(name: string, blob: Blob, signal?: AbortSignal) {
    const filename = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + filename.length);
    const central = new Uint8Array(46 + filename.length);
    const projected =
      this.offset + local.length + blob.size + this.directoryBytes + central.length + 22;
    if (projected > PNG_SEQUENCE_LIMITS.maxBytes)
      throw new Error(
        'The lossless PNG sequence exceeds the 512 MB archive limit. Export a shorter duration; resolution and quality were not reduced.',
      );
    if (this.directory.length >= 65535)
      throw new Error('This PNG sequence exceeds the ZIP entry limit. Export a shorter duration.');
    const crc = await checksum(blob, signal);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 filenames.
    header.setUint16(12, 0x0021, true); // Stable valid DOS date: 1980-01-01.
    header.setUint32(14, crc, true);
    header.setUint32(18, blob.size, true);
    header.setUint32(22, blob.size, true);
    header.setUint16(26, filename.length, true);
    local.set(filename, 30);

    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x0021, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, blob.size, true);
    entry.setUint32(24, blob.size, true);
    entry.setUint16(28, filename.length, true);
    entry.setUint32(42, this.offset, true);
    central.set(filename, 46);
    this.parts.push(local, blob);
    this.directory.push(central);
    this.offset += local.length + blob.size;
    this.directoryBytes += central.length;
  }

  finish(): Blob {
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.directory.length, true);
    view.setUint16(10, this.directory.length, true);
    view.setUint32(12, this.directoryBytes, true);
    view.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.directory, end], { type: 'application/zip' });
  }
}

function encodePng(canvas: ExportCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The browser could not encode a lossless PNG frame.')),
      'image/png',
    ),
  );
}

/** Full-resolution, deterministic motion frames with transparent pixels preserved. */
export async function renderFrameSequence(
  composition: CompositionState,
  assets: Assets,
  onProgress: (value: ExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<Blob> {
  checkAbort(signal);
  if (!assets.mockup) throw new Error('Add a mockup image before exporting.');
  const snapshot = structuredClone(composition);
  const { width, height, duration, fps } = snapshot.video;
  validateExportDimensions(width, height);
  if (!Number.isFinite(fps) || fps < 1 || fps > 120)
    throw new Error('PNG sequence frame rate must be between 1 and 120 FPS.');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600)
    throw new Error('PNG sequence duration must be greater than zero and at most 3,600 seconds.');
  const frameCount = Math.ceil(duration * fps);
  if (frameCount > PNG_SEQUENCE_LIMITS.maxFrames)
    throw new Error(
      `A PNG sequence supports at most ${PNG_SEQUENCE_LIMITS.maxFrames.toLocaleString('en-US')} frames. Export a shorter duration.`,
    );

  const canvas: ExportCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d', { alpha: true }) as ExportContext | null;
    if (!ctx)
      throw new Error(`The browser could not allocate a ${width} × ${height} export canvas.`);
    ctx.getImageData(0, 0, 1, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const archive = new PngArchive();
    onProgress({ phase: 'Preparing lossless PNG frames…', progress: 0 });
    for (let index = 0; index < frameCount; index++) {
      checkAbort(signal);
      renderComposition({
        ctx,
        width,
        height,
        composition: snapshot,
        assets,
        currentTime: index / fps,
        quality: 'export',
      });
      const png = await encodePng(canvas);
      checkAbort(signal);
      if (png.type !== 'image/png' || png.size === 0)
        throw new Error('The browser did not produce a valid lossless PNG frame.');
      await archive.add(`frame-${String(index + 1).padStart(6, '0')}.png`, png, signal);
      onProgress({
        phase: `Rendering lossless frame ${index + 1} of ${frameCount}`,
        progress: ((index + 1) / frameCount) * 0.98,
      });
      await yieldToBrowser();
    }
    checkAbort(signal);
    await archive.add(
      'manifest.json',
      new Blob(
        [
          JSON.stringify(
            {
              format: 'png-sequence',
              width,
              height,
              fps,
              duration,
              frameCount,
              firstFrame: 'frame-000001.png',
              filenamePattern: 'frame-%06d.png',
              firstFrameTime: 0,
              frameInterval: 1 / fps,
              lastFrameDuration: duration - (frameCount - 1) / fps,
              colorSpace: 'srgb',
              bitDepth: 8,
              alpha: true,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      signal,
    );
    checkAbort(signal);
    const result = archive.finish();
    onProgress({ phase: 'Lossless PNG sequence ready', progress: 1 });
    return result;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
