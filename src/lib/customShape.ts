// Custom SVG dot shapes: parsing, normalizing, and the qr-code-styling extension
// that swaps each square dot for the custom shape.
//
// Uploaded/shared SVG is untrusted. It is never inserted as markup: we parse it,
// keep only filled geometry (path, circle, ellipse, rect, polygon, polyline)
// with validated geometry attributes, and rebuild elements via createElementNS.

const SVG_NS = 'http://www.w3.org/2000/svg';

export const MAX_SHAPE_SOURCE = 20_000;
export const MAX_PRIMITIVES = 40;

type Tag = 'path' | 'circle' | 'ellipse' | 'rect' | 'polygon' | 'polyline';

const GEOMETRY: Record<Tag, { attrs: string[]; required: string[] }> = {
  path: { attrs: ['d'], required: ['d'] },
  circle: { attrs: ['cx', 'cy', 'r'], required: ['r'] },
  ellipse: { attrs: ['cx', 'cy', 'rx', 'ry'], required: ['rx', 'ry'] },
  rect: { attrs: ['x', 'y', 'width', 'height', 'rx', 'ry'], required: ['width', 'height'] },
  polygon: { attrs: ['points'], required: ['points'] },
  polyline: { attrs: ['points'], required: ['points'] },
};

const CONTAINERS = new Set(['svg', 'g', 'a', 'switch']);
/** Drawable elements we can't use; reported back to the user as "ignored". */
const UNSUPPORTED = new Set(['line', 'text', 'use', 'image', 'foreignObject']);

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]*$/;
const POINTS = /^[\d\s,.eE+-]*$/;
const TRANSFORM = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.eE+-]*\)\s*,?)*\s*$/;

export interface ShapePrimitive {
  tag: Tag;
  attrs: Record<string, string>;
  transform?: string;
  evenOdd: boolean;
}

export interface ParsedShape {
  viewBox: [number, number, number, number];
  primitives: ShapePrimitive[];
  /** Elements skipped because they are outlines only or unsupported. */
  ignored: number;
}

export type ParseResult = { ok: true; shape: ParsedShape } | { ok: false; error: string };

export interface ShapeTransform {
  /** Shape size relative to one QR module (1 = fits the module). */
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

function styleProps(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim();
  }
  return out;
}

function prop(el: Element, name: string): string | undefined {
  return styleProps(el)[name] ?? el.getAttribute(name) ?? undefined;
}

function cleanNumber(value: string): string | null {
  const v = value.trim().replace(/px$/i, '');
  return NUMBER.test(v) ? v : null;
}

function validAttr(name: string, value: string): string | null {
  if (name === 'd') return PATH_DATA.test(value) && /\d/.test(value) ? value.trim().replace(/\s+/g, ' ') : null;
  if (name === 'points') return POINTS.test(value) && /\d/.test(value) ? value.trim().replace(/\s+/g, ' ') : null;
  return cleanNumber(value);
}

function parseViewBox(root: Element): [number, number, number, number] | null {
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return parts as [number, number, number, number];
    }
    return null;
  }
  const w = Number(cleanNumber(root.getAttribute('width') ?? ''));
  const h = Number(cleanNumber(root.getAttribute('height') ?? ''));
  return w > 0 && h > 0 ? [0, 0, w, h] : null;
}

/**
 * Parse SVG source into a safe shape description. `maxLength` is raised for raw
 * uploads, which are normalized (and so shrunk) with `serializeShape` afterwards.
 */
