import type { DetectionCandidate, Point, Quad } from '../types';

export type DetectionMethod = 'edge' | 'color' | 'saturation' | 'plane' | 'alpha';
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Clockwise image coordinates, starting at the upper-left-most corner. */
export function orderDetectionQuad(points: readonly Point[]): Quad | null {
  if (points.length !== 4 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return null;
  const center = points.reduce((c, p) => ({ x: c.x + p.x / 4, y: c.y + p.y / 4 }), { x: 0, y: 0 });
  const sorted = points
    .map((p) => ({ ...p }))
    .sort(
      (a, b) =>
        Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x),
    );
  const start = sorted.reduce(
    (best, p, index) => (p.x + p.y < sorted[best].x + sorted[best].y ? index : best),
    0,
  );
  return [...sorted.slice(start), ...sorted.slice(0, start)] as Quad;
}

export function detectionQuadArea(quad: Quad): number {
  return (
    Math.abs(
      quad.reduce((area, p, i) => area + p.x * quad[(i + 1) % 4].y - p.y * quad[(i + 1) % 4].x, 0),
    ) / 2
  );
}

export function isConvexDetectionQuad(quad: Quad): boolean {
  const crosses = quad.map((a, i) => {
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  return crosses.every((c) => c > 0.001) || crosses.every((c) => c < -0.001);
}

/** Fit the straight portions of a contour, then intersect them to recover rounded screen corners. */
export function refineDetectionQuad(quad: Quad, contour: readonly Point[]): Quad {
  const smallestSide = Math.min(...quad.map((p, i) => distance(p, quad[(i + 1) % 4])));
  const samples: Point[] = [];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i],
      b = contour[(i + 1) % contour.length];
    const steps = Math.max(1, Math.ceil(distance(a, b) / 5));
    for (let j = 0; j < steps; j++)
      samples.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
  }
  const lines = quad.map((a, index) => {
    const b = quad[(index + 1) % 4];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = distance(a, b);
    const nearby = samples.filter((p) => {
      const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
      const perpendicular = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
      return along > 0.16 && along < 0.84 && perpendicular < smallestSide * 0.06;
    });
    if (nearby.length < 4) return null;
    const center = nearby.reduce(
      (sum, p) => ({ x: sum.x + p.x / nearby.length, y: sum.y + p.y / nearby.length }),
      { x: 0, y: 0 },
    );
    const covariance = nearby.reduce(
      (s, p) => ({
        xx: s.xx + (p.x - center.x) ** 2,
        yy: s.yy + (p.y - center.y) ** 2,
        xy: s.xy + (p.x - center.x) * (p.y - center.y),
      }),
      { xx: 0, yy: 0, xy: 0 },
    );
    const angle = Math.atan2(2 * covariance.xy, covariance.xx - covariance.yy) / 2;
    const nx = -Math.sin(angle),
      ny = Math.cos(angle);
    const c = nx * center.x + ny * center.y;
    const error = Math.sqrt(
      nearby.reduce((sum, p) => sum + (nx * p.x + ny * p.y - c) ** 2, 0) / nearby.length,
    );
    return error <= 2.5 ? { nx, ny, c } : null;
  });
  if (lines.some((line) => !line)) return quad;
  const refined = lines.map((current, index) => {
    const previous = lines[(index + 3) % 4]!;
    const line = current!;
    const denominator = previous.nx * line.ny - previous.ny * line.nx;
    return {
      x: (previous.c * line.ny - previous.ny * line.c) / denominator,
      y: (previous.nx * line.c - previous.c * line.nx) / denominator,
    };
  }) as Quad;
  if (
    !isConvexDetectionQuad(refined) ||
    refined.some(
      (p, i) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        distance(p, quad[i]) > smallestSide * 0.15,
    )
  )
    return quad;
  return refined;
}

function lumaAt(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const offset =
    (Math.round(clamp(y, 0, height - 1)) * width + Math.round(clamp(x, 0, width - 1))) * 4;
  return pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
}

function pixelOffset(width: number, height: number, x: number, y: number): number {
  return (
    (Math.round(clamp(y, 0, height - 1)) * width + Math.round(clamp(x, 0, width - 1))) * 4
  );
}

