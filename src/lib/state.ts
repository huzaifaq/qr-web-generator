// Style configuration: types, defaults, (de)serialization and the mapping to
// qr-code-styling options. Content (the encoded data) is kept separately so
// that saved/shared styles never contain things like WiFi passwords.

import type {
  CornerDotType,
  CornerSquareType,
  DotType,
  ErrorCorrectionLevel,
  Gradient,
  Options,
  ShapeType,
} from 'qr-code-styling';
import { DEFAULT_SHAPE_SVG, MAX_SHAPE_SOURCE } from './shapes';

export type FillMode = 'solid' | 'linear' | 'radial';

export interface Fill {
  mode: FillMode;
  color: string;
  color2: string;
  /** Gradient rotation in degrees (linear only). */
  rotation: number;
}

export interface StyleConfig {
  dots: { type: DotType; fill: Fill };
  cornersSquare: { type: CornerSquareType | ''; matchDots: boolean; fill: Fill };
  cornersDot: { type: CornerDotType | ''; matchDots: boolean; fill: Fill };
  background: { transparent: boolean; fill: Fill; round: number };
  shape: ShapeType;
  /** Quiet zone in px at the 300px base size; scaled on export. */
  margin: number;
  errorCorrection: ErrorCorrectionLevel;
  logo: { size: number; margin: number; hideBackgroundDots: boolean };
  /** Custom SVG shape drawn in place of each dot. */
  customDot: CustomShapeConfig;
  /** Custom SVG shape drawn in place of the three corner (finder) dots. */
  customCornerDot: CustomShapeConfig;
}

export interface CustomShapeConfig {
  enabled: boolean;
  source: string;
  /** Size relative to the area it replaces (one module, or the 3×3 corner dot). */
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  randomRotation: boolean;
}

/** Style keys that hold a custom shape; also the shape editor's targets. */
export type CustomShapeKey = 'customDot' | 'customCornerDot';

export interface Option<T extends string = string> {
  value: T;
  label: string;
}

export const DOT_TYPES: Option<DotType>[] = [
  { value: 'square', label: 'Square' },
  { value: 'dots', label: 'Dots' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'extra-rounded', label: 'Extra rounded' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy rounded' },
];

export const CORNER_SQUARE_TYPES: Option<CornerSquareType | ''>[] = [
  { value: '', label: 'Match dots' },
  { value: 'square', label: 'Square' },
  { value: 'extra-rounded', label: 'Extra rounded' },
  { value: 'dot', label: 'Circle' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy rounded' },
];

export const CORNER_DOT_TYPES: Option<CornerDotType | ''>[] = [
  { value: '', label: 'Match dots' },
  { value: 'square', label: 'Square' },
  { value: 'dot', label: 'Circle' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'extra-rounded', label: 'Extra rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy rounded' },
];

export const ERROR_LEVELS: Option<ErrorCorrectionLevel>[] = [
  { value: 'L', label: 'Low (7%)' },
  { value: 'M', label: 'Medium (15%)' },
  { value: 'Q', label: 'Quartile (25%)' },
  { value: 'H', label: 'High (30%)' },
];

export const BASE_SIZE = 300;

const solid = (color: string, color2 = color): Fill => ({ mode: 'solid', color, color2, rotation: 0 });

export const DEFAULT_STYLE: StyleConfig = {
  dots: { type: 'square', fill: solid('#111827', '#4f46e5') },
  cornersSquare: { type: '', matchDots: true, fill: solid('#111827', '#4f46e5') },
  cornersDot: { type: '', matchDots: true, fill: solid('#111827', '#4f46e5') },
  background: { transparent: false, fill: solid('#ffffff', '#e0e7ff'), round: 0 },
  shape: 'square',
  margin: 12,
  errorCorrection: 'M',
  logo: { size: 0.35, margin: 4, hideBackgroundDots: true },
  customDot: {
    enabled: false,
    source: DEFAULT_SHAPE_SVG,
    // Slightly larger than one module: decoders sample module centers and many
    // shapes (stars, sparkles…) leave too little ink there at 100%.
    scale: 1.2,
    rotation: 0,
    flipX: false,
    flipY: false,
    randomRotation: false,
  },
  customCornerDot: {
    enabled: false,
    source: DEFAULT_SHAPE_SVG,
    // Scanners find the code by the 1:1:3:1:1 stripes across each corner marker;
    // a corner shape slightly larger than its 3×3 area keeps that ratio readable.
    scale: 1.3,
    rotation: 0,
    flipX: false,
    flipY: false,
    randomRotation: false,
  },
};

export function cloneStyle(style: StyleConfig): StyleConfig {
  return structuredClone(style);
}

/**
 * Deep-merge `input` onto `base`, keeping only keys that exist in `base` and
 * whose value type matches. Used for presets and untrusted (hash/storage) data.
 */
export function mergeKnown<T>(base: T, input: unknown): T {
  if (typeof base !== 'object' || base === null || typeof input !== 'object' || input === null) {
    return typeof input === typeof base ? (input as T) : base;
  }
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (key in input) out[key] = mergeKnown(out[key], (input as Record<string, unknown>)[key]);
  }
  return out as T;
}

const FILL_MODES: FillMode[] = ['solid', 'linear', 'radial'];
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);