export function parseShape(source: string, maxLength = MAX_SHAPE_SOURCE): ParseResult {
  if (!source.trim()) return { ok: false, error: 'The SVG source is empty.' };
  if (source.length > maxLength) {
    return { ok: false, error: `The SVG is too large (max ${Math.round(maxLength / 1000)} KB). Try simplifying it.` };
  }

  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || root?.localName !== 'svg') {
    return { ok: false, error: 'This isn’t valid SVG markup.' };
  }

  const viewBox = parseViewBox(root);
  if (!viewBox) return { ok: false, error: 'Add a viewBox (e.g. viewBox="0 0 100 100") to the <svg> element.' };

  const primitives: ShapePrimitive[] = [];
  let ignored = 0;

  const walk = (el: Element, inherited: { transform: string; fill: string; fillRule: string }) => {
    for (const child of Array.from(el.children)) {
      const name = child.localName;
      if (prop(child, 'display') === 'none' || prop(child, 'visibility') === 'hidden') continue;

      const ownTransform = child.getAttribute('transform')?.trim();
      if (ownTransform && !TRANSFORM.test(ownTransform)) {
        ignored++;
        continue;
      }
      const next = {
        transform: [inherited.transform, ownTransform].filter(Boolean).join(' '),
        fill: prop(child, 'fill') ?? inherited.fill,
        fillRule: prop(child, 'fill-rule') ?? inherited.fillRule,
      };

      if (CONTAINERS.has(name)) {
        walk(child, next);
        continue;
      }
      if (!(name in GEOMETRY)) {
        if (UNSUPPORTED.has(name)) ignored++;
        continue;
      }
      if (next.fill === 'none' || next.fill === 'transparent' || prop(child, 'opacity') === '0') {
        ignored++;
        continue;
      }

      const tag = name as Tag;
      const attrs: Record<string, string> = {};
      let valid = true;
      for (const attr of GEOMETRY[tag].attrs) {
        const raw = child.getAttribute(attr);
        if (raw === null) continue;
        const clean = validAttr(attr, raw);
        if (clean === null) valid = false;
        else attrs[attr] = clean;
      }
      if (!valid || GEOMETRY[tag].required.some((a) => !attrs[a] || attrs[a] === '0')) {
        ignored++;
        continue;
      }
      primitives.push({ tag, attrs, transform: next.transform || undefined, evenOdd: next.fillRule === 'evenodd' });
    }
  };

  // Presentation attributes on the root <svg> (e.g. fill="none" on icon sets) are inherited.
  walk(root, { transform: '', fill: prop(root, 'fill') ?? 'black', fillRule: prop(root, 'fill-rule') ?? 'nonzero' });

  if (primitives.length > MAX_PRIMITIVES) {
    return { ok: false, error: `Too many elements (${primitives.length}, max ${MAX_PRIMITIVES}). Merge them into fewer paths.` };
  }
  if (!primitives.length) {
    return {
      ok: false,
      error: ignored
        ? 'No filled shapes found — outlines (stroke-only or fill="none") can’t be used. Use filled paths, circles, rects, ellipses or polygons.'
        : 'No shapes found. Add a <path>, <circle>, <rect>, <ellipse> or <polygon>.',
    };
  }
  return { ok: true, shape: { viewBox, primitives, ignored } };
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Serialize a parsed shape back to compact, readable SVG source. */
export function serializeShape(shape: ParsedShape): string {
  const lines = shape.primitives.map((p) => {
    const attrs = Object.entries(p.attrs).map(([k, v]) => `${k}="${esc(v)}"`);
    if (p.transform) attrs.push(`transform="${esc(p.transform)}"`);
    if (p.evenOdd) attrs.push('fill-rule="evenodd"');
    return `  <${p.tag} ${attrs.join(' ')}/>`;
  });
  return `<svg xmlns="${SVG_NS}" viewBox="${shape.viewBox.map(fmt).join(' ')}">\n${lines.join('\n')}\n</svg>`;
}

/** Build the shape's elements, fitted and centered in the square `box`. */
export function createShapeElements(
  doc: Document,
  shape: ParsedShape,
  box: { x: number; y: number; size: number },
  t: ShapeTransform,
): SVGElement[] {
  const [vx, vy, vw, vh] = shape.viewBox;
  const k = (box.size * t.scale) / Math.max(vw, vh);
  const outer =
    `translate(${fmt(box.x + box.size / 2)} ${fmt(box.y + box.size / 2)})` +
    (t.rotation ? ` rotate(${fmt(t.rotation)})` : '') +
    ` scale(${fmt(k * (t.flipX ? -1 : 1))} ${fmt(k * (t.flipY ? -1 : 1))})` +
    ` translate(${fmt(-(vx + vw / 2))} ${fmt(-(vy + vh / 2))})`;

  return shape.primitives.map((p) => {
    const el = doc.createElementNS(SVG_NS, p.tag);
    for (const [k2, v] of Object.entries(p.attrs)) el.setAttribute(k2, v);
    el.setAttribute('transform', p.transform ? `${outer} ${p.transform}` : outer);
    if (p.evenOdd) {
      el.setAttribute('fill-rule', 'evenodd');
      el.setAttribute('clip-rule', 'evenodd');
    }
    return el;
  });
}

