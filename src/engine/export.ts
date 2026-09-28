import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import { completeRecordedWebm } from './webm';
import type { Assets, CompositionState, ExportProgress, VideoSettings } from '../types';
import { renderComposition } from './renderer';

export const EXPORT_LIMITS = {
  maxDimension: 16384,
  maxPixels: 100_000_000,
  maxVideoBytes: 1_000_000_000,
} as const;
type CodecId = Exclude<VideoSettings['codec'], 'auto'>;
export interface CodecCapability {
  id: CodecId;
  label: string;
  webCodecs: boolean;
  mediaRecorder: boolean;
  config?: VideoEncoderConfig;
  mimeType: string;
}
export interface ExportCapabilities {
  webCodecs: boolean;
  mediaRecorder: boolean;
  codecs: CodecCapability[];
  recommendedCodec: CodecId | null;
  diagnostics: string[];
}
export interface VideoExportResult {
  blob: Blob;
  extension: 'webm';
  codec: string;
  mode: 'WebCodecs' | 'MediaRecorder';
}

/** Refuse unsupported sizes explicitly; an export must never silently shrink. */
export function validateExportDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error(
      'Export width and height must be positive whole pixels. Choose dimensions and scale that produce whole pixels.',
    );
  }
  const pixels = width * height;
  if (
    width > EXPORT_LIMITS.maxDimension ||
    height > EXPORT_LIMITS.maxDimension ||
    pixels > EXPORT_LIMITS.maxPixels
  ) {
    throw new Error(
      `The requested ${width} × ${height} export exceeds the safe canvas limit (${EXPORT_LIMITS.maxDimension}px per side, 100 megapixels). Choose smaller dimensions or scale; the app will not reduce them automatically.`,
    );
  }
  return { width, height, pixels };
}

/** Approximate encoded bytes, including a small allowance for container overhead. */
export function estimateVideoSize(settings: Pick<VideoSettings, 'bitrate' | 'duration'>): number {
  if (
    !Number.isFinite(settings.bitrate) ||
    !Number.isFinite(settings.duration) ||
    settings.bitrate <= 0 ||
    settings.duration <= 0
  )
    return 0;
  return Math.ceil(((settings.bitrate * 1_000_000) / 8) * settings.duration * 1.02);
}

export function validateVideoSettings(settings: VideoSettings) {
  validateExportDimensions(settings.width, settings.height);
  if (!Number.isFinite(settings.fps) || settings.fps < 1 || settings.fps > 120)
    throw new Error('Video frame rate must be between 1 and 120 FPS.');
  if (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0 || settings.bitrate > 500)
    throw new Error('Video bitrate must be greater than zero and at most 500 Mbps.');
  if (!Number.isFinite(settings.duration) || settings.duration <= 0 || settings.duration > 3600)
    throw new Error('Video duration must be greater than zero and at most 3,600 seconds.');
  if (estimateVideoSize(settings) > EXPORT_LIMITS.maxVideoBytes)
    throw new Error(
      'The estimated video exceeds the 1 GB in-memory export limit. Reduce duration or bitrate and export in shorter sections.',
    );
}

type ExportCanvas = HTMLCanvasElement | OffscreenCanvas;
type ExportContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas(
  width: number,
  height: number,
  html = false,
): { canvas: ExportCanvas; ctx: ExportContext } {
  validateExportDimensions(width, height);
  const canvas =
    !html && typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true }) as ExportContext | null;
  if (!ctx) {
    canvas.width = canvas.height = 1;
    throw new Error(
      `This browser could not allocate a ${width} × ${height} export canvas. Try smaller dimensions or close other tabs.`,
    );
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Canvas allocation may fail lazily. A read also identifies a lost 2D context.
  try {
    ctx.getImageData(0, 0, 1, 1);
  } catch {
    canvas.width = canvas.height = 1;
    throw new Error(
      `The browser cannot render a ${width} × ${height} canvas with available memory.`,
    );
  }
  return { canvas, ctx };
}

