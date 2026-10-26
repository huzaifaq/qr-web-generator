import { DEFAULT_STYLE, DOT_TYPES, CORNER_SQUARE_TYPES, CORNER_DOT_TYPES, cloneStyle, sanitizeStyle } from './state';
import type { Fill, StyleConfig } from './state';
import { hslToHex } from './contrast';
import { SHAPE_LIBRARY } from './shapes';

const shapeSvg = (id: string) => SHAPE_LIBRARY.find((s) => s.id === id)!.svg;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Preset {
  id: string;
  name: string;
  /** Colors used to draw the preset swatch: [foreground, background]. */
  swatch: [string, string];
  /** Library shape id drawn in the swatch instead of square dots. */
  swatchShape?: string;
  style: DeepPartial<StyleConfig>;
}

const lin = (color: string, color2: string, rotation = 45): Fill => ({ mode: 'linear', color, color2, rotation });
const rad = (color: string, color2: string): Fill => ({ mode: 'radial', color, color2, rotation: 0 });
const sol = (color: string): Fill => ({ mode: 'solid', color, color2: color, rotation: 0 });

export const PRESETS: Preset[] = [
  {
    id: 'classic',
    name: 'Classic',
    swatch: ['#000000', '#ffffff'],
    style: { dots: { type: 'square', fill: sol('#000000') }, background: { fill: sol('#ffffff') } },
  },
  {
    id: 'rounded-blue',
    name: 'Rounded Blue',
    swatch: ['#1d4ed8', '#eff6ff'],
    style: {
      dots: { type: 'rounded', fill: sol('#1d4ed8') },
      cornersSquare: { type: 'extra-rounded', matchDots: false, fill: sol('#1e3a8a') },
      cornersDot: { type: 'dot', matchDots: false, fill: sol('#2563eb') },
      background: { fill: sol('#eff6ff'), round: 0.15 },
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    swatch: ['#db2777', '#fff7ed'],
    style: {
      dots: { type: 'classy-rounded', fill: lin('#db2777', '#ea580c', 45) },
      cornersSquare: { type: 'extra-rounded', matchDots: true },
      cornersDot: { type: 'dot', matchDots: true },
      background: { fill: sol('#fff7ed'), round: 0.1 },
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatch: ['#0e7490', '#ecfeff'],
    style: {
      dots: { type: 'dots', fill: rad('#0f766e', '#1e40af') },
      cornersSquare: { type: 'extra-rounded', matchDots: false, fill: sol('#0e7490') },
      cornersDot: { type: 'dot', matchDots: false, fill: sol('#0e7490') },
      background: { fill: lin('#ecfeff', '#e0f2fe', 135) },
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    swatch: ['#166534', '#f0fdf4'],
    style: {
      dots: { type: 'classy', fill: lin('#14532d', '#15803d', 90) },
      cornersSquare: { type: 'square', matchDots: false, fill: sol('#14532d') },
      cornersDot: { type: 'square', matchDots: false, fill: sol('#65a30d') },
      background: { fill: sol('#f0fdf4') },
    },
  },
  {
    id: 'grape',
    name: 'Grape Soda',
    swatch: ['#7c3aed', '#faf5ff'],
    style: {
      dots: { type: 'extra-rounded', fill: lin('#6d28d9', '#c026d3', 135) },
      cornersSquare: { type: 'dot', matchDots: true },
      cornersDot: { type: 'dot', matchDots: true },
      background: { fill: sol('#faf5ff'), round: 0.2 },
    },
  },
  {
    id: 'circle-badge',
    name: 'Circle Badge',
    swatch: ['#0f172a', '#fde68a'],
    style: {
      shape: 'circle',
      dots: { type: 'dots', fill: sol('#0f172a') },
      cornersSquare: { type: 'dot', matchDots: true },
      cornersDot: { type: 'dot', matchDots: true },
      background: { fill: rad('#fef3c7', '#fcd34d') },
      margin: 6,
    },
  },
  {
    id: 'mono-dots',
    name: 'Minimal Dots',
    swatch: ['#374151', '#f9fafb'],
    style: {
      dots: { type: 'dots', fill: sol('#374151') },
      cornersSquare: { type: 'dot', matchDots: true },
      cornersDot: { type: 'dot', matchDots: true },
      background: { fill: sol('#f9fafb') },
    },
  },
  {
    id: 'starry',
    name: 'Starry Night',
    swatch: ['#1e3a8a', '#fefce8'],
    swatchShape: 'star',
    style: {
      dots: { type: 'square', fill: lin('#1e3a8a', '#7c3aed', 135) },
      customDot: { enabled: true, source: shapeSvg('star'), scale: 1.25, randomRotation: true },
      cornersSquare: { type: 'extra-rounded', matchDots: false, fill: sol('#1e3a8a') },
      cornersDot: { type: 'dot', matchDots: false, fill: sol('#a16207') },
      background: { fill: sol('#fefce8'), round: 0.1 },
    },
  },
  {
    id: 'hearts',
    name: 'Hearts',
    swatch: ['#be123c', '#fff1f2'],
    swatchShape: 'heart',
    style: {
      dots: { type: 'rounded', fill: lin('#be123c', '#db2777', 45) },
      customDot: { enabled: true, source: shapeSvg('heart'), scale: 1.2 },
      customCornerDot: { enabled: true, source: shapeSvg('heart'), scale: 1.3 },
      cornersSquare: { type: 'extra-rounded', matchDots: true },
      background: { fill: sol('#fff1f2'), round: 0.15 },
    },
  },
  {
    id: 'neon',
    name: 'Neon Night',
    swatch: ['#22d3ee', '#0f172a'],
    style: {
      dots: { type: 'rounded', fill: lin('#22d3ee', '#a3e635', 0) },
      cornersSquare: { type: 'extra-rounded', matchDots: false, fill: sol('#f472b6') },
      cornersDot: { type: 'dot', matchDots: false, fill: sol('#f472b6') },
      background: { fill: sol('#0f172a'), round: 0.1 },
    },
  },
];

export function applyPreset(preset: Preset): StyleConfig {
  return sanitizeStyle(preset.style);
}

const pickRandom = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

/** A random but scannable style: dark foreground on a light background. */
export function randomStyle(): StyleConfig {
  const style = cloneStyle(DEFAULT_STYLE);
  const hue = rand(0, 360);
  const hue2 = (hue + rand(30, 120)) % 360;
  const fg = hslToHex(hue, rand(55, 85), rand(22, 32));
  const fg2 = hslToHex(hue2, rand(55, 85), rand(22, 32));
  const mode = pickRandom<Fill['mode']>(['solid', 'linear', 'linear', 'radial']);

  style.dots = { type: pickRandom(DOT_TYPES).value, fill: { mode, color: fg, color2: fg2, rotation: rand(0, 8) * 45 } };
  style.cornersSquare = {
    type: pickRandom(CORNER_SQUARE_TYPES).value,
    matchDots: Math.random() < 0.5,
    fill: { mode: 'solid', color: fg2, color2: fg2, rotation: 0 },
  };
  style.cornersDot = {
    type: pickRandom(CORNER_DOT_TYPES).value,
    matchDots: Math.random() < 0.5,
    fill: { mode: 'solid', color: fg, color2: fg, rotation: 0 },
  };
  style.background.fill = { mode: 'solid', color: hslToHex(hue, rand(30, 90), rand(94, 99)), color2: '#ffffff', rotation: 0 };
  style.background.round = pickRandom([0, 0, 0.1, 0.2]);
  if (Math.random() < 0.25) {
    const shape = pickRandom(SHAPE_LIBRARY);
    style.customDot = { ...style.customDot, enabled: true, source: shape.svg, scale: 1.25, randomRotation: Math.random() < 0.5 };
  }
  return style;
}
