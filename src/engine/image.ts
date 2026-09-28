import type { ImageAsset } from '../types';

interface RasterDimensions {
  width: number;
  height: number;
}

/** Read dimensions directly from the original bytes, without creating a thumbnail. */
export async function readRasterDimensions(blob: Blob): Promise<RasterDimensions | null> {
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (
    bytes.length >= 25 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X' && bytes.length >= 30)
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    if (
      chunk === 'VP8 ' &&
      bytes.length >= 30 &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    )
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    // JPEG segments can contain large ICC/EXIF payloads. Skip payloads instead of
    // loading the complete file (or assuming the frame header is in the first KB).
    let offset = 2;
    for (let segment = 0; segment < 4096 && offset + 4 <= blob.size; segment++) {
      const header = new Uint8Array(await blob.slice(offset, offset + 9).arrayBuffer());
      if (header[0] !== 0xff) return null;
      const marker = header[1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
        offset += 2;
        continue;
      }
      const length = (header[2] << 8) | header[3];
      if (length < 2 || offset + 2 + length > blob.size) return null;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc &&
        header.length >= 9
      )
        return {
          width: (header[7] << 8) | header[8],
          height: (header[5] << 8) | header[6],
        };
      offset += 2 + length;
    }
  }
  return null;
}

export async function loadImage(blob: Blob, name: string): Promise<ImageAsset> {
  if (/\.fig$/i.test(name))
    throw new Error(
      'Direct .fig rendering is not currently supported. Export your Figma frame as PNG, JPG, WebP or SVG for pixel-perfect rendering.',
    );
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(blob.type))
    throw new Error('Choose a PNG, JPG, WebP or SVG image.');
  if (blob.size > 1024 * 1024 * 1024)
    throw new Error(
      'This image exceeds the 1 GB import limit. Export a smaller frame and try again.',
    );
  if (blob.type === 'image/svg+xml') {
    const svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    if (
      svg.querySelector('parsererror,script,foreignObject') ||
      [...svg.querySelectorAll('*')].some((el) =>
        [...el.attributes].some(
          (a) =>
            /^on/i.test(a.name) || (/href$/.test(a.name) && !/^(#|data:image\/)/.test(a.value)),
        ),
      )
    )
      throw new Error(
        'Use a self-contained SVG without scripts or external resources, or export a PNG.',
      );
  }
  const url = URL.createObjectURL(blob);
  let bitmap: ImageBitmap | HTMLImageElement | undefined;
  try {
    const sourceDimensions = await readRasterDimensions(blob);
    try {
      // No resize options or intermediary canvas: retain the full decoded source.
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      const img = new Image();
      img.src = url;
      await img.decode();
      bitmap = img;
    }
    const width = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
    const height = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
    if (!width || !height) throw new Error('Empty image');
    if (
      sourceDimensions &&
      !(
        (width === sourceDimensions.width && height === sourceDimensions.height) ||
        (width === sourceDimensions.height && height === sourceDimensions.width)
      )
    )
      throw new Error(
        `This browser decoded the ${sourceDimensions.width} × ${sourceDimensions.height} source at ${width} × ${height}. Import was stopped to preserve the original resolution. Try a browser with more available memory.`,
      );
    return {
      id: crypto.randomUUID(),
      name,
      blob,
      url,
      bitmap,
      width,
      height,
      type: blob.type,
      size: blob.size,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    if (bitmap && typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap)
      bitmap.close();
    if (error instanceof Error && error.message.startsWith('This browser decoded')) throw error;
    throw new Error(
      'This image could not be decoded. It may be damaged or exceed this browser’s memory limit.',
    );
  }
}
export function releaseImage(asset: ImageAsset | null) {
  if (asset) {
    URL.revokeObjectURL(asset.url);
    if (typeof ImageBitmap !== 'undefined' && asset.bitmap instanceof ImageBitmap)
      asset.bitmap.close();
  }
}
export async function loadSample(name: 'mockup' | 'design') {
  const response = await fetch(
    `${import.meta.env.BASE_URL}assets/demo-${name}.${name === 'mockup' ? 'png' : 'jpg'}`,
  );
  if (!response.ok)
    throw new Error('The sample image could not be loaded. Upload an image to begin.');
  return loadImage(
    await response.blob(),
    name === 'mockup' ? 'Studio Display.png' : 'Portfolio — Figma export.jpg',
  );
}
export const fileSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
