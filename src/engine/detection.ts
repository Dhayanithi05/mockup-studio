import type { DetectionCandidate, ImageAsset } from '../types';
export { selectDetectedScreens } from './detection-geometry';

interface DetectionReply {
  id: number;
  stage?: string;
  candidates?: DetectionCandidate[];
  error?: string;
}
interface PendingDetection {
  resolve: (candidates: DetectionCandidate[]) => void;
  reject: (error: Error) => void;
  stage?: (stage: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingDetection>();

function resetWorker(message: string) {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(new Error(message));
  }
  pending.clear();
}

function detectionWorker(): Worker {
  if (worker) return worker;
  if (typeof Worker === 'undefined')
    throw new Error(
      'This browser does not support background screen detection. Set the four screen corners manually.',
    );
  worker = new Worker(new URL('./detection.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<DetectionReply>) => {
    const request = pending.get(data.id);
    if (!request) return;
    if (data.stage) request.stage?.(data.stage);
    if (data.candidates || data.error) {
      clearTimeout(request.timeout);
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.candidates ?? []);
    }
  };
  worker.onerror = () =>
    resetWorker('Screen detection could not start. Set the four screen corners manually.');
  return worker;
}

/** Analyze a disposable, downsampled copy. Original blobs and decoded images are never changed. */
export async function detectScreenRegion(
  asset: ImageAsset,
  onStage?: (stage: string) => void,
): Promise<DetectionCandidate[]> {
  try {
    onStage?.('Preparing a local analysis copy…');
    const scale = Math.min(1, 1200 / Math.max(asset.width, asset.height));
    const width = Math.max(1, Math.round(asset.width * scale));
    const height = Math.max(1, Math.round(asset.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context)
      throw new Error('Canvas analysis is unavailable. Set the four screen corners manually.');
    context.drawImage(asset.bitmap, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    canvas.width = canvas.height = 1;
    const target = detectionWorker();
    const id = ++nextId;
    const candidates = await new Promise<DetectionCandidate[]>((resolve, reject) => {
      const timeout = setTimeout(
        () => resetWorker('Screen detection timed out. Set the four screen corners manually.'),
        60_000,
      );
      pending.set(id, { resolve, reject, stage: onStage, timeout });
      try {
        target.postMessage({ id, width, height, pixels: image.data.buffer }, [image.data.buffer]);
      } catch (error) {
        clearTimeout(timeout);
        pending.delete(id);
        reject(error);
      }
    });
    onStage?.(
      candidates.length
        ? `${candidates.length} possible screen${candidates.length === 1 ? '' : 's'} detected`
        : 'No clear screen found. Set the four screen corners manually.',
    );
    return candidates;
  } catch (error) {
    onStage?.(
      error instanceof Error
        ? error.message
        : 'Detection unavailable. Set the four screen corners manually.',
    );
    return [];
  }
}

/** Release the WASM worker when the editor is disposed. */
export function disposeDetection() {
  resetWorker('Screen detection stopped.');
}