/** Path data equivalent to a primitive's geometry (before its transform). */
function primitivePath(el: Element): string {
  const n = (a: string) => Number(el.getAttribute(a) ?? 0);
  switch (el.localName) {
    case 'path':
      return el.getAttribute('d') ?? '';
    case 'polygon':
    case 'polyline':
      return `M${el.getAttribute('points')}Z`;
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [n('cx'), n('cy')];
      const [rx, ry] = el.localName === 'circle' ? [n('r'), n('r')] : [n('rx'), n('ry')];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    }
    case 'rect':
      return `M${n('x')} ${n('y')}h${n('width')}v${n('height')}h${-n('width')}Z`;
    default:
      return '';
  }
}

/**
 * How much of the horizontal and vertical lines through the center of a corner dot
 * the shape covers (the lower of the two, 0–1). Scanners locate a QR code by the
 * solid 3-module run through the middle of each corner marker, so shapes that are
 * thin through the middle (an X, a triangle) can make the code undetectable.
 * Browser only: uses canvas Path2D hit testing.
 */
export function centerLineCoverage(shape: ParsedShape, t: ShapeTransform): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 1;
  const size = 30;
  const samples = 90;
  const paths = createShapeElements(document, shape, { x: 0, y: 0, size }, t).map((el) => {
    const path = new Path2D();
    const m = (el as SVGGraphicsElement).transform.baseVal.consolidate()?.matrix;
    path.addPath(new Path2D(primitivePath(el)), m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : undefined);
    return { path, rule: (el.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero') as CanvasFillRule };
  });
  const inside = (x: number, y: number) => paths.some(({ path, rule }) => ctx.isPointInPath(path, x, y, rule));
  let horizontal = 0;
  let vertical = 0;
  for (let i = 0; i < samples; i++) {
    const p = ((i + 0.5) / samples) * size;
    if (inside(p, size / 2)) horizontal++;
    if (inside(size / 2, p)) vertical++;
  }
  return Math.min(horizontal, vertical) / samples;
}

/** Deterministic pseudo-random angle per dot, so preview and exports match. */
export function dotAngle(index: number): number {
  const h = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return Math.floor((h - Math.floor(h)) * 360);
}

export interface CustomShapeOptions extends ShapeTransform {
  randomRotation: boolean;
}

export interface CustomShapeLayer {
  shape: ParsedShape;
  opts: CustomShapeOptions;
}

/**
 * qr-code-styling extension. Dots (and corner dots) that get a custom shape must
 * be drawn with type "square", so each one is a <rect> inside its clip path.
 */
export function customShapesExtension(layers: { dots?: CustomShapeLayer; cornerDots?: CustomShapeLayer }) {
  return (svg: SVGElement) => {
    const doc = svg.ownerDocument;
    // The element painted through a clip path, i.e. the one with clip-path="url('#<id>')".
    const painterFor = (clipId: string) =>
      Array.from(svg.querySelectorAll('[clip-path]')).find((el) => /#([^'")]+)/.exec(el.getAttribute('clip-path')!)?.[1] === clipId);

    const swap = ({ shape, opts }: CustomShapeLayer, selector: string) => {
      // Index across all matching clip paths so each corner gets its own random angle.
      let index = 0;
      for (const clip of Array.from(svg.querySelectorAll(selector))) {
        for (const rect of Array.from(clip.children).filter((el) => el.localName === 'rect')) {
          const box = {
            x: Number(rect.getAttribute('x')),
            y: Number(rect.getAttribute('y')),
            size: Number(rect.getAttribute('width')),
          };
          const rotation = opts.rotation + (opts.randomRotation ? dotAngle(index) : 0);
          rect.replaceWith(...createShapeElements(doc, shape, box, { ...opts, rotation }));
          index++;

          // Corner dots are painted by a rect exactly the size of the 3×3 area, which would
          // crop shapes drawn larger than 100% or rotated. Grow it to one extra box on every
          // side (enough for the max 150% size at any angle); the clip path still limits
          // the paint to the shape itself. Dots are painted by a full-size rect already.
          const painter = painterFor(clip.id);
          if (painter?.localName === 'rect' && Number(painter.getAttribute('width')) <= box.size * 1.01) {
            painter.setAttribute('x', fmt(box.x - box.size));
            painter.setAttribute('y', fmt(box.y - box.size));
            painter.setAttribute('width', fmt(box.size * 3));
            painter.setAttribute('height', fmt(box.size * 3));
          }
        }
      }
    };
    if (layers.dots) swap(layers.dots, 'clipPath[id^="clip-path-dot-color-"]');
    if (layers.cornerDots) swap(layers.cornerDots, 'clipPath[id^="clip-path-corners-dot-color-"]');
  };
}