function sanitizeFill(fill: Fill, fallback: Fill): Fill {
  return {
    mode: FILL_MODES.includes(fill.mode) ? fill.mode : fallback.mode,
    color: HEX.test(fill.color) ? fill.color : fallback.color,
    color2: HEX.test(fill.color2) ? fill.color2 : fallback.color2,
    rotation: clamp(fill.rotation, 0, 360),
  };
}

function sanitizeCustomShape(c: CustomShapeConfig, fallback: CustomShapeConfig): CustomShapeConfig {
  return {
    enabled: c.enabled,
    source: c.source.length <= MAX_SHAPE_SOURCE ? c.source : fallback.source,
    scale: clamp(c.scale, 0.3, 1.5),
    rotation: clamp(c.rotation, 0, 360),
    flipX: c.flipX,
    flipY: c.flipY,
    randomRotation: c.randomRotation,
  };
}

/**
 * Older styles had `customDot.cornerDots` (reuse the dot shape for the corner
 * dots). Translate it to an equivalent `customCornerDot`.
 */
function migrate(input: unknown): unknown {
  const raw = input as { customDot?: Record<string, unknown>; customCornerDot?: unknown } | null;
  if (!raw?.customDot || raw.customDot.cornerDots !== true || raw.customCornerDot) return input;
  return { ...raw, customCornerDot: { ...raw.customDot, scale: DEFAULT_STYLE.customCornerDot.scale } };
}

function pick<T extends string>(value: T, options: Option<T>[], fallback: T): T {
  return options.some((o) => o.value === value) ? value : fallback;
}

/** Merge untrusted input onto the defaults and clamp every value to a valid one. */
export function sanitizeStyle(input: unknown): StyleConfig {
  const d = DEFAULT_STYLE;
  const s = mergeKnown(cloneStyle(d), migrate(input));
  return {
    dots: { type: pick(s.dots.type, DOT_TYPES, d.dots.type), fill: sanitizeFill(s.dots.fill, d.dots.fill) },
    cornersSquare: {
      type: pick(s.cornersSquare.type, CORNER_SQUARE_TYPES, d.cornersSquare.type),
      matchDots: s.cornersSquare.matchDots,
      fill: sanitizeFill(s.cornersSquare.fill, d.cornersSquare.fill),
    },
    cornersDot: {
      type: pick(s.cornersDot.type, CORNER_DOT_TYPES, d.cornersDot.type),
      matchDots: s.cornersDot.matchDots,
      fill: sanitizeFill(s.cornersDot.fill, d.cornersDot.fill),
    },
    background: {
      transparent: s.background.transparent,
      fill: sanitizeFill(s.background.fill, d.background.fill),
      round: clamp(s.background.round, 0, 1),
    },
    shape: s.shape === 'circle' ? 'circle' : 'square',
    margin: clamp(s.margin, 0, 60),
    errorCorrection: pick(s.errorCorrection, ERROR_LEVELS, d.errorCorrection),
    logo: {
      size: clamp(s.logo.size, 0.1, 0.6),
      margin: clamp(s.logo.margin, 0, 20),
      hideBackgroundDots: s.logo.hideBackgroundDots,
    },
    customDot: sanitizeCustomShape(s.customDot, d.customDot),
    customCornerDot: sanitizeCustomShape(s.customCornerDot, d.customCornerDot),
  };
}

