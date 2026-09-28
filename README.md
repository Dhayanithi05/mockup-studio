# Mockup Studio

A local browser editor for placing long Figma or website image exports inside device mockups, animating multiple screens, and exporting screenshots, WebM videos, or lossless PNG frame sequences at explicit output dimensions.

## Run locally

Use a current Node.js LTS installation, then run:

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. `npm run build` creates the deployable static app in `dist`; `npm run preview` serves that build locally. HTTPS or localhost is required for WebCodecs in supporting browsers.

On Windows, you can also run `Start Mockup Studio.cmd` after installing dependencies. The editor is served at `http://127.0.0.1:4175`. Keep the terminal running while using the app.

```sh
npm run typecheck
npm run lint
npm run test
npm run build
```

## Workflow

1. Start with the supplied monitor and tall website demo, or import a design and a mockup.
2. Choose the design fit and detect screens. Confident detections automatically fill up to 12 separate screens, including angled displays. Select each screen to inspect its four corners; add or remove regions manually when needed.
3. Rename, hide, align, and adjust each screen independently, including inset, rounding, color controls, and reflection. The original design fills all enabled screens, with synchronized scroll progress. A foreground overlay can cover the full scene.
4. Select manual, auto, cinematic, or keyframed scrolling. Preview the motion and adjust direction, speed, easing, holds, and subtle camera movement.
5. Set output framing and background, then choose screenshot or video dimensions independently of editor zoom.
6. Save the project locally in this browser, or export the finished media. Saved projects include the original source image blobs.

### Presets and typography

The interface uses locally served Space Grotesk. Motion cards apply complete settings for UX Case Study, Portfolio Slow, Product Showcase, Fast Overview, and Social Reel. The active card is derived from the actual settings; changing a setting shows Custom. Auto scrolling computes its duration from the design length and speed so preview and video both reach the end.

Export recipes configure framing, resolution, motion, and quality together for Portfolio 4K, Cinematic, Instagram Reel, Instagram Post, Behance Landscape, and YouTube. Resolution presets preserve the composition's other settings. Quality presets adapt bitrate when resolution or frame rate changes; a custom bitrate is retained. Aspect buttons produce exact ratios with even dimensions and a stable short edge. Duration edits scale pauses and keyframes together.

## Source quality and export behavior

Uploaded images retain their original blobs and decoded dimensions. Preview scaling, detection analysis, and cropping do not rewrite the source. Download original files from their asset cards, or save them with every screen's settings in a local project. For PNG, JPEG, and WebP, decoded dimensions are checked against the source header to reject browser downscaling. The demo assets were extracted from the supplied HTML prototype; their source resolution determines their actual detail. A larger output raster does not invent missing source detail.

The preview and export share the same scene renderer, but exports allocate dedicated canvases at the selected output size. A 3840 × 2160 export therefore contains a real 3840 × 2160 raster. The preview renders only the visible viewport at the display's pixel density, so zooming into large images does not use a downscaled 4096-pixel proxy. Screenshot scale multiplies both output dimensions; scale does not change the source file. Fractional final pixel dimensions are rejected.

Use **Native-size PNG** to match the mockup's original dimensions and reset output framing. Camera motion and screen appearance remain as configured. The source-detail readout reports when the mockup or individual designs are enlarged or reduced, including estimated perspective magnification.

- PNG is lossless and preserves transparency. JPEG and WebP use the selected encoder quality. Transparent JPEG regions become white.
- Choose **PNG frames · lossless ZIP** for motion without lossy encoding. Each numbered PNG renders from the original images, with a timing manifest for import into a video editor. The archive uses uncompressed ZIP entries because PNG data is already compressed losslessly. The in-memory archive limit is 512 MB; exceeding it stops the export without changing its dimensions or image quality.
- Maximum quality video uses WebCodecs when the selected codec and exact dimensions are supported. It renders each frame at a deterministic timeline time, supplies explicit microsecond timestamps, configures the chosen FPS and Mbps bitrate, and packages the encoded frames into WebM.
- The exporter tries VP9, AV1, and VP8 when codec is Auto. An explicit codec selection is respected. Support is probed using the requested dimensions, framerate, and bitrate.
- Maximum mode reports an error if the exact settings are unsupported; it never silently switches to real-time recording. When you explicitly select Real-time mode, MediaRecorder captures a dedicated canvas at the chosen resolution. Keep the tab visible. Motion follows elapsed time; actual capture FPS and encoder bitrate depend on browser and system performance.
- WebM video uses lossy compression, with transparent regions flattened to black. Choose PNG frames when lossless rendered pixels or transparency are required. This implementation does not provide MP4 export or record audio.
- Bitrate is an encoder target rather than a guaranteed file size. The estimate includes a small container allowance; content and codec affect the result.

The app rejects unsafe allocations instead of silently reducing the requested dimensions: maximum 16,384 pixels per side, 100 megapixels per canvas, and a 1 GB estimated in-memory video export. Browser or GPU limits may be lower. Export errors report unsupported settings; choose smaller dimensions explicitly when needed. Source images may also exceed the device's decode limits even when their compressed file size is small.

Compositing uses the browser's 8-bit sRGB Canvas 2D pipeline. A lossless PNG preserves the rendered pixel values; resizing, perspective, color effects, and transparent compositing can change those values. Exports do not preserve source metadata, HDR, or higher source bit depth. Original-file downloads and stored source blobs retain the uploaded bytes.

## Local data