/** Deterministic computer-vision heuristic; confidence is a ranking score, not an AI probability. */
export function scoreDetectionQuad(
  quad: Quad,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
  method: DetectionMethod,
): number | null {
  if (
    width < 2 ||
    height < 2 ||
    pixels.length !== width * height * 4 ||
    !isConvexDetectionQuad(quad)
  )
    return null;
  if (
    quad.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x >= width ||
        p.y >= height,
    )
  )
    return null;
  const area = detectionQuadArea(quad) / (width * height);
  // Keep smaller secondary screens (phones, tablets, and picture-in-picture displays)
  // available for review, while rejecting tiny cards and decorative details below.
  if (area < 0.006 || area > 0.9) return null;
  const xs = quad.map((p) => p.x),
    ys = quad.map((p) => p.y);
  const border = Math.max(2, Math.min(width, height) * 0.009);
  const touchedBorders = [
    Math.min(...xs) <= border,
    Math.max(...xs) >= width - 1 - border,
    Math.min(...ys) <= border,
    Math.max(...ys) >= height - 1 - border,
  ].filter(Boolean).length;
  // Exclude the photograph's outer frame and transparent exterior contours.
  if (touchedBorders >= 3 || (touchedBorders >= 2 && area > 0.55)) return null;
  const sides = quad.map((p, i) => distance(p, quad[(i + 1) % 4]));
  if (Math.min(...sides) < Math.min(width, height) * 0.032) return null;
  const ratio = (sides[0] + sides[2]) / (sides[1] + sides[3]);
  if (ratio < 0.2 || ratio > 5) return null;
  const oppositeSimilarity =
    (Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) +
      Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3])) /
    2;
  const cosines = quad.map((p, i) => {
    const a = quad[(i + 3) % 4],
      b = quad[(i + 1) % 4];
    return Math.abs(
      ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (distance(a, p) * distance(b, p)),
    );
  });
  if (Math.max(...cosines) > 0.985 || oppositeSimilarity < 0.22) return null;
  const rectangularity =
    0.6 * (1 - cosines.reduce((sum, v) => sum + v, 0) / 4) + 0.4 * oppositeSimilarity;
  const center = quad.reduce((c, p) => ({ x: c.x + p.x / 4, y: c.y + p.y / 4 }), { x: 0, y: 0 });
  const centrality = clamp(
    1 - Math.hypot((center.x / width - 0.5) * 1.4, (center.y / height - 0.45) * 1.15),
  );
  const standardRatios = [16 / 9, 16 / 10, 4 / 3, 3 / 2, 1, 9 / 16, 9 / 19.5, 3 / 4];
  const aspect = Math.exp(
    -Math.min(...standardRatios.map((r) => Math.abs(Math.log(ratio / r)))) * 2,
  );
  let edgeSum = 0;
  let colourEdgeSum = 0;
  let continuousEdges = 0;
  let enclosedAlphaEdges = 0;
  const offset = Math.max(2, Math.min(width, height) * 0.004);
  for (let side = 0; side < 4; side++) {
    const a = quad[side],
      b = quad[(side + 1) % 4];
    for (let j = 1; j <= 12; j++) {
      const t = j / 13;
      const x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t;
      const length = Math.hypot(center.x - x, center.y - y);
      const dx = ((center.x - x) / length) * offset,
        dy = ((center.y - y) / length) * offset;
      const inside = pixelOffset(width, height, x + dx, y + dy);
      const outside = pixelOffset(width, height, x - dx, y - dy);
      const lumaDifference = Math.abs(
        pixels[inside] * 0.2126 +
          pixels[inside + 1] * 0.7152 +
          pixels[inside + 2] * 0.0722 -
          (pixels[outside] * 0.2126 +
            pixels[outside + 1] * 0.7152 +
            pixels[outside + 2] * 0.0722),
      );
      const colourDifference = Math.hypot(
        pixels[inside] - pixels[outside],
        pixels[inside + 1] - pixels[outside + 1],
        pixels[inside + 2] - pixels[outside + 2],
      ) / Math.sqrt(3);
      edgeSum += lumaDifference;
      colourEdgeSum += colourDifference;
      if (Math.max(lumaDifference, colourDifference) >= 20) continuousEdges++;
      if (method === 'alpha') {
        if (pixels[inside + 3] < 32 && pixels[outside + 3] > 180) enclosedAlphaEdges++;
      }
    }
  }
  const edgeStrength = clamp(Math.max(edgeSum / 48 / 48, colourEdgeSum / 48 / 68));
  const edgeContinuity = continuousEdges / 48;
  const samples: number[] = [];
  let transparentSamples = 0;
  for (let iy = 1; iy <= 8; iy++) {
    for (let ix = 1; ix <= 8; ix++) {
      const u = ix / 9,
        v = iy / 9;
      const x =
        (1 - v) * ((1 - u) * quad[0].x + u * quad[1].x) + v * ((1 - u) * quad[3].x + u * quad[2].x);
      const y =
        (1 - v) * ((1 - u) * quad[0].y + u * quad[1].y) + v * ((1 - u) * quad[3].y + u * quad[2].y);
      samples.push(lumaAt(pixels, width, height, x, y));
      const index =
        (Math.round(clamp(y, 0, height - 1)) * width + Math.round(clamp(x, 0, width - 1))) * 4;
      if (pixels[index + 3] < 32) transparentSamples++;
    }
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  const uniformity = clamp(1 - Math.sqrt(variance) / 90);
  const surface = Math.abs(mean - 127.5) / 127.5;
  const size = clamp(Math.sqrt(area) * 1.8);
  let confidence =
    0.08 +
    size * 0.18 +
    rectangularity * 0.17 +
    centrality * 0.07 +
    aspect * 0.09 +
    edgeStrength * 0.2 +
    edgeContinuity * 0.04 +
    uniformity * 0.09 +
    surface * 0.06;
  if (method === 'alpha') {
    if (transparentSamples < 58 || enclosedAlphaEdges < 28) return null;
    confidence = Math.max(
      confidence,
      0.78 + rectangularity * 0.1 + centrality * 0.04 + size * 0.05,
    );
  }
  return clamp(confidence, 0, 0.98);
}