function flatten(ctx: ExportContext, width: number, height: number, color: string) {
  ctx.save();
  ctx.resetTransform();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function encodeCanvas(canvas: ExportCanvas, mime: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: mime, quality });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error('The browser could not encode this image. Try a smaller output size.'),
            ),
      mime,
      quality,
    ),
  );
}

export async function captureScreenshot(
  composition: CompositionState,
  assets: Assets,
  currentTime = 0,
): Promise<Blob> {
  if (!assets.mockup) throw new Error('Add a mockup image before exporting.');
  const { scale, format, quality } = composition.screenshot;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('Screenshot scale must be greater than zero.');
  const { width, height } = validateExportDimensions(
    composition.output.width * scale,
    composition.output.height * scale,
  );
  const { canvas, ctx } = createCanvas(width, height);
  try {
    renderComposition({
      ctx,
      width,
      height,
      composition,
      assets,
      currentTime,
      quality: 'export',
      scrollY: composition.scrollY,
    });
    if (format === 'jpeg') flatten(ctx, width, height, '#ffffff');
    const mime = `image/${format}`;
    const normalizedQuality = Math.min(1, Math.max(0, quality > 1 ? quality / 100 : quality));
    const blob = await encodeCanvas(canvas, mime, normalizedQuality);
    if (blob.type !== mime)
      throw new Error(
        `This browser does not support ${format.toUpperCase()} export. Choose PNG instead.`,
      );
    return blob;
  } finally {
    canvas.width = canvas.height = 1;
  }
}

const defaultVideo: VideoSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  bitrate: 24,
  duration: 8,
  codec: 'auto',
  mode: 'maximum',
};

function codecCandidates(id: CodecId, settings: VideoSettings): string[] {
  if (id === 'vp8') return ['vp8'];
  const pixelsPerSecond = settings.width * settings.height * settings.fps;
  if (id === 'vp9') {
    const level =
      pixelsPerSecond > 534_773_760 || settings.width * settings.height > 8_912_896
        ? '61'
        : pixelsPerSecond > 133_693_440
          ? '51'
          : '41';
    return [`vp09.00.${level}.08`];
  }
  const level =
    pixelsPerSecond > 534_773_760 || settings.width * settings.height > 8_912_896
      ? '17'
      : pixelsPerSecond > 141_557_760
        ? '13'
        : '09';
  return [`av01.0.${level}M.08`];
}