There is no core backend and no image-upload service. Imported assets stay in browser memory; saved projects use IndexedDB in the current browser profile and origin. Clearing site data removes saved projects. Browser storage quotas apply. Demo assets, app code, and the detection runtime are served with the application.

Direct `.fig` rendering is not supported. Export a Figma frame as PNG, JPEG, WebP, or a self-contained SVG. External Figma fetching and cloud sharing are not implemented.

## Architecture

| Area                           | Responsibility                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/state/`                   | Typed composition state, defaults, editor state, and undo/redo                                  |
| `src/components/`              | Preview, inspector controls, screen editing, and timeline UI                                    |
| `src/engine/image.ts`          | Original source blobs, image decode, metadata, and resource cleanup                             |
| `src/engine/geometry.ts`       | Screen dimensions, crop/fit geometry, and output transforms                                     |
| `src/engine/perspective.ts`    | Projective screen mapping with a subdivided canvas mesh                                         |
| `src/engine/renderer.ts`       | Shared scene compositing and bounded screen scratch layers                                      |
| `src/engine/screens.ts`        | Multiple regions, independent edits, and synchronized original-source scrolling                 |
| `src/engine/quality.ts`        | Native-size output and per-screen source magnification estimates                                |
| `src/engine/timeline.ts`       | Time-based scrolling, cubic Bezier easing, and keyframe interpolation                           |
| `src/engine/presets.ts`        | Complete preset configurations, selected-state matching, dimensions, and timing synchronization |
| `src/engine/detection*`        | Background screen analysis, candidate scoring, and manual fallback                              |
| `src/engine/export.ts`         | Dedicated export canvases, format encoding, codec detection, cancellation, and cleanup          |
| `src/engine/frame-sequence.ts` | Lossless PNG frames, deterministic timing, and bounded ZIP assembly                             |
| `src/engine/persistence.ts`    | Local IndexedDB project storage                                                                 |
| `tests/`                       | Geometry, timeline, detection, and export validation tests                                      |

Screen points are stored as normalized mockup coordinates in clockwise top-left, top-right, bottom-right, bottom-left order. The design is clipped to the screen; the mockup remains static unless camera motion is explicitly enabled. Framing scales proportionally and crops or pads rather than stretching.

## Practical limitations

Automatic detection is a computer-vision heuristic, not a guarantee. Reflections, borderless screens, dark content, and occlusions can require manual correction. Duplicate bezel candidates are suppressed while physically separate screens are retained. Projective mapping uses a high-density triangle mesh over a homography; extreme perspective can expose interpolation artifacts.

Maximum quality export runs incrementally on the main thread and yields between batches. Large rasters and long videos can still consume substantial CPU and memory. Cancellation closes the encoder or recorder and releases temporary canvases and tracks. MediaRecorder support checks cannot prove that a particular high-resolution capture will succeed; the actual recorder can still fail at runtime.

Settings undo/redo does not restore a replaced source file. Keep the original asset available when trying multiple mockups. The app has no server-side render farm, collaboration service, arbitrary `.fig` parser, or guaranteed cross-browser MP4 encoder.

## Verification

Verified in desktop Google Chrome on Windows:

- 175 unit tests cover presets and preset selection, geometry, fit/crop math, normalized coordinates, synchronized multi-screen scrolling, detection ranking, image-header validation, source sampling, canvas limits, codec negotiation, WebM duration, and PNG-sequence ZIP integrity and cancellation.
- 37 browser preset checks cover motion, duration, resolution, aspect ratios, bitrate, complete output recipes, undo/redo, and locally loaded Space Grotesk.
- Pixel-level browser tests verify byte-for-byte original uploads, exact native-size mockup and dual-screen PNG pixels, and a 2560 × 2560 export with a scrolled 2304 × 6144 design. Viewport tiles are checked against full-scene rendering, including perspective and effects.
- A real lossless sequence is checked frame by frame for exact rendered pixels, both screens' motion, transparency, archive checksums, timing metadata, and cancellation.
- The browser workflow imports a genuine 3000 × 16000 PNG and verifies its original dimensions and blob size, replaces a mockup, accepts automatic detection, changes manual calibration, and saves/reopens the original assets with IndexedDB.
- Downloaded PNG headers are checked at 1920 × 1080, 3840 × 2160, and 1080 × 1920.
- Native video playback confirms 1080p and 4K WebCodecs files, explicitly selected 1080p MediaRecorder recording, correct dimensions and duration, and cancellation. The browser checks use short one-second clips; sustained 4K throughput varies by machine.
- A production-bundled OpenCV worker identifies a phone screen, a transparent screen opening, and two- and three-screen mockups including perspective. Pixel checks verify alignment, rounded masks, original-source scroll crops, and no content outside the screen.
- Laptop (1280 × 720) and mobile (390 × 844) layouts are checked for horizontal overflow.

Run browser checks with the dev server running: `node scripts/verify-presets.mjs`, `node scripts/verify-multiscreen.mjs`, `node scripts/verify-sequence.mjs`, `node tests/quality.browser.mjs`, `node scripts/verify-video.mjs`, and `node tests/renderer.browser.mjs`. Run `node tests/verify-detection.mjs --production` to validate the standalone detector bundle, or `node scripts/verify-production.mjs` after a build to check the shipped UI and a real download. Run browser checks sequentially to keep memory use manageable. These checks use an installed Chrome browser through Playwright. The supplied demo mockup is 700 × 525 and its design is 441 × 2048; use higher-resolution assets for detailed 4K output.
