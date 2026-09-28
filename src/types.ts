export interface Point {
  x: number;
  y: number;
}
export type Quad = [Point, Point, Point, Point];
export interface ImageAsset {
  id: string;
  name: string;
  blob: Blob;
  url: string;
  bitmap: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  type: string;
  size: number;
}
export type FitMode = 'width' | 'height' | 'cover' | 'contain' | 'actual' | 'custom';
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier';
export interface TimelineKeyframe {
  id: string;
  time: number;
  progress: number;
  easing: Easing;
}
export interface ScreenRegion {
  id?: string;
  name?: string;
  enabled?: boolean;
  quad: Quad;
  inset: number;
  radius: number;
  opacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
  reflection: number;
  blend: GlobalCompositeOperation;
}
export interface MotionSettings {
  mode: 'manual' | 'auto' | 'cinematic' | 'timeline';
  speed: number;
  direction: 'down' | 'up';
  duration: number;
  delay: number;
  endHold: number;
  loop: boolean;
  easing: Easing;
  bezier: [number, number, number, number];
  camera: 'none' | 'push' | 'pull' | 'left' | 'right';
  keyframes: TimelineKeyframe[];
}
export interface OutputSettings {
  width: number;
  height: number;
  framing: 'fit' | 'fill' | 'original' | 'custom';
  scale: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  background: 'original' | 'transparent' | 'color' | 'gradient' | 'image';
  color: string;
  color2: string;
}
export interface ScreenshotSettings {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  scale: number;
  filename: string;
}
export interface VideoSettings {
  format?: 'webm' | 'png-sequence';
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  duration: number;
  codec: 'auto' | 'vp9' | 'vp8' | 'av1';
  mode: 'maximum' | 'realtime';
}
export interface CompositionState {
  name: string;
  screen: ScreenRegion;
  extraScreens?: ScreenRegion[];
  designFit: FitMode;
  designScale: number;
  scrollY: number;
  motion: MotionSettings;
  output: OutputSettings;
  screenshot: ScreenshotSettings;
  video: VideoSettings;
}
export interface Assets {
  mockup: ImageAsset | null;
  design: ImageAsset | null;
  background: ImageAsset | null;
  foreground: ImageAsset | null;
}
export interface RenderOptions {
  viewport?: { x: number; y: number; width: number; height: number };
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  composition: CompositionState;
  assets: Assets;
  currentTime?: number;
  quality?: 'preview' | 'export';
  scrollY?: number;
}
export interface DetectionCandidate {
  quad: Quad;
  confidence: number;
  label: string;
}
export interface ExportProgress {
  phase: string;
  progress: number;
}