export function distinctDetectionCandidates(
  candidates: DetectionCandidate[],
  limit = 12,
): DetectionCandidate[] {
  const result: DetectionCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => {
    // A closed transparent opening is direct evidence of a screen cut-out. Keep it ahead of
    // its opaque outline even when a high-contrast bezel receives a similar score.
    const alphaPriority =
      Number(b.label.startsWith('Transparent')) - Number(a.label.startsWith('Transparent'));
    return alphaPriority || b.confidence - a.confidence;
  })) {
    const duplicate = result.some((other) => {
      const meanDistance =
        candidate.quad.reduce((sum, point, index) => sum + distance(point, other.quad[index]), 0) /
        4;
      const smallArea = Math.min(detectionQuadArea(candidate.quad), detectionQuadArea(other.quad));
      return (
        meanDistance < Math.min(0.01, Math.sqrt(smallArea) * 0.025) &&
        detectionIntersectionArea(candidate.quad, other.quad) / smallArea > 0.9
      );
    });
    if (!duplicate) result.push(candidate);
    if (result.length >= limit) break;
  }
  return result;
}

function signedPolygonArea(points: readonly Point[]): number {
  return (
    points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length];
      return sum + p.x * next.y - p.y * next.x;
    }, 0) / 2
  );
}

/** Convex polygon clipping, so nearby perspective screens are not merged by their bounding boxes. */
export function detectionIntersectionArea(a: Quad, b: Quad): number {
  let polygon: Point[] = a.map((p) => ({ ...p }));
  const orientation = Math.sign(signedPolygonArea(b));
  if (!orientation) return 0;
  for (let side = 0; side < b.length && polygon.length; side++) {
    const start = b[side],
      end = b[(side + 1) % b.length];
    const signedDistance = (p: Point) =>
      orientation * ((end.x - start.x) * (p.y - start.y) - (end.y - start.y) * (p.x - start.x));
    const input = polygon;
    polygon = [];
    let previous = input[input.length - 1];
    let previousDistance = signedDistance(previous);
    for (const current of input) {
      const currentDistance = signedDistance(current);
      const previousInside = previousDistance >= -1e-10;
      const currentInside = currentDistance >= -1e-10;
      if (previousInside !== currentInside) {
        const t = previousDistance / (previousDistance - currentDistance);
        polygon.push({
          x: previous.x + t * (current.x - previous.x),
          y: previous.y + t * (current.y - previous.y),
        });
      }
      if (currentInside) polygon.push(current);
      previous = current;
      previousDistance = currentDistance;
    }
  }
  return polygon.length >= 3 ? Math.abs(signedPolygonArea(polygon)) : 0;
}

