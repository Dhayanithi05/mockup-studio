import type { DetectionCandidate, Quad } from '../types';
import cvReady from '@techstark/opencv-js';
import {
  distinctDetectionCandidates,
  orderDetectionQuad,
  preferInsetDetectionScreens,
  refineDetectionQuad,
  scoreDetectionQuad,
  selectDetectedScreens,
} from './detection-geometry';
import type { DetectionMethod } from './detection-geometry';

// Only the small OpenCV surface this worker needs. Keeping the type boundary here also
// accommodates OpenCV builds that expose either an initialized runtime or a thenable.
interface CVMat {
  rows: number;
  data32S: Int32Array;
  delete(): void;
}
interface CVMatVector {
  size(): number;
  get(index: number): CVMat;
  delete(): void;
}
interface CVRuntime {
  Mat: new () => CVMat;
  MatVector: new () => CVMatVector;
  Size: new (width: number, height: number) => unknown;
  matFromImageData(image: ImageData): CVMat;
  cvtColor(source: CVMat, target: CVMat, code: number): void;
  GaussianBlur(source: CVMat, target: CVMat, size: unknown, sigma: number): void;
  Canny(source: CVMat, target: CVMat, threshold1: number, threshold2: number): void;
  findContours(
    source: CVMat,
    contours: CVMatVector,
    hierarchy: CVMat,
    mode: number,
    method: number,
  ): void;
  arcLength(contour: CVMat, closed: boolean): number;
  approxPolyDP(contour: CVMat, target: CVMat, epsilon: number, closed: boolean): void;
  contourArea(contour: CVMat): number;
  threshold(source: CVMat, target: CVMat, threshold: number, maximum: number, type: number): void;
  split(source: CVMat, channels: CVMatVector): void;
  morphologyEx(source: CVMat, target: CVMat, operation: number, kernel: CVMat): void;
  getStructuringElement(shape: number, size: unknown): CVMat;
  COLOR_RGBA2GRAY: number;
  RETR_LIST: number;
  CHAIN_APPROX_SIMPLE: number;
  THRESH_BINARY: number;
  THRESH_BINARY_INV: number;
  MORPH_CLOSE: number;
  MORPH_RECT: number;
  onRuntimeInitialized?: () => void;
}

type CVModule = Partial<CVRuntime> & {
  then?: (ready: (cv: CVRuntime) => void, reject: (error: unknown) => void) => unknown;
};
let runtime: Promise<{ cv: CVRuntime }> | undefined;

function loadOpenCV(): Promise<{ cv: CVRuntime }> {
  runtime ??= new Promise<{ cv: CVRuntime }>((resolve, reject) => {
    const imported = cvReady as unknown as CVModule;
    const timeout = setTimeout(
      () => reject(new Error('The local vision engine took too long to initialize.')),
      40_000,
    );
    const ready = (cv: CVRuntime) => {
      clearTimeout(timeout);
      resolve({ cv });
    };
    if (typeof imported.Mat === 'function') ready(imported as CVRuntime);
    else if (typeof imported.then === 'function') imported.then(ready, reject);
    else imported.onRuntimeInitialized = () => ready(imported as CVRuntime);
  });
  return runtime;
}

interface AnalyzeMessage {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
}
const send = (message: {
  id: number;
  stage?: string;
  candidates?: DetectionCandidate[];
  error?: string;
}) => self.postMessage(message);