/** Each WebCodecs entry is tested using the requested dimensions, FPS and bitrate. */
export async function detectCapabilities(
  settings: VideoSettings = defaultVideo,
): Promise<ExportCapabilities> {
  const webCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  const mediaRecorder =
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
  const diagnostics: string[] = [];
  let valid = true;
  try {
    validateVideoSettings(settings);
  } catch (error) {
    valid = false;
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  if (!webCodecs)
    diagnostics.push(
      'WebCodecs is unavailable. A secure context (HTTPS or localhost) and a compatible browser are required for frame-by-frame export.',
    );
  if (!mediaRecorder)
    diagnostics.push('Canvas MediaRecorder export is unavailable in this browser.');
  const codecs: CodecCapability[] = await Promise.all(
    (['vp9', 'av1', 'vp8'] as const).map(async (id) => {
      const mimeType = `video/webm;codecs=${id}`;
      const result: CodecCapability = {
        id,
        label: id.toUpperCase(),
        webCodecs: false,
        mediaRecorder: valid && mediaRecorder && MediaRecorder.isTypeSupported(mimeType),
        mimeType,
      };
      if (webCodecs && valid) {
        for (const codec of codecCandidates(id, settings)) {
          const config: VideoEncoderConfig = {
            codec,
            width: settings.width,
            height: settings.height,
            bitrate: Math.round(settings.bitrate * 1_000_000),
            framerate: settings.fps,
            latencyMode: 'quality',
            hardwareAcceleration: 'no-preference',
            alpha: 'discard',
          };
          try {
            const supported = await VideoEncoder.isConfigSupported(config);
            if (supported.supported) {
              result.webCodecs = true;
              result.config = config;
              break;
            }
          } catch {
            /* Unsupported codecs/configurations are normal capability results. */
          }
        }
      }
      return result;
    }),
  );
  if (valid && !codecs.some((codec) => codec.webCodecs))
    diagnostics.push(
      `No WebCodecs encoder accepted ${settings.width} × ${settings.height} at ${settings.fps} FPS. Real-time recording may still be available.`,
    );
  if (mediaRecorder)
    diagnostics.push(
      'Real-time recording requires this tab to remain visible. FPS and bitrate are browser targets; encoded output can vary with system performance.',
    );
  diagnostics.push(
    'Video exports use WebM. MP4 is not offered by this exporter. Transparent areas are flattened to black in video and white in JPEG.',
  );
  return {
    webCodecs,
    mediaRecorder,
    codecs,
    recommendedCodec:
      (codecs.find((codec) => codec.webCodecs) ?? codecs.find((codec) => codec.mediaRecorder))
        ?.id ?? null,
    diagnostics,
  };
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** webm-muxer 5 reports the final frame's start time. Include its duration in the container metadata. */
export function setWebmDuration(buffer: ArrayBuffer, milliseconds: number): void {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const find = (
    start: number,
    end: number,
    wanted: number,
  ): { start: number; end: number } | null => {
    let offset = start;
    while (offset < end) {
      let length = 1;
      let marker = 0x80;
      while (length <= 4 && !(bytes[offset] & marker)) {
        length++;
        marker >>= 1;
      }
      if (length > 4 || offset + length >= end) return null;
      let id = 0;
      for (let i = 0; i < length; i++) id = id * 256 + bytes[offset++];
      length = 1;
      marker = 0x80;
      while (length <= 8 && !(bytes[offset] & marker)) {
        length++;
        marker >>= 1;
      }
      if (length > 8 || offset + length > end) return null;
      let size = bytes[offset++] & (marker - 1);
      let unknown = size === marker - 1;
      for (let i = 1; i < length; i++) {
        const value = bytes[offset++];
        unknown &&= value === 255;
        size = size * 256 + value;
      }
      const elementEnd = unknown ? end : Math.min(end, offset + size);
      if (id === wanted) return { start: offset, end: elementEnd };
      if (elementEnd <= offset) return null;
      offset = elementEnd;
    }
    return null;
  };
  const segment = find(0, bytes.length, 0x18538067);
  const info = segment && find(segment.start, segment.end, 0x1549a966);
  const duration = info && find(info.start, info.end, 0x4489);
  if (!duration || duration.end - duration.start !== 8)
    throw new Error('The WebM container is missing its duration metadata.');
  view.setFloat64(duration.start, milliseconds, false);
}

function renderFrame(
  ctx: ExportContext,
  composition: CompositionState,
  assets: Assets,
  time: number,
) {
  const { width, height } = composition.video;
  renderComposition({
    ctx,
    width,
    height,
    composition,
    assets,
    currentTime: time,
    quality: 'export',
  });
  flatten(ctx, width, height, '#000000');
}

async function encodeFrames(
  composition: CompositionState,
  assets: Assets,
  codec: CodecCapability,
  onProgress: (value: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<VideoExportResult> {
  const { width, height, duration, fps } = composition.video;
  const { canvas, ctx } = createCanvas(width, height);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: { vp9: 'V_VP9', vp8: 'V_VP8', av1: 'V_AV1' }[codec.id],
      width,
      height,
      frameRate: fps,
    },
    firstTimestampBehavior: 'strict',
  });
  const frameCount = Math.ceil(duration * fps);
  let encodedFrames = 0;
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      try {
        muxer.addVideoChunk(chunk, metadata);
        encodedFrames++;
      } catch (error) {
        encoderError = error instanceof Error ? error : new Error(String(error));
      }
    },
    error: (error) => {
      encoderError = error;
    },
  });
  const abort = () => {
    if (encoder.state !== 'closed') encoder.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    encoder.configure(codec.config!);
    for (let i = 0; i < frameCount; i++) {
      checkAbort(signal);
      if (encoderError) throw encoderError;
      while (encoder.encodeQueueSize >= 4) {
        await new Promise<void>((resolve) => setTimeout(resolve, 4));
        checkAbort(signal);
        if (encoderError) throw encoderError;
      }
      renderFrame(ctx, composition, assets, i / fps);
      const timestamp = Math.round((i * 1_000_000) / fps);
      const nextTimestamp = Math.round(Math.min((i + 1) / fps, duration) * 1_000_000);
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: nextTimestamp - timestamp,
        alpha: 'discard',
      });
      try {
        encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      } finally {
        frame.close();
      }
      onProgress({
        phase: `Rendering frame ${i + 1} of ${frameCount} · ${codec.label}`,
        progress: ((i + 1) / frameCount) * 0.94,
      });
      if (i % 4 === 0) await yieldToBrowser();
    }
    onProgress({ phase: 'Finishing encoded frames…', progress: 0.95 });
    await encoder.flush();
    checkAbort(signal);
    if (encoderError) throw encoderError;
    if (encodedFrames !== frameCount)
      throw new Error(
        `The encoder returned ${encodedFrames} of ${frameCount} frames. Export failed to avoid an incomplete video.`,
      );
    onProgress({ phase: 'Packaging WebM…', progress: 0.98 });
    muxer.finalize();
    setWebmDuration(target.buffer, duration * 1000);
    const blob = new Blob([target.buffer], { type: 'video/webm' });
    onProgress({ phase: 'Video ready', progress: 1 });
    return { blob, extension: 'webm', codec: codec.label, mode: 'WebCodecs' };
  } catch (error) {
    checkAbort(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (encoder.state !== 'closed') encoder.close();
    canvas.width = canvas.height = 1;
  }
}