/**
 * Reliable physical displays, with alternative edges and nested bezel outlines suppressed.
 * Keep the complete candidate list separately for manual selection: this conservative heuristic
 * cannot infer every device or distinguish arbitrary rectangular content from a real screen.
 */
export function selectDetectedScreens(candidates: DetectionCandidate[]): DetectionCandidate[] {
  const valid = candidates.filter(
    (candidate) =>
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0.72 &&
      candidate.quad.length === 4 &&
      candidate.quad.every(
        (p) =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.x <= 1 &&
          p.y >= 0 &&
          p.y <= 1,
      ) &&
      detectionQuadArea(candidate.quad) > 0.001,
  );
  const reliable = distinctDetectionCandidates(valid, 120).filter((candidate) => {
    const crosses = candidate.quad.map((a, i) => {
      const b = candidate.quad[(i + 1) % 4],
        c = candidate.quad[(i + 2) % 4];
      return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    });
    return crosses.every((cross) => cross > 1e-10) || crosses.every((cross) => cross < -1e-10);
  });
  // An outline enclosing several separate displays is a shared frame/background, not another screen.
  const possibleScreens = reliable.filter((outer) => {
    const outerArea = detectionQuadArea(outer.quad);
    const contained = reliable.filter((inner) => {
      const area = detectionQuadArea(inner.quad);
      return (
        inner !== outer &&
        area < outerArea * 0.7 &&
        detectionIntersectionArea(outer.quad, inner.quad) / area > 0.96
      );
    });
    return !contained.some((a, i) =>
      contained.slice(i + 1).some((b) => {
        const areaA = detectionQuadArea(a.quad),
          areaB = detectionQuadArea(b.quad);
        return (
          detectionIntersectionArea(a.quad, b.quad) / Math.min(areaA, areaB) < 0.08 &&
          (areaA + areaB) / outerArea > 0.2
        );
      }),
    );
  });
  const selected: DetectionCandidate[] = [];
  for (const candidate of possibleScreens) {
    const area = detectionQuadArea(candidate.quad);
    const duplicate = selected.some((other) => {
      const otherArea = detectionQuadArea(other.quad);
      const intersection = detectionIntersectionArea(candidate.quad, other.quad);
      return (
        intersection / Math.min(area, otherArea) >= 0.68 ||
        intersection / (area + otherArea - intersection) >= 0.45
      );
    });
    if (!duplicate) selected.push(candidate);
    if (selected.length === 12) break;
  }
  // Stable reading order avoids renumbering screens when confidence changes slightly.
  const center = (candidate: DetectionCandidate) =>
    candidate.quad.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
  return selected.sort((a, b) => {
    const ca = center(a),
      cb = center(b);
    return ca.x - cb.x || ca.y - cb.y;
  });
}

/** A similarly strong inner plane surrounded by a dark bezel is likelier than the device body. */
export function preferInsetDetectionScreens(
  candidates: DetectionCandidate[],
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): DetectionCandidate[] {
  return candidates.map((outer) => {
    if (outer.label.startsWith('Transparent')) return outer;
    const outerArea = detectionQuadArea(outer.quad);
    const hasInnerDisplay = candidates.some((inner) => {
      if (inner === outer || inner.confidence < outer.confidence - 0.06) return false;
      const areaRatio = detectionQuadArea(inner.quad) / outerArea;
      if (areaRatio < 0.6 || areaRatio > 0.9) return false;
      const contains = inner.quad.every((point) =>
        outer.quad.every((a, i) => {
          const b = outer.quad[(i + 1) % 4];
          return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) > 0;
        }),
      );
      if (!contains) return false;
      let ringBrightness = 0;
      for (let side = 0; side < 4; side++) {
        const next = (side + 1) % 4;
        const x =
          (outer.quad[side].x + outer.quad[next].x + inner.quad[side].x + inner.quad[next].x) / 4;
        const y =
          (outer.quad[side].y + outer.quad[next].y + inner.quad[side].y + inner.quad[next].y) / 4;
        ringBrightness += lumaAt(pixels, width, height, x * width, y * height) / 4;
      }
      return ringBrightness < 110;
    });
    return hasInnerDisplay
      ? { ...outer, confidence: Math.max(0, outer.confidence - 0.075) }
      : outer;
  });
}