function analyze(
  cv: CVRuntime,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  stage: (message: string) => void,
): DetectionCandidate[] {
  const allocated: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(value: T): T => {
    allocated.push(value);
    return value;
  };
  const candidates: DetectionCandidate[] = [];
  try {
    const rgba = keep(cv.matFromImageData(new ImageData(pixels, width, height)));
    const gray = keep(new cv.Mat());
    const blurred = keep(new cv.Mat());
    const edges = keep(new cv.Mat());
    const binary = keep(new cv.Mat());
    const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    const inspectContours = (input: CVMat, method: DetectionMethod) => {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      try {
        cv.findContours(input, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        // Real photographs can contain thousands of small contours. Reject on area before approximation.
        const count = Math.min(contours.size(), 16_000);
        for (let index = 0; index < count; index++) {
          const contour = contours.get(index);
          let polygon: CVMat | undefined;
          try {
            const area = Math.abs(cv.contourArea(contour));
            if (area < width * height * 0.012 || area > width * height * 0.94) continue;
            const perimeter = cv.arcLength(contour, true);
            polygon = new cv.Mat();
            for (const accuracy of [0.012, 0.022, 0.038]) {
              cv.approxPolyDP(contour, polygon, perimeter * accuracy, true);
              if (polygon.rows !== 4) continue;
              const points = Array.from({ length: 4 }, (_, p) => ({
                x: polygon!.data32S[p * 2],
                y: polygon!.data32S[p * 2 + 1],
              }));
              const ordered = orderDetectionQuad(points);
              if (!ordered) continue;
              const contourPoints = Array.from({ length: contour.rows }, (_, p) => ({
                x: contour.data32S[p * 2],
                y: contour.data32S[p * 2 + 1],
              }));
              const quad = refineDetectionQuad(ordered, contourPoints);
              const confidence = scoreDetectionQuad(quad, width, height, pixels, method);
              if (confidence === null || confidence < 0.42) continue;
              const normalized = quad.map((p) => ({ x: p.x / width, y: p.y / height })) as Quad;
              candidates.push({
                quad: normalized,
                confidence,
                label:
                  method === 'alpha'
                    ? 'Transparent screen opening'
                    : method === 'plane'
                      ? 'Display surface'
                      : 'Display boundary',
              });
              break;
            }
          } finally {
            polygon?.delete();
            contour.delete();
          }
        }
      } finally {
        hierarchy.delete();
        contours.delete();
      }
    };

    stage('Finding display edges and perspective corners…');
    for (const [low, high] of [
      [35, 105],
      [75, 190],
    ]) {
      cv.Canny(blurred, edges, low, high);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      inspectContours(edges, 'edge');
    }

    stage('Comparing display surfaces and transparent openings…');
    for (const [threshold, operation] of [
      [50, cv.THRESH_BINARY_INV],
      [210, cv.THRESH_BINARY],
    ]) {
      cv.threshold(blurred, binary, threshold, 255, operation);
      inspectContours(binary, 'plane');
    }
    let hasTransparency = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 32) {
        hasTransparency = true;
        break;
      }
    }
    if (hasTransparency) {
      const channels = new cv.MatVector();
      let alpha: CVMat | undefined;
      try {
        cv.split(rgba, channels);
        alpha = channels.get(3);
        cv.threshold(alpha, binary, 31, 255, cv.THRESH_BINARY_INV);
        inspectContours(binary, 'alpha');
      } finally {
        alpha?.delete();
        channels.delete();
      }
    }
    stage('Ranking likely screens…');
    const ranked = preferInsetDetectionScreens(
      distinctDetectionCandidates(candidates, 120),
      width,
      height,
      pixels,
    );
    // Reserve a suggestion for each physical screen before adding alternate bezel edges.
    // Otherwise several strong outlines of one device can crowd out a smaller distant display.
    const physical = selectDetectedScreens(ranked).sort((a, b) => b.confidence - a.confidence);
    const physicalSet = new Set(physical);
    const suggestions = [
      ...physical,
      ...distinctDetectionCandidates(ranked, 120).filter(
        (candidate) => !physicalSet.has(candidate),
      ),
    ].slice(0, 12);
    return suggestions.map((candidate, index) => ({
      ...candidate,
      label: `${candidate.label} ${index + 1}`,
    }));
  } finally {
    for (let index = allocated.length - 1; index >= 0; index--) allocated[index].delete();
  }
}

// A dedicated worker keeps WASM initialization and all image analysis off the editor thread.
self.onmessage = async ({ data }: MessageEvent<AnalyzeMessage>) => {
  const { id, width, height } = data;
  try {
    send({ id, stage: 'Loading the local vision engine…' });
    const { cv } = await loadOpenCV();
    const pixels = new Uint8ClampedArray(data.pixels);
    const candidates = analyze(cv, width, height, pixels, (stage) => send({ id, stage }));
    send({ id, candidates });
  } catch (error) {
    send({
      id,
      error: `Screen detection unavailable. ${error instanceof Error ? error.message : 'Set the four screen corners manually.'}`,
    });
  }
};