async function recordRealtime(
  composition: CompositionState,
  assets: Assets,
  codec: CodecCapability,
  onProgress: (value: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<VideoExportResult> {
  const { width, height, duration, fps, bitrate } = composition.video;
  const { canvas, ctx } = createCanvas(width, height, true);
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let raf = 0;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let visibilityListener: (() => void) | undefined;
  try {
    checkAbort(signal);
    if (document.hidden) throw new Error('Keep this tab visible while using real-time recording.');
    renderFrame(ctx, composition, assets, 0);
    stream = (canvas as HTMLCanvasElement).captureStream(fps);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('The browser could not capture the export canvas.');
    const trackSettings = track.getSettings();
    if (
      (trackSettings.width && trackSettings.width !== width) ||
      (trackSettings.height && trackSettings.height !== height)
    )
      throw new Error(
        `The browser capture stream changed the requested ${width} × ${height} dimensions. Choose a supported resolution.`,
      );
    recorder = new MediaRecorder(stream, {
      mimeType: codec.mimeType,
      videoBitsPerSecond: Math.round(bitrate * 1_000_000),
    });
    const activeRecorder = recorder;
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      let settled = false;
      let start = 0;
      let lastFrame = -1;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cancelAnimationFrame(raf);
        if (activeRecorder.state !== 'inactive') activeRecorder.stop();
        reject(error);
      };
      abortListener = () => fail(new DOMException('Export cancelled.', 'AbortError'));
      visibilityListener = () => {
        if (document.hidden)
          fail(
            new Error(
              'Real-time export stopped because the tab was hidden. Keep this tab visible or choose Maximum quality mode.',
            ),
          );
      };
      signal?.addEventListener('abort', abortListener, { once: true });
      document.addEventListener('visibilitychange', visibilityListener);
      activeRecorder.ondataavailable = (event) => {
        if (!settled && event.data.size) chunks.push(event.data);
      };
      activeRecorder.onerror = () =>
        fail(
          new Error('The browser video recorder failed. Try a lower resolution or another codec.'),
        );
      activeRecorder.onstop = () => {
        if (settled) return;
        settled = true;
        const result = new Blob(chunks, { type: 'video/webm' });
        if (result.size) resolve(result);
        else reject(new Error('The browser recorder produced an empty video.'));
      };
      const tick = (now: number) => {
        if (settled || activeRecorder.state === 'inactive') return;
        try {
          checkAbort(signal);
          const elapsed = Math.min((now - start) / 1000, duration);
          const index = Math.floor(elapsed * fps);
          if (index !== lastFrame) {
            renderFrame(ctx, composition, assets, elapsed);
            lastFrame = index;
          }
          onProgress({
            phase: `Recording ${elapsed.toFixed(1)} / ${duration}s · keep this tab visible`,
            progress: (elapsed / duration) * 0.97,
          });
          if (elapsed >= duration) {
            activeRecorder.stop();
            return;
          }
          raf = requestAnimationFrame(tick);
        } catch (error) {
          fail(error);
        }
      };
      activeRecorder.onstart = () => {
        start = performance.now();
        raf = requestAnimationFrame(tick);
        finishTimer = setTimeout(
          () => {
            if (!settled && activeRecorder.state !== 'inactive') activeRecorder.stop();
          },
          duration * 1000 + 30,
        );
      };
      activeRecorder.start(500);
    });
    checkAbort(signal);
    onProgress({ phase: 'Video ready', progress: 1 });
    const finalized = new Blob([completeRecordedWebm(await blob.arrayBuffer(), duration * 1000)], {
      type: 'video/webm',
    });
    return { blob: finalized, extension: 'webm', codec: codec.label, mode: 'MediaRecorder' };
  } finally {
    cancelAnimationFrame(raf);
    clearTimeout(finishTimer);
    if (abortListener) signal?.removeEventListener('abort', abortListener);
    if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach((track) => track.stop());
    canvas.width = canvas.height = 1;
  }
}

