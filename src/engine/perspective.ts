import type { Point, Quad } from '../types';
import { applyHomography, calculateHomography, distance, type Homography } from './geometry';

export type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface SourcePlacement {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rounded screen mask follows the projective plane rather than the quad's bounding rectangle. */
export function screenMaskPath(
  ctx: DrawingContext,
  quad: Quad,
  radius: number,
  screenWidth: number,
  screenHeight: number,
): void {
  const h = calculateHomography(quad),
    rx = Math.min(0.5, Math.max(0, radius) / Math.max(1, screenWidth)),
    ry = Math.min(0.5, Math.max(0, radius) / Math.max(1, screenHeight));
  ctx.beginPath();
  if (rx < 0.0001 || ry < 0.0001) {
    ctx.moveTo(quad[0].x, quad[0].y);
    for (const p of quad.slice(1)) ctx.lineTo(p.x, p.y);
  } else {
    const corners = [
      { x: 1 - rx, y: ry, start: -Math.PI / 2 },
      { x: 1 - rx, y: 1 - ry, start: 0 },
      { x: rx, y: 1 - ry, start: Math.PI / 2 },
      { x: rx, y: ry, start: Math.PI },
    ];
    corners.forEach((corner, index) => {
      for (let step = 0; step <= 16; step++) {
        const angle = corner.start + ((step / 16) * Math.PI) / 2;
        const p = applyHomography(h, {
          x: corner.x + Math.cos(angle) * rx,
          y: corner.y + Math.sin(angle) * ry,
        });
        if (index === 0 && step === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
    });
  }
  ctx.closePath();
}

function expandedTriangle(triangle: [Point, Point, Point], amount: number): [Point, Point, Point] {
  const center = {
    x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
    y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
  };
  const edgeDistances = triangle.map((p, i) => {
    const q = triangle[(i + 1) % 3];
    return (
      Math.abs((q.x - p.x) * (center.y - p.y) - (q.y - p.y) * (center.x - p.x)) /
      Math.max(0.001, distance(p, q))
    );
  });
  const scale = 1 + amount / Math.max(0.001, Math.min(...edgeDistances));
  return triangle.map((p) => ({
    x: center.x + (p.x - center.x) * scale,
    y: center.y + (p.y - center.y) * scale,
  })) as [Point, Point, Point];
}
function paintTriangle(
  ctx: DrawingContext,
  image: CanvasImageSource,
  src: [Point, Point, Point],
  dest: [Point, Point, Point],
  placement: SourcePlacement,
): void {
  const [s0, s1, s2] = src,
    [p0, p1, p2] = dest;
  const determinant = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(determinant) < 1e-12) return;
  const a = ((p1.x - p0.x) * (s2.y - s0.y) - (p2.x - p0.x) * (s1.y - s0.y)) / determinant;
  const b = ((p1.y - p0.y) * (s2.y - s0.y) - (p2.y - p0.y) * (s1.y - s0.y)) / determinant;
  const c = ((p2.x - p0.x) * (s1.x - s0.x) - (p1.x - p0.x) * (s2.x - s0.x)) / determinant;
  const d = ((p2.y - p0.y) * (s1.x - s0.x) - (p1.y - p0.y) * (s2.x - s0.x)) / determinant;
  const expanded = expandedTriangle(dest, 1.05);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(expanded[0].x, expanded[0].y);
  ctx.lineTo(expanded[1].x, expanded[1].y);
  ctx.lineTo(expanded[2].x, expanded[2].y);
  ctx.closePath();
  ctx.clip();
  // Overlap by one output pixel so adjacent antialiased clips cannot leave seams.
  // The source crop is made opaque once below, avoiding repeated alpha blending.
  ctx.globalCompositeOperation = 'source-over';
  ctx.transform(a, b, c, d, p0.x - a * s0.x - c * s0.y, p0.y - b * s0.x - d * s0.y);
  ctx.drawImage(
    image,
    placement.sx,
    placement.sy,
    placement.sw,
    placement.sh,
    placement.x,
    placement.y,
    placement.width,
    placement.height,
  );
  ctx.restore();
}

/**
 * Directly samples the decoded original image. The exact homography defines the mesh;
 * adaptive subdivision limits affine approximation to subpixel error at the actual output size.
 * Affine screens take one drawImage call, so the common monitor case is fast and sharp.
 */
const sourceCanvases = new WeakMap<object, OffscreenCanvas | HTMLCanvasElement>();
export function drawPerspectiveTexture(
  ctx: DrawingContext,
  image: CanvasImageSource,
  quad: Quad,
  placement: SourcePlacement,
  quality: 'preview' | 'export' = 'preview',
): void {
  if (placement.sw <= 0 || placement.sh <= 0) return;
  const matrix = calculateHomography(quad);
  if (Math.abs(matrix[6]) + Math.abs(matrix[7]) < 1e-7) {
    ctx.save();
    ctx.transform(matrix[0], matrix[3], matrix[1], matrix[4], matrix[2], matrix[5]);
    ctx.drawImage(
      image,
      placement.sx,
      placement.sy,
      placement.sw,
      placement.sh,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    );
    ctx.restore();
    return;
  }
  // Crop at original source resolution (integer bounds, no resize), then flatten
  // alpha onto the display's black backing once before drawing overlapping tiles.
  const left = Math.floor(placement.sx),
    top = Math.floor(placement.sy);
  const cropWidth = Math.max(1, Math.ceil(placement.sx + placement.sw) - left);
  const cropHeight = Math.max(1, Math.ceil(placement.sy + placement.sh) - top);
  let source = sourceCanvases.get(ctx);
  if (!source) {
    source =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(cropWidth, cropHeight)
        : document.createElement('canvas');
    sourceCanvases.set(ctx, source);
  }
  if (source.width !== cropWidth) source.width = cropWidth;
  if (source.height !== cropHeight) source.height = cropHeight;
  const sourceCtx = source.getContext('2d') as DrawingContext | null;
  if (!sourceCtx)
    throw new Error(
      'Could not allocate the original-resolution screen crop. Try a smaller source.',
    );
  sourceCtx.fillStyle = '#090a0c';
  sourceCtx.fillRect(0, 0, cropWidth, cropHeight);
  sourceCtx.drawImage(image, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  image = source;
  placement = { ...placement, sx: placement.sx - left, sy: placement.sy - top };
  const tolerance = quality === 'export' ? 0.22 : 0.65,
    maxDepth = quality === 'export' ? 6 : 5;
  const map = (x: number, y: number) => applyHomography(matrix, { x, y });
  const subdivide = (u0: number, v0: number, u1: number, v1: number, depth: number): void => {
    const um = (u0 + u1) / 2,
      vm = (v0 + v1) / 2;
    const q: Quad = [map(u0, v0), map(u1, v0), map(u1, v1), map(u0, v1)];
    const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const error = Math.max(
      distance(map(um, vm), midpoint(q[0], q[2])),
      distance(map(um, v0), midpoint(q[0], q[1])),
      distance(map(u1, vm), midpoint(q[1], q[2])),
      distance(map(um, v1), midpoint(q[2], q[3])),
      distance(map(u0, vm), midpoint(q[3], q[0])),
    );
    if (error > tolerance && depth < maxDepth) {
      subdivide(u0, v0, um, vm, depth + 1);
      subdivide(um, v0, u1, vm, depth + 1);
      subdivide(um, vm, u1, v1, depth + 1);
      subdivide(u0, vm, um, v1, depth + 1);
      return;
    }
    paintTriangle(
      ctx,
      image,
      [
        { x: u0, y: v0 },
        { x: u1, y: v0 },
        { x: u1, y: v1 },
      ],
      [q[0], q[1], q[2]],
      placement,
    );
    paintTriangle(
      ctx,
      image,
      [
        { x: u0, y: v0 },
        { x: u1, y: v1 },
        { x: u0, y: v1 },
      ],
      [q[0], q[2], q[3]],
      placement,
    );
  };
  subdivide(0, 0, 1, 1, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#090a0c';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

export { calculateHomography, applyHomography };
export type { Homography };
