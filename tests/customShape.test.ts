// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createShapeElements, customShapesExtension, parseShape, serializeShape } from '../src/lib/customShape';
import { SHAPE_LIBRARY } from '../src/lib/shapes';
import { DEFAULT_STYLE, sanitizeStyle, toQrOptions } from '../src/lib/state';

const NS = 'http://www.w3.org/2000/svg';
const parsed = (src: string) => {
  const r = parseShape(src);
  if (!r.ok) throw new Error(r.error);
  return r.shape;
};

describe('parseShape', () => {
  it('parses every library shape', () => {
    for (const s of SHAPE_LIBRARY) expect(parseShape(s.svg).ok, s.id).toBe(true);
  });

  it('keeps geometry, transforms and fill-rule', () => {
    const shape = parsed(`<svg xmlns="${NS}" viewBox="0 0 10 10">
      <g transform="translate(1 1)" fill-rule="evenodd"><path d="M0 0h5v5z" transform="scale(2)"/></g>
      <circle cx="5" cy="5" r="2px"/></svg>`);
    expect(shape.viewBox).toEqual([0, 0, 10, 10]);
    expect(shape.primitives).toEqual([
      { tag: 'path', attrs: { d: 'M0 0h5v5z' }, transform: 'translate(1 1) scale(2)', evenOdd: true },
      { tag: 'circle', attrs: { cx: '5', cy: '5', r: '2' }, transform: undefined, evenOdd: false },
    ]);
  });

  it('falls back to width/height without a viewBox', () => {
    expect(parsed(`<svg xmlns="${NS}" width="24px" height="12"><rect width="4" height="4"/></svg>`).viewBox).toEqual([0, 0, 24, 12]);
  });

  it('ignores outlines and unsupported elements', () => {
    const shape = parsed(`<svg xmlns="${NS}" viewBox="0 0 10 10">
      <path d="M0 0L10 10" fill="none" stroke="black"/>
      <line x1="0" y1="0" x2="1" y2="1"/>
      <g style="fill: none"><circle r="3"/></g>
      <rect width="5" height="5"/></svg>`);
    expect(shape.primitives).toHaveLength(1);
    expect(shape.ignored).toBe(3);
  });

  it('explains stroke-only icons', () => {
    const r = parseShape(`<svg xmlns="${NS}" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1L5 5"/></svg>`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outlines/);
  });

  it('rejects invalid input', () => {
    expect(parseShape('').ok).toBe(false);
    expect(parseShape('<svg><path d="M0 0"').ok).toBe(false);
    expect(parseShape(`<html><body/></html>`).ok).toBe(false);
    expect(parseShape(`<svg xmlns="${NS}"><rect width="1" height="1"/></svg>`).ok).toBe(false); // no size
    expect(parseShape('x'.repeat(30_000)).ok).toBe(false);
  });

  it('drops scripts, handlers and unsafe attribute values', () => {
    const shape = parsed(`<svg xmlns="${NS}" viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(1)</script>
      <path d="M0 0h5v5z" onclick="alert(1)" style="fill:url(javascript:alert(1))"/>
      <path d="javascript:alert(1)"/>
      <rect width="5" height="5" transform="url(#x)"/>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
    </svg>`);
    expect(shape.primitives).toHaveLength(1);
    const out = serializeShape(shape);
    expect(out).not.toMatch(/script|onclick|onload|url\(|foreignObject/i);
  });
});

describe('serializeShape', () => {
  it('round-trips through parseShape', () => {
    const shape = parsed(
      `<svg xmlns="${NS}" viewBox="0 0 100 100"><path fill-rule="evenodd" d="M0 0h100v100H0zM30 30h40v40H30z" transform="rotate(45 50 50)"/><circle cx="50" cy="50" r="10"/></svg>`,
    );
    expect(parsed(serializeShape(shape))).toEqual(shape);
  });
});

describe('createShapeElements / extension', () => {
  const square = parsed(`<svg xmlns="${NS}" viewBox="0 0 10 20"><rect width="10" height="20"/></svg>`);

  it('fits the viewBox into the box, centered', () => {
    const [el] = createShapeElements(document, square, { x: 100, y: 50, size: 10 }, { scale: 1, rotation: 0, flipX: true, flipY: false });
    expect(el.getAttribute('transform')).toBe('translate(105 55) scale(-0.5 0.5) translate(-5 -10)');
  });

  const makeSvg = () => {
    const svg = document.createElementNS(NS, 'svg');
    svg.innerHTML = `
      <clipPath id="clip-path-dot-color-1"><rect x="0" y="0" width="4" height="4"/><rect x="4" y="0" width="4" height="4"/></clipPath>
      <clipPath id="clip-path-corners-dot-color-0-0-1"><rect x="8" y="8" width="12" height="12"/></clipPath>
      <clipPath id="clip-path-corners-dot-color-1-0-1"><rect x="80" y="8" width="12" height="12"/></clipPath>
      <clipPath id="clip-path-background-color-1"><rect width="40" height="40"/></clipPath>`;
    return svg;
  };
  const opts = { scale: 1, rotation: 0, flipX: false, flipY: false, randomRotation: true };
  const star = parsed(SHAPE_LIBRARY[0].svg);
  const heart = parsed(SHAPE_LIBRARY[1].svg);

  it('replaces only the dots when only dots have a shape', () => {
    const svg = makeSvg();
    customShapesExtension({ dots: { shape: star, opts } })(svg);
    expect(svg.querySelectorAll('#clip-path-dot-color-1 > polygon')).toHaveLength(2);
    expect(svg.querySelectorAll('#clip-path-dot-color-1 > rect')).toHaveLength(0);
    expect(svg.querySelectorAll('[id^="clip-path-corners-dot-color"] > rect')).toHaveLength(2);
    expect(svg.querySelectorAll('#clip-path-background-color-1 > rect')).toHaveLength(1);
  });

  it('gives corner dots their own shape, with distinct random angles', () => {
    const svg = makeSvg();
    customShapesExtension({ dots: { shape: star, opts }, cornerDots: { shape: heart, opts } })(svg);
    expect(svg.querySelectorAll('#clip-path-dot-color-1 > polygon')).toHaveLength(2);
    const corners = Array.from(svg.querySelectorAll('[id^="clip-path-corners-dot-color"] > path'));
    expect(corners).toHaveLength(2);
    const angles = corners.map((el) => /rotate\(([\d.]+)\)/.exec(el.getAttribute('transform')!)?.[1]);
    expect(angles[0]).not.toBe(angles[1]);
  });

  it('grows the corner dot paint area so large shapes are not cropped', () => {
    const svg = makeSvg();
    svg.insertAdjacentHTML(
      'beforeend',
      `<rect x="8" y="8" width="12" height="12" clip-path="url('#clip-path-corners-dot-color-0-0-1')"/>
       <rect x="0" y="0" width="100" height="100" clip-path="url('#clip-path-dot-color-1')"/>`,
    );
    customShapesExtension({ dots: { shape: star, opts }, cornerDots: { shape: heart, opts: { ...opts, scale: 1.5 } } })(svg);
    const [corner, dots] = Array.from(svg.querySelectorAll(':scope > rect'));
    expect(['x', 'y', 'width', 'height'].map((a) => corner.getAttribute(a))).toEqual(['-4', '-4', '36', '36']);
    expect(['x', 'y', 'width', 'height'].map((a) => dots.getAttribute(a))).toEqual(['0', '0', '100', '100']);
  });

  it('can shape the corner dots alone', () => {
    const svg = makeSvg();
    customShapesExtension({ cornerDots: { shape: heart, opts: { ...opts, randomRotation: false } } })(svg);
    expect(svg.querySelectorAll('#clip-path-dot-color-1 > rect')).toHaveLength(2);
    expect(svg.querySelectorAll('[id^="clip-path-corners-dot-color"] > path')).toHaveLength(2);
  });
});

describe('custom shape options', () => {
  it('draws square dots and resolves "Match dots" corners when a custom dot shape is active', () => {
    const style = sanitizeStyle({ dots: { type: 'rounded' }, customDot: { enabled: true } });
    const opts = toQrOptions({ style, data: 'x', customDots: true });
    expect(opts.dotsOptions?.type).toBe('square');
    expect(opts.cornersSquareOptions?.type).toBe('rounded');
    expect(opts.cornersDotOptions?.type).toBe('rounded');
    expect(toQrOptions({ style, data: 'x' }).dotsOptions?.type).toBe('rounded');
  });

  it('draws square corner dots for a custom corner dot shape, independently of the dots', () => {
    const style = sanitizeStyle({ dots: { type: 'dots' }, cornersDot: { type: 'dot' } });
    const opts = toQrOptions({ style, data: 'x', customCornerDots: true });
    expect(opts.dotsOptions?.type).toBe('dots');
    expect(opts.cornersDotOptions?.type).toBe('square');
    expect(toQrOptions({ style, data: 'x' }).cornersDotOptions?.type).toBe('dot');
  });

  it('sanitizes both custom shapes', () => {
    const style = sanitizeStyle({ customDot: { scale: 99, source: 'x'.repeat(50_000) }, customCornerDot: { rotation: -5, enabled: 'yes' } });
    expect(style.customDot.scale).toBe(1.5);
    expect(style.customDot.source).toBe(DEFAULT_STYLE.customDot.source);
    expect(style.customCornerDot.rotation).toBe(0);
    expect(style.customCornerDot.enabled).toBe(false);
  });

  it('migrates the old "use dot shape for corner dots" setting', () => {
    const heart = SHAPE_LIBRARY[1].svg;
    const style = sanitizeStyle({ customDot: { enabled: true, source: heart, scale: 1.2, cornerDots: true } });
    expect(style.customCornerDot).toMatchObject({ enabled: true, source: heart, scale: DEFAULT_STYLE.customCornerDot.scale });
    expect(style.customDot).not.toHaveProperty('cornerDots');
    expect(sanitizeStyle({ customDot: { enabled: true } }).customCornerDot.enabled).toBe(false);
  });
});