export async function renderVideo(
  composition: CompositionState,
  assets: Assets,
  onProgress: (value: ExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<VideoExportResult> {
  checkAbort(signal);
  if (!assets.mockup) throw new Error('Add a mockup image before exporting.');
  validateVideoSettings(composition.video);
  // Settings are immutable for this job even if the editor changes during encoding.
  const snapshot = structuredClone(composition);
  onProgress({ phase: 'Checking encoder support…', progress: 0 });
  const capabilities = await detectCapabilities(snapshot.video);
  checkAbort(signal);
  const candidates = capabilities.codecs.filter(
    (codec) => snapshot.video.codec === 'auto' || codec.id === snapshot.video.codec,
  );
  if (snapshot.video.mode === 'maximum') {
    const codec = candidates.find((candidate) => candidate.webCodecs);
    if (codec) return encodeFrames(snapshot, assets, codec, onProgress, signal);
    throw new Error(
      `Frame-by-frame export is unavailable for ${snapshot.video.width} × ${snapshot.video.height} at ${snapshot.video.fps} FPS with the selected codec. Choose another codec or explicitly select Real-time recording; no lower-quality recording was started.`,
    );
  }
  const codec = candidates.find((candidate) => candidate.mediaRecorder);
  if (codec) {
    onProgress({ phase: 'Using real-time MediaRecorder · keep this tab visible', progress: 0 });
    return recordRealtime(snapshot, assets, codec, onProgress, signal);
  }
  throw new Error(
    `No supported ${snapshot.video.codec === 'auto' ? 'WebM' : snapshot.video.codec.toUpperCase()} encoder is available for ${snapshot.video.width} × ${snapshot.video.height} at ${snapshot.video.fps} FPS. Try Auto codec, smaller dimensions, or a current Chrome or Edge browser.`,
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = Array.from(filename.replace(/[<>:"/\\|?*]/g, '-'), (char) =>
    char.charCodeAt(0) < 32 ? '-' : char,
  ).join('');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