export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

export function setByPath(obj: object, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, obj as Record<string, unknown>);
  if (target && last in target) target[last] = value;
}

function fillToOptions(fill: Fill): { color: string; gradient?: Gradient } {
  if (fill.mode === 'solid') return { color: fill.color };
  return {
    color: fill.color,
    gradient: {
      type: fill.mode,
      rotation: (fill.rotation * Math.PI) / 180,
      colorStops: [
        { offset: 0, color: fill.color },
        { offset: 1, color: fill.color2 },
      ],
    },
  };
}

export interface RenderInput {
  style: StyleConfig;
  data: string;
  logo?: string;
  size?: number;
  type?: 'svg' | 'canvas';
  /** Force an opaque background (e.g. JPEG export). */
  opaque?: boolean;
  /**
   * A custom dot shape will be swapped in by an extension: draw dots as plain
   * squares and resolve "Match dots" corners to the selected dot type.
   */
  customDots?: boolean;
  /** A custom corner dot shape will be swapped in: draw corner dots as squares. */
  customCornerDots?: boolean;
}

export function toQrOptions({
  style,
  data,
  logo,
  size = BASE_SIZE,
  type = 'svg',
  opaque = false,
  customDots = false,
  customCornerDots = false,
}: RenderInput): Options {
  const scale = size / BASE_SIZE;
  const dotType: DotType = customDots ? 'square' : style.dots.type;
  const cornerSquareType = customDots ? style.cornersSquare.type || style.dots.type : style.cornersSquare.type || undefined;
  const cornerDotType = customCornerDots
    ? 'square'
    : customDots
      ? style.cornersDot.type || style.dots.type
      : style.cornersDot.type || undefined;
  const dotsFill = fillToOptions(style.dots.fill);
  const bg = style.background.transparent
    ? { color: opaque ? '#ffffff' : 'transparent' }
    : fillToOptions(style.background.fill);

  return {
    type,
    width: size,
    height: size,
    data,
    margin: Math.round(style.margin * scale),
    shape: style.shape,
    image: logo || undefined,
    qrOptions: {
      typeNumber: 0,
      mode: 'Byte',
      errorCorrectionLevel: logo ? 'H' : style.errorCorrection,
    },
    imageOptions: {
      hideBackgroundDots: style.logo.hideBackgroundDots,
      imageSize: style.logo.size,
      margin: Math.round(style.logo.margin * scale),
      crossOrigin: 'anonymous',
    },
    dotsOptions: { type: dotType, ...dotsFill },
    cornersSquareOptions: {
      type: cornerSquareType,
      ...(style.cornersSquare.matchDots ? dotsFill : fillToOptions(style.cornersSquare.fill)),
    },
    cornersDotOptions: {
      type: cornerDotType,
      ...(style.cornersDot.matchDots ? dotsFill : fillToOptions(style.cornersDot.fill)),
    },
    backgroundOptions: { round: style.background.round, ...bg },
  };
}

/** Encode a style as URL-safe base64 JSON. */
export function encodeStyle(style: StyleConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(style));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeStyle(encoded: string): StyleConfig | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return sanitizeStyle(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
