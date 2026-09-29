import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  Copy,
  Download,
  FolderOpen,
  ImagePlus,
  Clapperboard,
  Monitor,
  Smartphone,
  Layers2,
  Plus,
  RotateCcw,
  Save,
  Scan,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { useEditor } from '../state/store';
import { DEFAULT_QUAD, createDefaults } from '../state/defaults';
import { getScreenMetrics } from '../engine/renderer';
import { getScreens, updateScreen, screenEnabled } from '../engine/screens';
import { getQualityReport, nativeMockupOutput } from '../engine/quality';
import { isConvexQuad } from '../engine/geometry';
import { compositionScrollAtTime as scrollAtTime, getScrollReference } from '../engine/screens';
import { fileSize, loadSample } from '../engine/image';
import {
  saveProject,
  listProjects,
  openProject,
  deleteProject,
  type ProjectInfo,
} from '../engine/persistence';
import {
  detectCapabilities,
  estimateVideoSize,
  downloadBlob,
  type ExportCapabilities,
} from '../engine/export';
import {
  ASPECT_RATIOS,
  MOTION_PRESETS,
  OUTPUT_RECIPES,
  RESOLUTION_PRESETS,
  QUALITY_PRESETS,
  applyMotionPreset,
  applyOutputRecipe,
  applyResolutionPreset,
  applyQualityPreset,
  matchMotionPreset,
  matchOutputRecipe,
  matchResolutionPreset,
  matchQualityPreset,
  matchAspectRatio,
  qualityBitrate,
  resizeComposition,
  setCompositionAspect,
  setCompositionDuration,
  setCompositionFrameRate,
  updateMotionSettings,
} from '../engine/presets';
import { Section, Select, NumberField, Slider, Toggle } from './Controls';
import type {
  Assets,
  CompositionState,
  Easing,
  FitMode,
  ImageAsset,
  MotionSettings,
  OutputSettings,
  ScreenshotSettings,
  VideoSettings,
} from '../types';
export interface PanelActions {
  upload: (key: keyof Assets) => void;
  screenshot: () => void;
  record: () => void;
  detect: () => void;
}
const easeOptions: [string, string][] = [
  ['linear', 'Linear'],
  ['easeIn', 'Ease in'],
  ['easeOut', 'Ease out'],
  ['easeInOut', 'Ease in & out'],
  ['bezier', 'Custom cubic Bézier'],
];
function AssetInfo({ asset }: { asset: ImageAsset | null }) {
  return asset ? (
    <div className="asset-metadata">
      <strong>{asset.name}</strong>
      <div>
        <span>
          {asset.width.toLocaleString()} × {asset.height.toLocaleString()}
        </span>
        <span>{((asset.width * asset.height) / 1e6).toFixed(1)} MP</span>
      </div>
      <div>
        <span>
          {asset.type.split('/')[1].toUpperCase()} · {fileSize(asset.size)}
        </span>
        <span>{(asset.width / asset.height).toFixed(2)}:1</span>
      </div>
      <p>
        <Check size={12} /> Original source preserved
      </p>
      <button className="text-button" onClick={() => downloadBlob(asset.blob, asset.name)}>
        <Download size={12} /> Download original file
      </button>
    </div>
  ) : (
    <p className="muted">No image selected</p>
  );
}
function Projects() {
  const s = useEditor();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch((e) => s.ui({ error: String(e) }));
  useEffect(() => {
    void refresh();
  }, []);
  const save = async (duplicate = false) => {
    try {
      const id = duplicate ? crypto.randomUUID() : s.projectId;
      const c = duplicate
        ? { ...s.composition, name: `${s.composition.name} copy` }
        : s.composition;
      await saveProject(id, c, s.assets);
      s.ui({
        projectId: id,
        composition: c,
        dirty: false,
        notice: 'Project saved on this device.',
      });
      await refresh();
    } catch {
      s.ui({
        error: 'Could not save locally. Your browser may be out of storage or using private mode.',
      });
    }
  };
  return (
    <>
      <Section title="Project">
        <label className="field">
          <span>Project name</span>
          <input value={s.composition.name} onChange={(e) => s.update({ name: e.target.value })} />
        </label>
        <button className="button primary full" onClick={() => void save()}>
          <Save size={16} /> Save project
        </button>
        <div className="two-col">
          <button className="button" onClick={() => void save(true)}>
            <Copy size={14} /> Duplicate
          </button>
          <button
            className="button"
            onClick={() => {
              void (async () => {
                try {
                  if (s.dirty) await saveProject(s.projectId, s.composition, s.assets);
                  const [mockup, design] = await Promise.all([
                    loadSample('mockup'),
                    loadSample('design'),
                  ]);
                  s.load(createDefaults(), { mockup, design, background: null, foreground: null });
                  void refresh();
                } catch (e) {
                  s.ui({ error: String(e) });
                }
              })();
            }}
          >
            <Plus size={14} /> New
          </button>
        </div>
        <p className="helper">
          Saved with original images in this browser. Save your work before clearing browser data.
        </p>
      </Section>
      <Section title="On this device">
        {projects.length ? (
          projects.map((p) => (
            <div className="saved-project" key={p.id}>
              <button
                onClick={() => {
                  void (async () => {
                    try {
                      if (s.dirty) await saveProject(s.projectId, s.composition, s.assets);
                      const next = await openProject(p.id);
                      s.load(next.composition, next.assets, p.id);
                    } catch (e) {
                      s.ui({ error: String(e) });
                    }
                  })();
                }}
              >
                <FolderOpen size={16} />
                <span>
                  {p.name}
                  <small>{new Date(p.updated).toLocaleDateString()}</small>
                </span>
              </button>
              <button
                className="icon-button"
                title={`Delete ${p.name}`}
                onClick={() => {
                  if (window.confirm(`Delete saved project “${p.name}” from this browser?`))
                    void deleteProject(p.id)
                      .then(refresh)
                      .catch((e) => s.ui({ error: String(e) }));
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <p className="helper">Your saved projects will appear here.</p>
        )}
      </Section>
      <Section title="Workspace">
        <NumberField
          label="Custom preview zoom"
          value={s.zoom ? s.zoom * 100 : 100}
          min={5}
          max={400}
          suffix="%"
          onChange={(n) => s.ui({ zoom: n / 100 })}
        />
        <Toggle label="Canvas grid" value={s.grid} onChange={(v) => s.ui({ grid: v })} />
        <Toggle label="Safe-area guides" value={s.safe} onChange={(v) => s.ui({ safe: v })} />
        <button className="button full" onClick={() => s.update(createDefaults())}>
          <RotateCcw size={14} /> Reset settings
        </button>
      </Section>
    </>
  );
}
export default function PropertyPanel(actions: PanelActions) {
  const s = useEditor();
  const c = s.composition;
  const screens = getScreens(c);
  const selectedScreen = Math.min(s.selectedScreen, screens.length - 1);
  const activeScreen = screens[selectedScreen];
  const m = c.motion;
  const o = c.output;
  const v = c.video;
  const [caps, setCaps] = useState<ExportCapabilities | null>(null);
  const [locked, setLocked] = useState(false);
  const [screenMode, setScreenMode] = useState('perspective');
  const metrics = getScreenMetrics(getScrollReference(c, s.assets), s.assets);
  const output = (p: Partial<OutputSettings>) => s.update({ output: { ...o, ...p } });
  const applyComposition = (next: CompositionState, reset = false) => {
    const time = reset ? 0 : Math.min(s.time, next.motion.duration);
    s.update({ ...next, scrollY: scrollAtTime(time, next, s.assets) });
    s.ui({ playing: false, time });
  };
  const motion = (p: Partial<MotionSettings>) =>
    applyComposition(updateMotionSettings(c, s.assets, p));
  const video = (p: Partial<VideoSettings>) => s.update({ video: { ...v, ...p } });
  const shot = (p: Partial<ScreenshotSettings>) =>
    s.update({ screenshot: { ...c.screenshot, ...p } });
  const screen = (p: Partial<typeof activeScreen>) => s.update(updateScreen(c, selectedScreen, p));
  const addScreen = (
    quad = [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.65 },
      { x: 0.25, y: 0.65 },
    ] as typeof activeScreen.quad,
  ) => {
    if (screens.length >= 12) return;
    s.update({
      extraScreens: [
        ...(c.extraScreens ?? []),
        {
          ...createDefaults().screen,
          id: crypto.randomUUID(),
          name: `Screen ${screens.length + 1}`,
          quad,
        },
      ],
    });
    s.ui({ selectedScreen: screens.length, editScreen: true, playing: false });
  };
  useEffect(() => {
    if (s.tab !== 'Export' || v.format === 'png-sequence') return;
    let active = true;
    void detectCapabilities(v)
      .then((r) => {
        if (active) setCaps(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [s.tab, v.width, v.height, v.fps, v.bitrate, v.duration, v.format]);
  const setDuration = (duration: number) => {
    applyComposition(setCompositionDuration(c, duration));
  };
  const dimensions = (width: number, height: number) => {
    s.update(
      resizeComposition(
        c,
        Math.max(1, Math.min(16384, Math.round(width))),
        Math.max(1, Math.min(16384, Math.round(height))),
      ),
    );
    s.ui({ zoom: 0 });
  };
  const motionPreset = matchMotionPreset(c, s.assets);
  const outputRecipe = matchOutputRecipe(c, s.assets);
  const resolutionPreset = matchResolutionPreset(c, s.assets);
  const intro = {
    Project: ['Your creative workspace', 'Save a composition and pick up where you left off.'],
    Design: [
      'Make your work the hero.',
      'Drop in a design, set its fit, and find your opening frame.',
    ],
    Mockup: ['Set the scene.', 'Choose your device image and refine the composition.'],
    Screen: [
      'Every corner, in place.',
      'Align the display and fine-tune how your design sits inside it.',
    ],
    Motion: [
      'Give your design a rhythm.',
      'Start with a considered motion preset, then make it yours.',
    ],
    Export: ['Ready for its close-up.', 'Choose a ready-to-use format or dial in every detail.'],
  }[s.tab];
  const renderSource = () => {
    const sx = s.exportTab === 'video' ? v.width : o.width * c.screenshot.scale;
    const sy = s.exportTab === 'video' ? v.height : o.height * c.screenshot.scale;
    const report = getQualityReport(c, s.assets, sx, sy, s.time);
    const sampling = (scale: number) =>
      `${scale.toFixed(2)}× · ${scale > 1.01 ? 'enlarged' : scale < 0.99 ? 'reduced' : 'native pixels'}`;
    return (
      <div className={'quality-note ' + (report.upsampled ? 'warning' : '')}>
        <div>Source detail at this output size</div>
        <p>Mockup: {sampling(report.mockupScale)}</p>
        {report.screens.map((region) => (
          <p key={region.index}>
            {region.name}: {sampling(region.maxScale)}
            {Math.abs(region.maxScale - region.minScale) > 0.02
              ? ` (min ${region.minScale.toFixed(2)}×)`
              : ''}
          </p>
        ))}
        <p>
          {report.upsampled
            ? 'Enlarging pixels cannot add missing detail. Use larger source files for sharper results.'
            : report.downsampled
              ? 'Some source pixels are reduced to fit this output. Increase the output dimensions to retain more detail.'
              : 'Source pixels map to the output at their native size.'}{' '}
          Perspective values are estimates.
        </p>
        <p>
          Original files stay unchanged. PNG images and frame sequences preserve rendered pixels
          losslessly; JPEG, WebP and WebM use lossy compression.
        </p>
      </div>
    );
  };
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [s.tab]);
  return (
    <aside className="properties">
      <div className="property-title">
        <h2>{s.tab === 'Export' ? 'Export studio' : s.tab}</h2>
        <span>
          {s.tab === 'Design'
            ? '01'
            : s.tab === 'Mockup'
              ? '02'
              : s.tab === 'Screen'
                ? '03'
                : s.tab === 'Motion'
                  ? '04'
                  : s.tab === 'Export'
                    ? '05'
                    : '⌘'}
        </span>
      </div>
      <div className="property-body" ref={body}>
        <div className="inspector-intro">
          <strong>{intro[0]}</strong>
          <p>{intro[1]}</p>
        </div>
        {s.tab === 'Project' && <Projects />}
        {s.tab === 'Design' && (
          <>
            <Section title="Your design">
              <button className="upload-zone" onClick={() => actions.upload('design')}>
                <div className="upload-icon">
                  <ImagePlus size={23} />
                </div>
                <strong>Upload Design</strong>
                <span>PNG, JPG, WebP or SVG</span>
              </button>
              <AssetInfo asset={s.assets.design} />
            </Section>
            <Section title="Screen fit">
              <Select
                label="Fit mode"
                value={c.designFit}
                onChange={(v) => {
                  s.update({ designFit: v as FitMode, scrollY: 0 });
                  s.ui({ time: 0, playing: false });
                }}
                options={[
                  ['width', 'Fit to width'],
                  ['height', 'Fit to height'],
                  ['contain', 'Contain'],
                  ['cover', 'Cover'],
                  ['actual', 'Actual size'],
                  ['custom', 'Custom scale'],
                ]}
              />
              {c.designFit === 'custom' && (
                <Slider
                  label="Design scale"
                  value={c.designScale * 100}
                  min={10}
                  max={400}
                  suffix="%"
                  onChange={(v) => s.update({ designScale: v / 100 })}
                />
              )}
              <p className="helper">
                The design keeps its proportions. Long pages scroll inside the display.
              </p>
            </Section>
            <Section title="Scroll position">
              <Slider
                label="Position"
                value={metrics.maxScroll ? (c.scrollY / metrics.maxScroll) * 100 : 0}
                suffix="%"
                step={0.1}
                onChange={(n) => {
                  s.update({ scrollY: (n / 100) * metrics.maxScroll });
                  s.ui({ playing: false });
                }}
              />
              <div className="scroll-detail">
                <span>{Math.round(c.scrollY).toLocaleString()} px</span>
                <span>of {Math.round(metrics.maxScroll).toLocaleString()} px</span>
              </div>
              <div className="two-col">
                <button
                  className="button"
                  onClick={() => {
                    s.update({ scrollY: 0 });
                    s.ui({ playing: false, time: 0 });
                  }}
                >
                  Go to top
                </button>
                <button
                  className="button"
                  onClick={() => {
                    s.update({ scrollY: metrics.maxScroll });
                    s.ui({ playing: false });
                  }}
                >
                  Go to bottom
                </button>
              </div>
            </Section>
            <Section title="Ready for its close-up">
              <div className="mini-output">
                <div className="format-badge">4K</div>
                <div>
                  <strong>Every pixel matters.</strong>
                  <p>Original images. Full-resolution exports.</p>
                </div>
              </div>
              <button className="button full" onClick={() => s.ui({ tab: 'Export' })}>
                Export settings <ArrowDownToLine size={14} />
              </button>
            </Section>
          </>
        )}
        {s.tab === 'Mockup' && (
          <>
            <Section title="Device & scene">
              <div className="mockup-thumbnail">
                {s.assets.mockup && <img src={s.assets.mockup.url} alt="Current mockup" />}
              </div>
              <button className="button full" onClick={() => actions.upload('mockup')}>
                <Upload size={15} /> Replace Mockup
              </button>
              <AssetInfo asset={s.assets.mockup} />
            </Section>
            <Section title="Composition">
              <Slider
                label="Mockup scale"
                min={25}
                max={200}
                value={o.scale * 100}
                suffix="%"
                onChange={(n) => output({ scale: n / 100 })}
              />
              <div className="two-col">
                <NumberField
                  label="X position"
                  value={o.x}
                  min={-200}
                  max={200}
                  suffix="%"
                  onChange={(n) => output({ x: n })}
                />
                <NumberField
                  label="Y position"
                  value={o.y}
                  min={-200}
                  max={200}
                  suffix="%"
                  onChange={(n) => output({ y: n })}
                />
              </div>
              <Slider
                label="Rotation"
                value={o.rotation}
                min={-180}
                max={180}
                suffix="°"
                onChange={(n) => output({ rotation: n })}
              />
              <Slider
                label="Opacity"
                value={o.opacity * 100}
                suffix="%"
                onChange={(n) => output({ opacity: n / 100 })}
              />
              <button
                className="button full"
                onClick={() => output({ scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 })}
              >
                <RotateCcw size={14} /> Reset transform
              </button>
            </Section>
            <Section title="Foreground overlay">
              <button className="button full" onClick={() => actions.upload('foreground')}>
                <Layers2 size={15} /> Add bezel overlay
              </button>
              {s.assets.foreground && (
                <>
                  <AssetInfo asset={s.assets.foreground} />
                  <button className="text-button" onClick={() => s.setAsset('foreground', null)}>
                    Remove overlay
                  </button>
                </>
              )}
              <p className="helper">
                Optional transparent PNG. Aligned to the full mockup image, above the screen
                content.
              </p>
            </Section>
          </>
        )}
        {s.tab === 'Screen' && (
          <>
            <Section
              title={`Screens in this mockup · ${screens.length}`}
              action={
                <button
                  className="icon-button"
                  title="Add screen"
                  aria-label="Add screen"
                  disabled={screens.length >= 12}
                  onClick={() => addScreen()}
                >
                  <Plus size={16} />
                </button>
              }
            >
              <div className="screen-list">
                {screens.map((region, index) => (
                  <div
                    className={'screen-row ' + (index === selectedScreen ? 'active' : '')}
                    key={region.id ?? index}
                  >
                    <button
                      className="screen-select"
                      aria-label={`Select screen ${index + 1}`}
                      aria-pressed={index === selectedScreen}
                      onClick={() =>
                        s.ui({ selectedScreen: index, editScreen: true, playing: false })
                      }
                    >
                      <Monitor size={16} />
                      <span>
                        {region.name || `Screen ${index + 1}`}
                        <small>{screenEnabled(region) ? 'Design applied' : 'Hidden'}</small>
                      </span>
                    </button>
                    <input
                      type="checkbox"
                      aria-label={`Show screen ${index + 1}`}
                      checked={screenEnabled(region)}
                      onChange={(e) =>
                        s.update(updateScreen(c, index, { enabled: e.target.checked }))
                      }
                    />
                    <button
                      className="icon-button"
                      aria-label={`Remove screen ${index + 1}`}
                      disabled={screens.length === 1}
                      onClick={() => {
                        const remaining = screens.filter((_, i) => i !== index);
                        s.update({
                          screen: remaining[0],
                          extraScreens: remaining.slice(1),
                          scrollY: 0,
                        });
                        s.ui({
                          selectedScreen: Math.max(
                            0,
                            Math.min(selectedScreen, remaining.length - 1),
                          ),
                          time: 0,
                          playing: false,
                        });
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <label className="field">
                <span>Screen name</span>
                <input
                  aria-label="Screen name"
                  value={activeScreen.name || `Screen ${selectedScreen + 1}`}
                  onChange={(e) => screen({ name: e.target.value })}
                />
              </label>
              <p className="helper">
                Your original design is rendered into every enabled screen. Select a screen to
                adjust its corners and appearance. Motion stays synchronized.
              </p>
            </Section>
            <Section title="Screen region">
              <button className="button primary full" onClick={actions.detect}>
                <Sparkles size={16} /> Detect all screens
              </button>
              <button
                className={'button full ' + (s.editScreen ? 'selected-button' : '')}
                onClick={() => s.ui({ editScreen: !s.editScreen, playing: false })}
              >
                <Scan size={15} />
                {s.editScreen ? 'Finish calibration' : 'Edit Screen'}
              </button>
              <p className="helper">
                Mark the inside edge of the display. Select a corner, then use arrows to nudge by 1
                px.
              </p>
              {s.candidates.length > 0 && (
                <details className="detection-suggestions">
                  <summary>Detection alternatives ({s.candidates.length})</summary>
                  <div className="candidates">
                    {s.candidates.map((p, i) => (
                      <div className="candidate-row" key={i}>
                        <button
                          className="candidate"
                          aria-label={`Use candidate ${i + 1} for selected screen`}
                          onClick={() => {
                            screen({ quad: p.quad });
                            s.ui({ editScreen: true });
                          }}
                        >
                          <span>{p.label}</span>
                          <span>{Math.round(p.confidence * 100)}% match</span>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Add candidate ${i + 1} as screen`}
                          disabled={screens.length >= 12}
                          onClick={() => addScreen(p.quad)}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </Section>
            <Section title="Calibration">
              <Select
                label="Region mode"
                value={screenMode}
                onChange={setScreenMode}
                options={[
                  ['perspective', '4-point perspective'],
                  ['rectangle', 'Rectangle'],
                ]}
              />
              {screenMode === 'perspective'
                ? activeScreen.quad.map((p, i) => (
                    <div className="corner-row" key={i}>
                      <button
                        className={s.selectedCorner === i ? 'active' : ''}
                        onClick={() => s.ui({ selectedCorner: i, editScreen: true })}
                      >
                        {['TL', 'TR', 'BR', 'BL'][i]}
                      </button>
                      <NumberField
                        label={`${['Top left', 'Top right', 'Bottom right', 'Bottom left'][i]} X`}
                        value={p.x * (s.assets.mockup?.width || 1)}
                        max={s.assets.mockup?.width || 1}
                        onChange={(n) => {
                          const q = structuredClone(activeScreen.quad);
                          q[i].x = n / (s.assets.mockup?.width || 1);
                          if (isConvexQuad(q)) screen({ quad: q });
                        }}
                      />
                      <NumberField
                        label={`${['Top left', 'Top right', 'Bottom right', 'Bottom left'][i]} Y`}
                        value={p.y * (s.assets.mockup?.height || 1)}
                        max={s.assets.mockup?.height || 1}
                        onChange={(n) => {
                          const q = structuredClone(activeScreen.quad);
                          q[i].y = n / (s.assets.mockup?.height || 1);
                          if (isConvexQuad(q)) screen({ quad: q });
                        }}
                      />
                    </div>
                  ))
                : (() => {
                    const mw = s.assets.mockup?.width || 1,
                      mh = s.assets.mockup?.height || 1;
                    const x = Math.min(...activeScreen.quad.map((p) => p.x)) * mw,
                      y = Math.min(...activeScreen.quad.map((p) => p.y)) * mh;
                    const width = Math.max(...activeScreen.quad.map((p) => p.x)) * mw - x,
                      height = Math.max(...activeScreen.quad.map((p) => p.y)) * mh - y;
                    const rect = (nx = x, ny = y, nw = width, nh = height) =>
                      screen({
                        quad: [
                          { x: nx / mw, y: ny / mh },
                          { x: (nx + nw) / mw, y: ny / mh },
                          { x: (nx + nw) / mw, y: (ny + nh) / mh },
                          { x: nx / mw, y: (ny + nh) / mh },
                        ],
                      });
                    return (
                      <div className="two-col">
                        <NumberField
                          label="X"
                          value={x}
                          max={mw - width}
                          onChange={(n) => rect(n)}
                        />
                        <NumberField
                          label="Y"
                          value={y}
                          max={mh - height}
                          onChange={(n) => rect(x, n)}
                        />
                        <NumberField
                          label="Width"
                          value={width}
                          min={1}
                          max={mw - x}
                          onChange={(n) => rect(x, y, n)}
                        />
                        <NumberField
                          label="Height"
                          value={height}
                          min={1}
                          max={mh - y}
                          onChange={(n) => rect(x, y, width, n)}
                        />
                      </div>
                    );
                  })()}
              <button
                className="button full"
                onClick={() =>
                  screen({
                    quad:
                      s.assets.mockup?.name === 'Studio Display.png'
                        ? structuredClone(DEFAULT_QUAD)
                        : [
                            { x: 0.2, y: 0.2 },
                            { x: 0.8, y: 0.2 },
                            { x: 0.8, y: 0.7 },
                            { x: 0.2, y: 0.7 },
                          ],
                  })
                }
              >
                <RotateCcw size={14} /> Reset corners
              </button>
            </Section>
            <Section title="Mask">
              <Slider
                label="Inset / expansion"
                value={activeScreen.inset}
                min={-20}
                max={50}
                suffix=" px"
                onChange={(n) => screen({ inset: n })}
              />
              <Slider
                label="Corner radius"
                value={activeScreen.radius}
                max={100}
                suffix=" px"
                onChange={(n) => screen({ radius: n })}
              />
            </Section>
            <Section title="Display appearance">
              <Select
                label="Screen blend"
                value={activeScreen.blend}
                onChange={(n) => screen({ blend: n as GlobalCompositeOperation })}
                options={[
                  ['source-over', 'Normal'],
                  ['multiply', 'Multiply'],
                  ['screen', 'Screen'],
                  ['overlay', 'Overlay'],
                  ['soft-light', 'Soft light'],
                ]}
              />
              <Slider
                label="Screen opacity"
                value={activeScreen.opacity * 100}
                suffix="%"
                onChange={(n) => screen({ opacity: n / 100 })}
              />
              {(['brightness', 'contrast', 'saturation'] as const).map((key) => (
                <Slider
                  key={key}
                  label={key[0].toUpperCase() + key.slice(1)}
                  value={activeScreen[key]}
                  max={200}
                  suffix="%"
                  onChange={(n) => screen({ [key]: n })}
                />
              ))}
              <Slider
                label="Reflection"
                value={activeScreen.reflection * 100}
                suffix="%"
                onChange={(n) => screen({ reflection: n / 100 })}
              />
              <div className="two-col">
                <button
                  className="button"
                  onClick={() =>
                    screen({
                      brightness: 103,
                      contrast: 105,
                      saturation: 100,
                      reflection: 0.09,
                      opacity: 1,
                      blend: 'source-over',
                    })
                  }
                >
                  Realistic
                </button>
                <button
                  className="button"
                  onClick={() =>
                    screen({
                      brightness: 100,
                      contrast: 100,
                      saturation: 100,
                      reflection: 0,
                      opacity: 1,
                      blend: 'source-over',
                    })
                  }
                >
                  Original
                </button>
              </div>
            </Section>
          </>
        )}
        {s.tab === 'Motion' && (
          <>
            <Section title="Motion preset">
              <div className="preset-grid">
                {MOTION_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={'preset-card ' + (motionPreset === preset.id ? 'selected' : '')}
                    aria-label={`Motion preset ${preset.label}`}
                    aria-pressed={motionPreset === preset.id}
                    title={preset.description}
                    onClick={() =>
                      applyComposition(applyMotionPreset(c, s.assets, preset.id), true)
                    }
                  >
                    <span className="preset-card__icon">
                      <Clapperboard size={17} />
                      {motionPreset === preset.id && <Check size={14} />}
                    </span>
                    <strong className="preset-card__name">{preset.label}</strong>
                    <span className="preset-card__meta">
                      {preset.mode === 'auto'
                        ? `${preset.speed} px/s · Full page`
                        : `${preset.duration}s · ${preset.camera === 'push' ? 'Camera push' : 'Smooth scroll'}`}
                    </span>
                  </button>
                ))}
              </div>
              <p className="preset-status">
                {motionPreset === 'custom'
                  ? 'Custom motion · Your adjustments are active'
                  : MOTION_PRESETS.find((p) => p.id === motionPreset)?.description}
              </p>
            </Section>
            <Section title="Timing & movement">
              <Select
                label="Scroll mode"
                value={m.mode}
                onChange={(n) => motion({ mode: n as MotionSettings['mode'] })}
                options={[
                  ['manual', 'Manual'],
                  ['auto', 'Auto Scroll'],
                  ['cinematic', 'Cinematic'],
                  ['timeline', 'Timeline'],
                ]}
              />
              <div className="two-col">
                <NumberField
                  label="Duration"
                  value={m.duration}
                  min={1}
                  max={300}
                  suffix="sec"
                  onChange={setDuration}
                />
                <Select
                  label="Direction"
                  value={m.direction}
                  onChange={(n) => motion({ direction: n as 'down' | 'up' })}
                  options={[
                    ['down', 'Down'],
                    ['up', 'Up'],
                  ]}
                />
              </div>
              {m.mode === 'auto' && (
                <Slider
                  label="Scroll speed"
                  value={m.speed}
                  min={20}
                  max={1500}
                  suffix=" px/s"
                  onChange={(n) => motion({ speed: n })}
                />
              )}
              <div className="two-col">
                <NumberField
                  label="Start delay"
                  value={m.delay}
                  max={10}
                  step={0.1}
                  suffix="sec"
                  onChange={(n) => motion({ delay: n })}
                />
                <NumberField
                  label="End hold"
                  value={m.endHold}
                  max={10}
                  step={0.1}
                  suffix="sec"
                  onChange={(n) => motion({ endHold: n })}
                />
              </div>
              {(m.mode === 'cinematic' || m.mode === 'timeline') && (
                <Select
                  label="Easing"
                  value={m.easing}
                  onChange={(n) => motion({ easing: n as Easing })}
                  options={easeOptions}
                />
              )}
              {m.mode === 'auto' && (
                <p className="helper">
                  Auto Scroll keeps a constant speed and adjusts the duration to fit the entire
                  page.
                </p>
              )}
              {m.mode === 'manual' && (
                <p className="helper">
                  Manual mode holds your chosen scroll position. Adjust it on the canvas or in
                  Design.
                </p>
              )}
              {(m.mode === 'cinematic' || m.mode === 'timeline') && m.easing === 'bezier' && (
                <div className="two-col">
                  {m.bezier.map((n, i) => (
                    <NumberField
                      key={i}
                      label={['X1', 'Y1', 'X2', 'Y2'][i]}
                      value={n}
                      max={1}
                      step={0.01}
                      onChange={(n) => {
                        const b = [...m.bezier] as MotionSettings['bezier'];
                        b[i] = n;
                        motion({ bezier: b });
                      }}
                    />
                  ))}
                </div>
              )}
              <Toggle label="Loop playback" value={m.loop} onChange={(n) => motion({ loop: n })} />
            </Section>
            {m.mode === 'timeline' && (
              <Section
                title="Keyframes"
                action={
                  <button
                    className="icon-button"
                    title="Add keyframe"
                    onClick={() =>
                      motion({
                        keyframes: [
                          ...m.keyframes,
                          {
                            id: crypto.randomUUID(),
                            time: s.time,
                            progress: metrics.maxScroll ? c.scrollY / metrics.maxScroll : 0,
                            easing: m.easing,
                          },
                        ].sort((a, b) => a.time - b.time),
                      })
                    }
                  >
                    <Plus size={15} />
                  </button>
                }
              >
                {m.keyframes.map((k) => (
                  <div className="keyframe-editor" key={k.id}>
                    <div className="two-col">
                      <NumberField
                        label="Time (sec)"
                        value={k.time}
                        max={m.duration}
                        step={0.1}
                        onChange={(n) =>
                          motion({
                            keyframes: m.keyframes
                              .map((a) => (a.id === k.id ? { ...a, time: n } : a))
                              .sort((a, b) => a.time - b.time),
                          })
                        }
                      />
                      <NumberField
                        label="Scroll %"
                        value={k.progress * 100}
                        max={100}
                        onChange={(n) =>
                          motion({
                            keyframes: m.keyframes.map((a) =>
                              a.id === k.id ? { ...a, progress: n / 100 } : a,
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="keyframe-bottom">
                      <Select
                        label="Segment easing"
                        value={k.easing}
                        onChange={(n) =>
                          motion({
                            keyframes: m.keyframes.map((a) =>
                              a.id === k.id ? { ...a, easing: n as Easing } : a,
                            ),
                          })
                        }
                        options={easeOptions}
                      />
                      <button
                        className="icon-button"
                        title="Remove keyframe"
                        disabled={m.keyframes.length <= 2}
                        onClick={() =>
                          motion({ keyframes: m.keyframes.filter((a) => a.id !== k.id) })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </Section>
            )}
            <Section title="Camera">
              <Select
                label="Camera movement"
                value={m.camera}
                onChange={(n) => motion({ camera: n as MotionSettings['camera'] })}
                options={[
                  ['none', 'None · static mockup'],
                  ['push', 'Slow push in'],
                  ['pull', 'Slow pull out'],
                  ['left', 'Pan left'],
                  ['right', 'Pan right'],
                ]}
              />
              <p className="helper">Subtle 4% movement, independent of the screen scroll.</p>
            </Section>
          </>
        )}
        {s.tab === 'Export' && (
          <>
            <div className="segmented">
              <button
                className={s.exportTab === 'screenshot' ? 'active' : ''}
                onClick={() => s.ui({ exportTab: 'screenshot' })}
              >
                Screenshot
              </button>
              <button
                className={s.exportTab === 'video' ? 'active' : ''}
                onClick={() => s.ui({ exportTab: 'video' })}
              >
                Video
              </button>
            </div>
            <Section title="Ready-to-use presets">
              <div className="preset-grid">
                {OUTPUT_RECIPES.map((preset) => (
                  <button
                    key={preset.id}
                    className={'preset-card ' + (outputRecipe === preset.id ? 'selected' : '')}
                    aria-label={`Output recipe ${preset.label}`}
                    aria-pressed={outputRecipe === preset.id}
                    title={preset.description}
                    onClick={() => {
                      applyComposition(applyOutputRecipe(c, s.assets, preset.id), true);
                      s.ui({ zoom: 0 });
                    }}
                  >
                    <span className="preset-card__icon">
                      {preset.height > preset.width ? (
                        <Smartphone size={18} />
                      ) : (
                        <Monitor size={18} />
                      )}
                      {outputRecipe === preset.id && <Check size={14} />}
                    </span>
                    <strong className="preset-card__name">{preset.label}</strong>
                    <span className="preset-card__meta">
                      {preset.width} × {preset.height}
                    </span>
                  </button>
                ))}
              </div>
              <p className="section-note">
                Sets canvas, framing, motion and export quality. Your images and screen alignment
                stay in place.
              </p>
            </Section>
            <Section title="Output size">
              <button
                className="button full"
                disabled={!s.assets.mockup}
                onClick={() => {
                  s.update(nativeMockupOutput(c, s.assets));
                  s.ui({
                    zoom: 0,
                    exportTab: 'screenshot',
                    notice:
                      'Native mockup resolution selected with lossless PNG. Review design sampling below.',
                  });
                }}
              >
                <ImagePlus size={15} /> Native-size PNG
              </button>
              <p className="helper">
                Use original mockup dimensions. Framing resets; camera and screen effects stay as
                configured. Uploaded files remain unchanged.
              </p>
              <Select
                label="Resolution preset"
                value={
                  RESOLUTION_PRESETS.find((p) => p.id === resolutionPreset)?.label ??
                  resolutionPreset
                }
                onChange={(n) => {
                  if (n === 'custom') return;
                  const id = RESOLUTION_PRESETS.find((p) => p.label === n)?.id ?? n;
                  s.update(applyResolutionPreset(c, s.assets, id));
                  s.ui({ zoom: 0 });
                }}
                options={[
                  ['custom', `Custom · ${o.width} × ${o.height}`],
                  ['original', 'Original Mockup Resolution'],
                  ...RESOLUTION_PRESETS.map(
                    (p) => [p.label, `${p.label} · ${p.width} × ${p.height}`] as [string, string],
                  ),
                ]}
              />
              <div className="two-col">
                <NumberField
                  label="Width"
                  value={o.width}
                  min={16}
                  max={16384}
                  onChange={(n) =>
                    dimensions(n, locked ? Math.round((n * o.height) / o.width) : o.height)
                  }
                />
                <NumberField
                  label="Height"
                  value={o.height}
                  min={16}
                  max={16384}
                  onChange={(n) =>
                    dimensions(locked ? Math.round((n * o.width) / o.height) : o.width, n)
                  }
                />
              </div>
              <Toggle label="Lock aspect ratio" value={locked} onChange={setLocked} />
              <div className="aspect-buttons">
                {ASPECT_RATIOS.map(({ id, label }) => (
                  <button
                    key={label}
                    aria-pressed={matchAspectRatio(c) === id}
                    className={matchAspectRatio(c) === id ? 'active' : ''}
                    onClick={() => {
                      s.update(setCompositionAspect(c, id));
                      s.ui({ zoom: 0 });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Section>
            <Section title="Framing">
              <Select
                label="Scene framing"
                value={o.framing}
                onChange={(n) => output({ framing: n as OutputSettings['framing'] })}
                options={[
                  ['fit', 'Fit mockup'],
                  ['fill', 'Fill output'],
                  ['original', 'Original composition'],
                  ['custom', 'Custom crop'],
                ]}
              />
              <Slider
                label="Mockup scale"
                value={o.scale * 100}
                min={25}
                max={200}
                suffix="%"
                onChange={(n) => output({ scale: n / 100 })}
              />
              <div className="two-col">
                <NumberField
                  label="Horizontal"
                  value={o.x}
                  min={-200}
                  max={200}
                  suffix="%"
                  onChange={(n) => output({ x: n })}
                />
                <NumberField
                  label="Vertical"
                  value={o.y}
                  min={-200}
                  max={200}
                  suffix="%"
                  onChange={(n) => output({ y: n })}
                />
              </div>
              <button className="button full" onClick={() => output({ x: 0, y: 0, scale: 1 })}>
                Center & reset
              </button>
              <Select
                label="Background"
                value={o.background}
                onChange={(n) => output({ background: n as OutputSettings['background'] })}
                options={[
                  ['original', 'Original scene'],
                  ['transparent', 'Transparent'],
                  ['color', 'Solid color'],
                  ['gradient', 'Gradient'],
                  ['image', 'Custom image'],
                ]}
              />
              {['color', 'gradient', 'original'].includes(o.background) && (
                <label className="color-field">
                  {o.background === 'original' ? 'Outside scene' : 'Background color'}
                  <input
                    type="color"
                    aria-label="Background color"
                    value={o.color}
                    onChange={(e) => output({ color: e.target.value })}
                  />
                </label>
              )}
              {o.background === 'gradient' && (
                <label className="color-field">
                  Second color
                  <input
                    type="color"
                    aria-label="Second gradient color"
                    value={o.color2}
                    onChange={(e) => output({ color2: e.target.value })}
                  />
                </label>
              )}
              {o.background === 'image' && (
                <button className="button full" onClick={() => actions.upload('background')}>
                  <ImagePlus size={15} /> Choose background
                </button>
              )}
            </Section>
            {s.exportTab === 'screenshot' ? (
              <>
                <Section title="Image settings">
                  <div className="two-col">
                    <Select
                      label="Format"
                      value={c.screenshot.format}
                      onChange={(n) => shot({ format: n as ScreenshotSettings['format'] })}
                      options={[
                        ['png', 'PNG · lossless'],
                        ['jpeg', 'JPEG'],
                        ['webp', 'WebP'],
                      ]}
                    />
                    <Select
                      label="Export scale"
                      value={c.screenshot.scale}
                      onChange={(n) => shot({ scale: +n })}
                      options={['1', '2', '3', '4'].map((n) => [n, `${n}×`])}
                    />
                  </div>
                  {c.screenshot.format !== 'png' && (
                    <Slider
                      label="Quality"
                      value={c.screenshot.quality * 100}
                      min={50}
                      max={100}
                      suffix="%"
                      onChange={(n) => shot({ quality: n / 100 })}
                    />
                  )}
                  <label className="field">
                    <span>Filename (optional)</span>
                    <input
                      value={c.screenshot.filename}
                      placeholder="mockup-studio-date-4k"
                      onChange={(e) => shot({ filename: e.target.value })}
                    />
                  </label>
                  {c.screenshot.format === 'jpeg' && (
                    <p className="helper">JPEG flattens transparent pixels onto white.</p>
                  )}
                  <div className="export-summary">
                    <strong>
                      {o.width * c.screenshot.scale} × {o.height * c.screenshot.scale}
                    </strong>
                    <span>
                      {c.screenshot.format.toUpperCase()} ·{' '}
                      {c.screenshot.format === 'png'
                        ? 'Lossless'
                        : `${Math.round(c.screenshot.quality * 100)}% quality`}
                    </span>
                  </div>
                  {renderSource()}
                </Section>
              </>
            ) : (
              <>
                <Section title="Recording settings">
                  <Select
                    label="Motion export format"
                    value={v.format ?? 'webm'}
                    onChange={(n) => video({ format: n as VideoSettings['format'] })}
                    options={[
                      ['webm', 'WebM video'],
                      ['png-sequence', 'PNG frames · lossless ZIP'],
                    ]}
                  />
                  <div className="two-col">
                    <Select
                      label="Frame rate"
                      value={v.fps}
                      onChange={(n) => s.update(setCompositionFrameRate(c, +n))}
                      options={['24', '25', '30', '50', '60'].map((n) => [n, `${n} fps`])}
                    />
                    <NumberField
                      label="Duration"
                      value={v.duration}
                      min={1}
                      max={300}
                      suffix="sec"
                      onChange={setDuration}
                    />
                  </div>
                  {v.format !== 'png-sequence' && (
                    <>
                      <NumberField
                        label="Video bitrate"
                        value={v.bitrate}
                        min={1}
                        max={150}
                        suffix="Mbps"
                        onChange={(n) => video({ bitrate: n })}
                      />
                      <Select
                        label="Quality preset"
                        value={matchQualityPreset(c)}
                        onChange={(n) => {
                          if (n !== 'custom') s.update(applyQualityPreset(c, n));
                        }}
                        options={[
                          ['custom', `${v.bitrate} Mbps · Custom`],
                          ...QUALITY_PRESETS.map(
                            (p) =>
                              [p.id, `${p.label} · ${qualityBitrate(v, p.id)} Mbps`] as [
                                string,
                                string,
                              ],
                          ),
                        ]}
                      />
                      <p className="helper">
                        Preset bitrates adapt to your resolution and frame rate.
                      </p>
                      <Select
                        label="Render method"
                        value={v.mode}
                        onChange={(n) => video({ mode: n as VideoSettings['mode'] })}
                        options={[
                          ['maximum', 'Maximum Quality Render'],
                          ['realtime', 'Real-time recording'],
                        ]}
                      />
                      <p className="helper">
                        {v.mode === 'maximum'
                          ? 'Renders every frame from original sources at the selected dimensions. Requires a supported WebCodecs encoder; video compression is lossy.'
                          : 'Records a dedicated canvas at the selected resolution. Keep this tab visible for smooth motion.'}
                      </p>
                      <Select
                        label="Codec"
                        value={v.codec}
                        onChange={(n) => video({ codec: n as VideoSettings['codec'] })}
                        options={[
                          ['auto', 'Best supported'],
                          ...(caps?.codecs
                            .filter((a) => a.webCodecs || a.mediaRecorder)
                            .map((a) => [a.id, a.label] as [string, string]) || []),
                        ]}
                      />
                    </>
                  )}
                  {v.format === 'png-sequence' && (
                    <p className="helper">
                      Every frame renders from your original files as a lossless PNG, with
                      transparency. Download a ZIP with numbered frames and timing information for
                      your video editor. Archives are limited to 512 MB; shorter clips use less
                      memory. Output dimensions are never reduced automatically.
                    </p>
                  )}
                  <div className="export-summary">
                    <strong>
                      {v.width} × {v.height} · {v.fps} fps
                    </strong>
                    <span>
                      {v.format === 'png-sequence'
                        ? `${Math.ceil(v.fps * v.duration)} PNG frames · ${v.duration} sec · ZIP`
                        : `${v.duration} sec · ~${fileSize(estimateVideoSize(v))} · WebM`}
                    </span>
                  </div>
                  {renderSource()}
                </Section>
                {v.format !== 'png-sequence' && (
                  <Section title="Browser capabilities">
                    <div className="support-row">
                      Canvas 2D <Check size={14} />
                    </div>
                    <div className="support-row">
                      OffscreenCanvas{' '}
                      <span>
                        {typeof OffscreenCanvas !== 'undefined' ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                    <div className="support-row">
                      WebCodecs <span>{caps?.webCodecs ? 'Available' : 'Unavailable'}</span>
                    </div>
                    <div className="support-row">
                      MediaRecorder <span>{caps?.mediaRecorder ? 'Available' : 'Unavailable'}</span>
                    </div>
                  </Section>
                )}
              </>
            )}
          </>
        )}
      </div>
      {s.tab === 'Export' && (
        <div className="export-dock">
          <div>
            <strong>
              {s.exportTab === 'video'
                ? `${v.width} × ${v.height}`
                : `${o.width * c.screenshot.scale} × ${o.height * c.screenshot.scale}`}
            </strong>
            <span>
              {s.exportTab === 'video'
                ? `${v.fps} fps · ${v.duration.toFixed(1)}s · ${v.format === 'png-sequence' ? 'Lossless PNG' : 'WebM'}`
                : `${c.screenshot.format.toUpperCase()} · ${c.screenshot.scale}× scale`}
            </span>
          </div>
          <button
            className="button primary full export-button"
            onClick={s.exportTab === 'video' ? actions.record : actions.screenshot}
            disabled={!s.assets.mockup}
          >
            {s.exportTab === 'video' ? <Video size={16} /> : <Download size={16} />}
            {s.exportTab === 'video'
              ? v.format === 'png-sequence'
                ? 'Export PNG sequence'
                : 'Render Video'
              : 'Export screenshot'}
          </button>
        </div>
      )}
      <div className="property-footer">
        <span className="local-indicator" /> Your files stay on this device
      </div>
    </aside>
  );
}
