import { useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clapperboard,
  Download,
  FileImage,
  Folder,
  Image,
  Layers,
  Monitor,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Scan,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Undo2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import Stage from './components/Stage';
import PropertyPanel from './components/PropertyPanel';
import { useEditor, type Tab } from './state/store';
import { loadImage, loadSample } from './engine/image';
import { getScreenMetrics } from './engine/renderer';
import { compositionScrollAtTime as scrollAtTime, getScrollReference } from './engine/screens';
import { MOTION_PRESETS, matchMotionPreset, reconcileAutoDuration } from './engine/presets';
import { detectScreenRegion, selectDetectedScreens } from './engine/detection';
import { getScreens, updateScreen } from './engine/screens';
import { captureScreenshot, downloadBlob, renderVideo } from './engine/export';
import { renderFrameSequence } from './engine/frame-sequence';
import { isConvexQuad } from './engine/geometry';
import { saveProject } from './engine/persistence';
import type { Assets, Quad } from './types';
const navItems: [Tab, typeof Image][] = [
  ['Project', Folder],
  ['Design', FileImage],
  ['Mockup', Monitor],
  ['Screen', Scan],
  ['Motion', Clapperboard],
  ['Export', Download],
];
export default function App() {
  const s = useEditor();
  const c = s.composition;
  const file = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<keyof Assets>('design');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    let disposed = false;
    void Promise.all([loadSample('mockup'), loadSample('design')])
      .then(([mockup, design]) => {
        if (disposed) return;
        useEditor.setState({ assets: { mockup, design, background: null, foreground: null } });
      })
      .catch((e) => s.ui({ error: String(e) }));
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    const state = useEditor.getState();
    const next = reconcileAutoDuration(state.composition, state.assets);
    if (Math.abs(next.motion.duration - state.composition.motion.duration) > 0.001) {
      state.update(next, false);
      state.ui({ time: Math.min(state.time, next.motion.duration), playing: false });
    }
  }, [
    s.assets.design,
    s.assets.mockup,
    c.designFit,
    c.designScale,
    c.screen.quad,
    c.screen.inset,
    c.screen.enabled,
    c.extraScreens,
  ]);
  useEffect(() => {
    if (!s.notice) return;
    const timer = setTimeout(() => s.ui({ notice: '' }), 4500);
    return () => clearTimeout(timer);
  }, [s.notice]);
  useEffect(() => {
    if (!s.playing || s.busy) return;
    const start = performance.now() - s.time * 1000;
    let id = 0;
    let last = 0;
    const tick = (now: number) => {
      const state = useEditor.getState();
      if (now - last > 25) {
        const duration = state.composition.motion.duration;
        let time = (now - start) / 1000;
        let playing = true;
        if (time >= duration) {
          if (state.composition.motion.loop) time %= duration;
          else {
            time = duration;
            playing = false;
          }
        }
        const scrollY = scrollAtTime(time, state.composition, state.assets);
        state.update({ scrollY }, false);
        state.ui({ time, playing });
        last = now;
        if (!playing) return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [s.playing, s.busy]);
  const togglePlay = () => {
    const state = useEditor.getState();
    if (state.busy) return;
    if (state.time >= state.composition.motion.duration) state.ui({ time: 0 });
    state.ui({ playing: !state.playing });
  };
  const seek = (time: number) => {
    s.ui({ time, playing: false });
    s.update({ scrollY: scrollAtTime(time, c, s.assets) }, false);
  };
  const upload = (key: keyof Assets) => {
    if (s.busy) return;
    uploadTarget.current = key;
    if (file.current) {
      file.current.value = '';
      file.current.accept =
        key === 'design' ? '.png,.jpg,.jpeg,.webp,.svg,.fig' : '.png,.jpg,.jpeg,.webp';
      file.current.click();
    }
  };
  const detect = async () => {
    const state = useEditor.getState();
    if (!state.assets.mockup || state.busy) return;
    state.ui({ busy: { phase: 'Analyzing mockup…', progress: -1 }, playing: false, error: '' });
    try {
      const candidates = await detectScreenRegion(state.assets.mockup, (phase) =>
        state.ui({ busy: { phase, progress: -1 } }),
      );
      const detected = selectDetectedScreens(candidates);
      state.ui({ candidates, tab: 'Screen', editScreen: true, selectedScreen: 0 });
      if (detected.length) {
        const regions = detected.map((candidate, index) => ({
          ...state.composition.screen,
          id: crypto.randomUUID(),
          name: `Screen ${index + 1}`,
          enabled: true,
          quad: candidate.quad,
        }));
        state.update({ screen: regions[0], extraScreens: regions.slice(1) });
        state.ui({
          notice: `${regions.length} screen${regions.length === 1 ? '' : 's'} detected and filled. Select each screen to check its corners.`,
        });
      } else if (candidates.length) {
        state.ui({
          notice: `${candidates.length} possible regions. Choose candidates or add screens manually.`,
        });
      } else
        state.ui({
          notice: 'No confident screen region found. Drag the four corners to mark your display.',
        });
    } catch (e) {
      state.ui({
        error: `Automatic detection unavailable. ${e instanceof Error ? e.message : ''} Use Edit Screen to mark the four corners.`,
        tab: 'Screen',
        editScreen: true,
      });
    } finally {
      state.ui({ busy: null });
    }
  };
  const handleFile = async (selected: File | undefined, key = uploadTarget.current) => {
    if (!selected || s.busy) return;
    s.ui({ busy: { phase: 'Decoding original image…', progress: -1 }, playing: false, error: '' });
    try {
      const asset = await loadImage(selected, selected.name);
      s.setAsset(key, asset);
      if (key === 'design') {
        s.update({ scrollY: 0 });
        s.ui({ time: 0 });
      }
      if (key === 'mockup') {
        const quad: Quad = [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.7 },
          { x: 0.2, y: 0.7 },
        ];
        s.update({
          screen: { ...c.screen, quad, inset: 0, radius: 0, enabled: true, name: 'Screen 1' },
          extraScreens: [],
          scrollY: 0,
        });
        s.ui({
          candidates: [],
          editScreen: true,
          tab: 'Screen',
          busy: null,
          time: 0,
          selectedScreen: 0,
        });
        await detect();
      } else s.ui({ notice: `${selected.name} imported at ${asset.width} × ${asset.height}.` });
    } catch (e) {
      s.ui({ error: e instanceof Error ? e.message : 'Could not import this image.' });
    } finally {
      s.ui({ busy: null });
    }
  };
  const filename = (extension: string) => {
    const custom = c.screenshot.filename
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\.(png|jpg|jpeg|webp|webm|zip)$/i, '');
    const width = ['webm', 'zip'].includes(extension)
      ? c.video.width
      : c.output.width * c.screenshot.scale;
    return `${custom || `mockup-studio-${new Date().toISOString().slice(0, 10)}-${width === 3840 ? '4k' : `${width}w`}`}.${extension}`;
  };
  const screenshot = async () => {
    if (s.busy) return;
    s.ui({
      busy: { phase: 'Rendering screenshot from original images…', progress: -1 },
      playing: false,
      error: '',
    });
    try {
      await new Promise((r) => setTimeout(r, 35));
      const blob = await captureScreenshot(c, s.assets, s.time);
      downloadBlob(blob, filename(c.screenshot.format === 'jpeg' ? 'jpg' : c.screenshot.format));
      s.ui({
        notice: `Screenshot exported · ${c.output.width * c.screenshot.scale} × ${c.output.height * c.screenshot.scale}`,
      });
    } catch (e) {
      s.ui({ error: e instanceof Error ? e.message : 'Screenshot export failed.' });
    } finally {
      s.ui({ busy: null });
    }
  };
  const record = async () => {
    if (s.busy) return;
    abort.current = new AbortController();
    s.ui({ busy: { phase: 'Preparing motion export…', progress: 0 }, playing: false, error: '' });
    try {
      if (c.video.format === 'png-sequence') {
        const blob = await renderFrameSequence(
          c,
          s.assets,
          (p) => s.ui({ busy: p }),
          abort.current.signal,
        );
        downloadBlob(blob, filename('zip'));
        s.ui({
          notice: `Lossless PNG frames exported · ${c.video.width} × ${c.video.height} · ${c.video.fps} fps`,
        });
        return;
      }
      const result = await renderVideo(c, s.assets, (p) => s.ui({ busy: p }), abort.current.signal);
      downloadBlob(result.blob, filename(result.extension));
      s.ui({
        notice: `Video exported · ${c.video.width} × ${c.video.height} · ${result.codec} · ${result.mode}`,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError')
        s.ui({ notice: 'Motion export canceled.' });
      else s.ui({ error: e instanceof Error ? e.message : 'Motion export failed.' });
    } finally {
      abort.current = null;
      s.ui({ busy: null });
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input,textarea,select') || el.isContentEditable) return;
      const state = useEditor.getState();
      if (e.key === 'Escape') {
        state.ui({ preview: false, editScreen: false });
        return;
      }
      if (state.busy) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject(state.projectId, state.composition, state.assets)
          .then(() => state.ui({ dirty: false, notice: 'Project saved on this device.' }))
          .catch(() => state.ui({ error: 'Unable to save project. Browser storage may be full.' }));
        return;
      }
      if (ctrl) return;
      if (state.editScreen && e.key.startsWith('Arrow') && state.assets.mockup) {
        e.preventDefault();
        const activeScreen =
          getScreens(state.composition)[state.selectedScreen] ?? state.composition.screen;
        const q = structuredClone(activeScreen.quad);
        const p = q[state.selectedCorner];
        const n = e.shiftKey ? 10 : 1;
        p.x = Math.max(
          0,
          Math.min(
            1,
            p.x +
              (e.key === 'ArrowRight' ? n : e.key === 'ArrowLeft' ? -n : 0) /
                state.assets.mockup.width,
          ),
        );
        p.y = Math.max(
          0,
          Math.min(
            1,
            p.y +
              (e.key === 'ArrowDown' ? n : e.key === 'ArrowUp' ? -n : 0) /
                state.assets.mockup.height,
          ),
        );
        if (isConvexQuad(q))
          state.update(updateScreen(state.composition, state.selectedScreen, { quad: q }));
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if (e.key.toLowerCase() === 'r') {
        state.ui({ time: 0, playing: false });
        state.update({ scrollY: scrollAtTime(0, state.composition, state.assets) }, false);
      }
      if (e.key.toLowerCase() === 's') void screenshot();
      if (e.key.toLowerCase() === 'f') state.ui({ zoom: 0 });
      if (e.key === '1') state.ui({ zoom: 1 });
      const max = getScreenMetrics(
        getScrollReference(state.composition, state.assets),
        state.assets,
      ).maxScroll;
      const moves: Record<string, number> = {
        Home: 0,
        End: max,
        ArrowUp: state.composition.scrollY - 80,
        ArrowDown: state.composition.scrollY + 80,
        PageUp: state.composition.scrollY - 800,
        PageDown: state.composition.scrollY + 800,
      };
      if (e.key in moves) {
        e.preventDefault();
        state.update({ scrollY: Math.max(0, Math.min(max, moves[e.key])) }, false);
        state.ui({ playing: false });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const busy = s.busy !== null;
  const metrics = getScreenMetrics(getScrollReference(c, s.assets), s.assets);
  const presetId = matchMotionPreset(c, s.assets);
  const motionLabel =
    MOTION_PRESETS.find((p) => p.id === presetId)?.label ??
    (c.motion.mode === 'manual' ? 'Manual position' : 'Custom motion');
  const unlooped = { ...c, motion: { ...c.motion, loop: false } };
  const curve = Array.from({ length: 61 }, (_, i) => {
    const progress = metrics.maxScroll
      ? scrollAtTime((c.motion.duration * i) / 60, unlooped, s.assets) / metrics.maxScroll
      : 0;
    return `${i === 0 ? 'M' : 'L'}${((i / 60) * 1000).toFixed(1)},${(42 - progress * 34).toFixed(1)}`;
  }).join(' ');
  return (
    <div
      className={'app ' + (s.preview ? 'preview-mode' : '')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy) void handleFile(e.dataTransfer.files[0], 'design');
      }}
    >
      <input
        ref={file}
        type="file"
        data-testid="asset-input"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <div className="editor-shell" inert={busy ? true : undefined}>
        <header className="topbar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              s.ui({ tab: 'Project' });
            }}
          >
            <div className="brand-symbol">
              <svg viewBox="0 0 30 30">
                <path d="M6 23V7l9 10 9-10v16" />
              </svg>
            </div>
            <span>
              MOCKUP<span>STUDIO</span>
            </span>
          </a>
          <span className="top-divider" />
          <button className="project-name" onClick={() => s.ui({ tab: 'Project' })}>
            {c.name}
            <ChevronDown size={13} />
          </button>
          <span className="saved-status">{s.dirty ? 'Unsaved changes' : 'Local project'}</span>
          <div className="top-actions">
            <div className="history-buttons">
              <button
                className="icon-button"
                aria-label="Undo"
                title="Undo · Ctrl Z"
                disabled={!s.past.length}
                onClick={s.undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Redo"
                title="Redo · Ctrl Shift Z"
                disabled={!s.future.length}
                onClick={s.redo}
              >
                <Redo2 size={17} />
              </button>
            </div>
            <button
              className="button preview-button"
              onClick={() => s.ui({ preview: true, zoom: 0, editScreen: false })}
            >
              <Play size={13} /> Preview
            </button>
            <button className="button" onClick={() => void screenshot()}>
              <Download size={15} /> Screenshot
            </button>
            <button
              className="button primary"
              onClick={() => {
                s.ui({ tab: 'Export', exportTab: 'video' });
              }}
            >
              <Video size={16} /> Record
            </button>
          </div>
        </header>
        <aside className="left-sidebar">
          <div className="workspace-label">
            WORKSPACE <SlidersHorizontal size={13} />
          </div>
          <nav>
            {navItems.map(([label, Icon], i) => (
              <button
                key={label}
                aria-label={label}
                title={label}
                aria-current={s.tab === label ? 'page' : undefined}
                className={s.tab === label ? 'selected' : ''}
                onClick={() =>
                  s.ui({ tab: label, editScreen: label === 'Screen' ? s.editScreen : false })
                }
              >
                <Icon size={17} />
                <span>{label}</span>
                <small>{String(i + 1).padStart(2, '0')}</small>
              </button>
            ))}
          </nav>
          <div className="sidebar-separator" />
          <div className="workspace-label">
            SCENE <Layers size={13} />
          </div>
          <button
            className={'layer-card ' + (s.tab === 'Design' ? 'active-layer' : '')}
            onClick={() => s.ui({ tab: 'Design' })}
          >
            <div className="layer-thumb design-thumb">
              {s.assets.design && <img src={s.assets.design.url} alt="" />}
            </div>
            <span>
              <strong>Your design</strong>
              <small>
                {s.assets.design
                  ? `${s.assets.design.width} × ${s.assets.design.height}`
                  : 'Import a design'}
              </small>
            </span>
            <Check size={12} />
          </button>
          <button className="layer-card" onClick={() => s.ui({ tab: 'Mockup' })}>
            <div className="layer-thumb">
              {s.assets.mockup && <img src={s.assets.mockup.url} alt="" />}
            </div>
            <span>
              <strong>{s.assets.mockup?.name ?? 'Your mockup'}</strong>
              <small>Mockup image</small>
            </span>
          </button>
          <button className="add-asset" onClick={() => upload('design')}>
            <Upload size={14} /> Upload Design
          </button>
          <button className="add-asset" onClick={() => upload('mockup')}>
            <Monitor size={14} /> Replace Mockup
          </button>
          <div className="sidebar-bottom">
            <div className="local-card">
              <ShieldCheck size={18} />
              <strong>Made to stay local.</strong>
              <p>Your designs never leave your browser.</p>
            </div>
            <button
              className="help-button"
              onClick={() =>
                s.ui({
                  notice:
                    'Shortcuts: Space play/pause · R restart · S screenshot · F fit · 1 zoom 100% · Home/End scroll · Ctrl+S save · Ctrl+Z undo',
                })
              }
            >
              <CircleHelp size={15} /> Keyboard shortcuts <ArrowUpRight size={13} />
            </button>
            <div className="version">
              MOCKUP STUDIO <span>v1.0</span>
            </div>
          </div>
        </aside>
        <main className="workspace">
          <div className="workspace-toolbar">
            <div className="canvas-tabs">
              <button
                className={!s.editScreen ? 'current' : ''}
                onClick={() => s.ui({ editScreen: false })}
              >
                <MousePointer2 size={14} /> Composition
              </button>
              <button
                className={s.editScreen ? 'current' : ''}
                onClick={() => s.ui({ editScreen: !s.editScreen, tab: 'Screen', playing: false })}
              >
                <Scan size={14} /> Edit screen
              </button>
            </div>
            <div className="workspace-options">
              <span>
                <span className="source-dot" /> Original sources
              </span>
              <button
                className="icon-button"
                aria-label="Workspace settings"
                onClick={() => s.ui({ tab: 'Project' })}
              >
                <Settings2 size={16} />
              </button>
            </div>
          </div>
          <Stage />
          <div className="timeline">
            <div className="timeline-header">
              <div className="timeline-title">
                <Clapperboard size={15} />
                <strong>Motion timeline</strong>
                <button className="preset-chip" onClick={() => s.ui({ tab: 'Motion' })}>
                  {motionLabel}
                  <ChevronDown size={11} />
                </button>
              </div>
              <div className="playback">
                <button className="icon-button" aria-label="Restart motion" onClick={() => seek(0)}>
                  <RotateCcw size={14} />
                </button>
                <button
                  className="play-button"
                  aria-label={s.playing ? 'Pause' : 'Play'}
                  onClick={togglePlay}
                >
                  {s.playing ? (
                    <Pause size={15} fill="currentColor" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                </button>
                <button
                  className="icon-button"
                  aria-label="Stop motion"
                  onClick={() => {
                    seek(0);
                    s.ui({ playing: false });
                  }}
                >
                  <Square size={12} />
                </button>
                <span className="timecode">
                  {s.time.toFixed(1).padStart(4, '0')}
                  <em>/ {c.motion.duration.toFixed(1)} s</em>
                </span>
              </div>
              <button
                className="icon-button"
                aria-label="Motion settings"
                onClick={() => s.ui({ tab: 'Motion' })}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
            <div className="timeline-track">
              <div className="timeline-ruler">
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
                  <span key={t}>{(t * c.motion.duration).toFixed(1)}s</span>
                ))}
              </div>
              <div className="motion-lane">
                <div className="motion-label">
                  <Layers size={13} />
                  <span>Design scroll</span>
                </div>
                <div className="motion-clip">
                  <span className="clip-title">
                    {c.motion.mode === 'manual'
                      ? 'Manual position'
                      : c.motion.direction === 'up'
                        ? 'Footer → Hero'
                        : 'Hero → Footer'}
                  </span>
                  <svg
                    className="timeline-curve"
                    viewBox="0 0 1000 48"
                    preserveAspectRatio="none"
                    aria-label="Scroll progress over time"
                    role="img"
                  >
                    <path d={`${curve} L1000,48 L0,48 Z`} fill="currentColor" opacity="0.1" />
                    <path
                      d={curve}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {c.motion.mode === 'timeline' &&
                    c.motion.keyframes.map((k) => (
                      <button
                        key={k.id}
                        className="keyframe-diamond"
                        title={`Seek to ${k.time}s · ${Math.round(k.progress * 100)}%`}
                        aria-label={`Seek to keyframe at ${k.time}s`}
                        style={{ left: `${(k.time / c.motion.duration) * 100}%` }}
                        onClick={() => seek(k.time)}
                      />
                    ))}
                  <div
                    className="playhead"
                    style={{ left: `${(s.time / c.motion.duration) * 100}%` }}
                  />
                  <input
                    aria-label="Timeline position"
                    type="range"
                    min="0"
                    max={c.motion.duration}
                    step="0.01"
                    value={s.time}
                    onChange={(e) => seek(+e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="timeline-bottom">
              <span>
                <span className="keycap">space</span> to play or pause
              </span>
              <button onClick={() => s.ui({ tab: 'Motion' })}>
                Adjust motion <ArrowUpRight size={12} />
              </button>
              <span>
                {Math.round(metrics.maxScroll ? (c.scrollY / metrics.maxScroll) * 100 : 0)}%
                scrolled
              </span>
            </div>
          </div>
        </main>
        <PropertyPanel
          upload={upload}
          detect={() => void detect()}
          screenshot={() => void screenshot()}
          record={() => void record()}
        />
        <footer className="statusbar">
          <span>
            <span className="status-indicator" /> All processing on your device
          </span>
          <span>
            {s.assets.design
              ? `${s.assets.design.width} × ${s.assets.design.height} design`
              : 'Loading assets'}
            <i /> {c.output.width} × {c.output.height} output
            <Monitor size={12} />
          </span>
        </footer>
      </div>
      <div className="mobile-notice">
        <Monitor size={22} />
        <span>Mockup Studio works best on a desktop display.</span>
      </div>
      {s.notice && !s.error && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{s.notice}</span>
          <button aria-label="Dismiss notification" onClick={() => s.ui({ notice: '' })}>
            <X size={15} />
          </button>
        </div>
      )}
      {s.error && (
        <div className="error-toast" role="alert">
          <span>{s.error}</span>
          <button aria-label="Dismiss error" onClick={() => s.ui({ error: '' })}>
            <X size={17} />
          </button>
        </div>
      )}
      {s.busy && (
        <div className="modal-backdrop">
          <div
            className="render-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="render-title"
          >
            <div className="render-symbol">
              <Video size={27} />
            </div>
            <h2 id="render-title">
              {abort.current ? 'Rendering your motion' : 'Working on your composition'}
            </h2>
            <p aria-live="polite">{s.busy.phase}</p>
            {s.busy.progress >= 0 ? (
              <>
                <progress value={s.busy.progress} max="1" />
                <strong>{Math.round(s.busy.progress * 100)}%</strong>
              </>
            ) : (
              <div className="indeterminate-progress" />
            )}
            {abort.current && (
              <button className="button full" onClick={() => abort.current?.abort()}>
                Cancel Render
              </button>
            )}
            <small>Original sources · Private processing</small>
          </div>
        </div>
      )}
    </div>
  );
}
