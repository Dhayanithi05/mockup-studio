import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crosshair, Maximize2, Minus, Plus, Scan, X } from 'lucide-react';
import { useEditor, beginHistoryGroup, endHistoryGroup } from '../state/store';
import {
  renderComposition,
  screenToOutput,
  outputToMockup,
  getScreenMetrics,
} from '../engine/renderer';
import { isConvexQuad } from '../engine/geometry';
import {
  getScreens,
  updateScreen,
  screenEnabled,
  screenComposition,
  getScrollReference,
} from '../engine/screens';
import type { Point, Quad } from '../types';
export default function Stage() {
  const s = useEditor();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  const canvasPosition = useRef<HTMLDivElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [bounds, setBounds] = useState({ width: 900, height: 600 });
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, width: 900, height: 600 });
  const drag = useRef<{
    start: Point;
    quad: Quad;
    scroll: number;
    corner: number;
    outputStart: Point;
    offset: Point;
    framing: boolean;
    screenIndex: number;
  } | null>(null);
  const c = s.composition;
  const screens = getScreens(c);
  const selectedScreen = Math.min(s.selectedScreen, screens.length - 1);
  const activeScreen = screens[selectedScreen];
  const w = c.output.width,
    h = c.output.height;
  const fit = Math.min((bounds.width - 96) / w, (bounds.height - 100) / h);
  const z = s.zoom || Math.max(0.001, fit);
  const cssW = w * z,
    cssH = h * z;
  const syncViewport = () => {
    if (!scrollBox.current || !canvasPosition.current) return;
    const outer = scrollBox.current.getBoundingClientRect();
    const inner = canvasPosition.current.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const x = Math.max(0, Math.floor((outer.left - inner.left) * dpr) / dpr);
    const y = Math.max(0, Math.floor((outer.top - inner.top) * dpr) / dpr);
    const width = Math.max(
      1,
      Math.ceil(Math.min(cssW - x, outer.right - inner.left - x) * dpr) / dpr,
    );
    const height = Math.max(
      1,
      Math.ceil(Math.min(cssH - y, outer.bottom - inner.top - y) * dpr) / dpr,
    );
    setView((current) =>
      current.x === x && current.y === y && current.width === width && current.height === height
        ? current
        : { x, y, width, height },
    );
  };
  useLayoutEffect(syncViewport, [cssW, cssH, bounds]);
  // Keep the preview tile aligned with native scroll offsets even in embedded
  // browser surfaces where synthetic scroll events may be deferred.
  useEffect(() => {
    const element = scrollBox.current;
    if (!element) return;
    const updateViewport = () => syncViewport();
    element.addEventListener('scroll', updateViewport, { passive: true });
    return () => element.removeEventListener('scroll', updateViewport);
  }, [cssW, cssH, bounds]);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) =>
      setBounds({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !s.assets.mockup) return;
    const dpr = devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(view.width * dpr));
    cv.height = Math.max(1, Math.round(view.height * dpr));
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    try {
      renderComposition({
        ctx,
        width: cssW * dpr,
        height: cssH * dpr,
        viewport: { x: view.x * dpr, y: view.y * dpr, width: cv.width, height: cv.height },
        composition: c,
        assets: s.assets,
        currentTime: s.time,
        scrollY: c.scrollY,
        quality: s.playing && z < 1 ? 'preview' : 'export',
      });
    } catch (e) {
      s.ui({ error: e instanceof Error ? e.message : 'Unable to draw this composition.' });
    }
  }, [c, s.assets, s.time, cssW, cssH, view, s.playing]);
  const point = (e: { clientX: number; clientY: number }) => {
    const b = canvasPosition.current!.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * w, y: ((e.clientY - b.top) / b.height) * h };
  };
  const normalized = (p: Point) => outputToMockup(p, c, s.assets, w, h, s.time);
  const contains = (p: Point, q: Quad) => {
    let hit = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      if (
        q[i].y > p.y !== q[j].y > p.y &&
        p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x
      )
        hit = !hit;
    }
    return hit;
  };
  const screenAt = (p: Point) =>
    screens.findIndex((region) => screenEnabled(region) && contains(p, region.quad));
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (s.busy || s.editScreen) return;
      const p = normalized(point(e));
      if (screenAt(p) < 0) return;
      e.preventDefault();
      const max = getScreenMetrics(getScrollReference(c, s.assets), s.assets).maxScroll;
      s.update(
        {
          scrollY: Math.max(
            0,
            Math.min(
              max,
              c.scrollY + e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 500 : 1),
            ),
          ),
        },
        false,
      );
      s.ui({ playing: false });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const start = (e: React.PointerEvent, corner = -1) => {
    if (s.busy) return;
    const p = normalized(point(e));
    const framing = s.tab === 'Export' && c.output.framing === 'custom';
    const screenIndex = s.editScreen ? selectedScreen : screenAt(p);
    if (!s.editScreen && screenIndex < 0 && !framing) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    beginHistoryGroup();
    drag.current = {
      start: p,
      quad: structuredClone(screens[Math.max(0, screenIndex)].quad),
      scroll: c.scrollY,
      corner,
      outputStart: point(e),
      offset: { x: c.output.x, y: c.output.y },
      framing,
      screenIndex,
    };
    s.ui({ playing: false, selectedCorner: corner >= 0 ? corner : s.selectedCorner });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const p = normalized(point(e));
    const d = drag.current;
    if (d.framing) {
      const pos = point(e);
      s.update({
        output: {
          ...c.output,
          x: Math.max(-200, Math.min(200, d.offset.x + ((pos.x - d.outputStart.x) / w) * 100)),
          y: Math.max(-200, Math.min(200, d.offset.y + ((pos.y - d.outputStart.y) / h) * 100)),
        },
      });
      return;
    }
    if (s.editScreen) {
      const q = structuredClone(d.quad);
      if (d.corner >= 0) {
        q[d.corner] = { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
        setDragPoint({ x: point(e).x * z, y: point(e).y * z });
      } else {
        const dx = Math.max(
          -Math.min(...q.map((v) => v.x)),
          Math.min(1 - Math.max(...q.map((v) => v.x)), p.x - d.start.x),
        );
        const dy = Math.max(
          -Math.min(...q.map((v) => v.y)),
          Math.min(1 - Math.max(...q.map((v) => v.y)), p.y - d.start.y),
        );
        q.forEach((v) => {
          v.x += dx;
          v.y += dy;
        });
      }
      if (isConvexQuad(q)) s.update(updateScreen(c, d.screenIndex, { quad: q }));
    } else {
      const metrics = getScreenMetrics(getScrollReference(c, s.assets), s.assets);
      const localMetrics = getScreenMetrics(screenComposition(c, d.screenIndex), s.assets);
      s.update(
        {
          scrollY: Math.max(
            0,
            Math.min(
              metrics.maxScroll,
              d.scroll -
                (((p.y - d.start.y) * (s.assets.mockup?.height || 1)) / localMetrics.designScale) *
                  (localMetrics.maxScroll > 0 ? metrics.maxScroll / localMetrics.maxScroll : 0),
            ),
          ),
        },
        false,
      );
    }
  };
  const end = () => {
    endHistoryGroup();
    drag.current = null;
    setDragPoint(null);
  };
  useEffect(() => {
    if (!dragPoint || !loupe.current || !canvas.current) return;
    const ctx = loupe.current.getContext('2d');
    if (ctx) {
      const cv = canvas.current;
      ctx.clearRect(0, 0, 120, 120);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        cv,
        ((dragPoint.x - view.x) / view.width) * cv.width - 15,
        ((dragPoint.y - view.y) / view.height) * cv.height - 15,
        30,
        30,
        0,
        0,
        120,
        120,
      );
      ctx.strokeStyle = '#c3f85c';
      ctx.beginPath();
      ctx.moveTo(60, 0);
      ctx.lineTo(60, 120);
      ctx.moveTo(0, 60);
      ctx.lineTo(120, 60);
      ctx.stroke();
    }
  }, [dragPoint, c, cssW, cssH, view]);
  const points = activeScreen.quad.map((p) => screenToOutput(p, c, s.assets, cssW, cssH, s.time));
  return (
    <div className={'stage-area ' + (s.preview ? 'is-preview' : '')} ref={box}>
      {!s.preview && (
        <div className="stage-heading">
          <div>
            <span className="tiny-label">CANVAS</span>
            <span>Composition 01</span>
          </div>
          <span className="canvas-spec">
            {w.toLocaleString()} × {h.toLocaleString()}
            <i /> {w === h ? '1:1' : Math.abs(w / h - 16 / 9) < 0.01 ? '16:9' : 'Custom'}
          </span>
        </div>
      )}
      <div className="stage-scroll" ref={scrollBox}>
        <div className="canvas-position" ref={canvasPosition} style={{ width: cssW, height: cssH }}>
          <canvas
            ref={canvas}
            style={{
              position: 'absolute',
              left: view.x,
              top: view.y,
              width: view.width,
              height: view.height,
            }}
            aria-label="Mockup composition. Scroll over the device display to move the design."
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          {!s.assets.mockup && <div className="canvas-empty">Preparing your studio…</div>}
          {!s.preview && s.grid && <div className="grid-overlay" />}
          {!s.preview && s.safe && <div className="safe-overlay" />}
          {s.editScreen && !s.preview && s.assets.mockup && (
            <svg
              className="screen-overlay"
              width={cssW}
              height={cssH}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              {screens.map(
                (region, index) =>
                  index !== selectedScreen && (
                    <g
                      key={region.id ?? index}
                      className={'other-screen ' + (screenEnabled(region) ? '' : 'is-hidden')}
                    >
                      <polygon
                        points={region.quad
                          .map((p) => {
                            const q = screenToOutput(p, c, s.assets, cssW, cssH, s.time);
                            return `${q.x},${q.y}`;
                          })
                          .join(' ')}
                        role="button"
                        tabIndex={0}
                        aria-label={`Select screen ${index + 1} on canvas`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          s.ui({ selectedScreen: index });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            s.ui({ selectedScreen: index });
                          }
                        }}
                      />
                      <text
                        x={screenToOutput(region.quad[0], c, s.assets, cssW, cssH, s.time).x + 10}
                        y={screenToOutput(region.quad[0], c, s.assets, cssW, cssH, s.time).y + 20}
                      >
                        {region.name || `Screen ${index + 1}`}
                      </text>
                    </g>
                  ),
              )}
              <polygon
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                onPointerDown={(e) => start(e, -1)}
              />
              <text x={points[0].x + 12} y={points[0].y + 22}>
                {activeScreen.name || `Screen ${selectedScreen + 1}`}
              </text>
              {points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={8}
                    className={s.selectedCorner === i ? 'selected' : ''}
                    onPointerDown={(e) => start(e, i)}
                    aria-label={`Screen corner ${i + 1}`}
                    role="button"
                    tabIndex={0}
                    onFocus={() => s.ui({ selectedCorner: i })}
                  />
                  <text x={p.x + 13} y={p.y - 12}>
                    {['TL', 'TR', 'BR', 'BL'][i]}
                  </text>
                </g>
              ))}
              <path
                d={`M${(points[0].x + points[2].x) / 2 - 6},${(points[0].y + points[2].y) / 2}h12m-6,-6v12`}
                stroke="#c3f85c"
              />
            </svg>
          )}
          {dragPoint && (
            <canvas
              className="loupe"
              ref={loupe}
              width={120}
              height={120}
              style={{
                left: Math.min(cssW - 130, dragPoint.x + 22),
                top: Math.max(0, dragPoint.y - 145),
              }}
            />
          )}
        </div>
      </div>
      {!s.preview && (
        <>
          <div className="stage-hint">
            <span className="keycap">↕</span>{' '}
            {s.editScreen
              ? 'Drag corners · Arrow keys to nudge · Shift for 10 px'
              : s.tab === 'Export' && c.output.framing === 'custom'
                ? 'Drag the scene to position your crop'
                : 'Scroll on the display to explore your design'}
          </div>
          <div className="stage-tools">
            <button
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => s.ui({ zoom: Math.max(0.05, z - 0.1) })}
            >
              <Minus size={15} />
            </button>
            <select
              aria-label="Preview zoom"
              value={
                s.zoom === 0
                  ? 'fit'
                  : [0.25, 0.5, 0.75, 1, 1.5, 2, 4].includes(s.zoom)
                    ? s.zoom
                    : 'custom'
              }
              onChange={(e) => {
                if (e.target.value !== 'custom')
                  s.ui({ zoom: e.target.value === 'fit' ? 0 : +e.target.value });
              }}
            >
              <option value="fit">Fit · {Math.round(z * 100)}%</option>
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n * 100}%
                </option>
              ))}
              {s.zoom > 0 && ![0.25, 0.5, 0.75, 1, 1.5, 2, 4].includes(s.zoom) && (
                <option value="custom">{Math.round(z * 100)}%</option>
              )}
            </select>
            <button
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => s.ui({ zoom: Math.min(4, z + 0.1) })}
            >
              <Plus size={15} />
            </button>
            <span className="divider" />
            <button title="Fit canvas" aria-label="Fit canvas" onClick={() => s.ui({ zoom: 0 })}>
              <Maximize2 size={15} />
            </button>
            <button
              className={s.editScreen ? 'active' : ''}
              title="Edit screen corners"
              aria-label="Edit screen corners"
              onClick={() => s.ui({ editScreen: !s.editScreen, tab: 'Screen' })}
            >
              <Scan size={16} />
            </button>
            <button
              title="Safe area"
              aria-label="Safe area"
              className={s.safe ? 'active' : ''}
              onClick={() => s.ui({ safe: !s.safe })}
            >
              <Crosshair size={16} />
            </button>
          </div>
        </>
      )}
      {s.preview && (
        <button className="exit-preview" onClick={() => s.ui({ preview: false })}>
          <X size={16} /> Exit preview <kbd>Esc</kbd>
        </button>
      )}
    </div>
  );
}
