// Custom SVG shapes for dots and corner dots: rendering, scan checks, thumbnails
// and the shape editor dialog. Loaded as a separate chunk by generator.ts, so
// pages that never use custom shapes don't pay for this code up front.

import QRCodeStyling from 'qr-code-styling';
import {
  DEFAULT_STYLE,
  toQrOptions,
  type CustomShapeConfig,
  type CustomShapeKey,
  type RenderInput,
  type StyleConfig,
} from '../lib/state';
import {
  centerLineCoverage,
  createShapeElements,
  customShapesExtension,
  dotAngle,
  parseShape,
  serializeShape,
  type CustomShapeLayer,
  type ParseResult,
  type ParsedShape,
} from '../lib/customShape';
import { SHAPE_LIBRARY } from '../lib/shapes';

export interface Warning {
  level: 'warn' | 'error' | 'info';
  text: string;
}

/** What the custom-shape feature needs from the main controller. */
export interface ShapeHost {
  style(): StyleConfig;
  writeControls(): void;
  saveStyle(): void;
  scheduleRender(): void;
}

export interface CustomShapes {
  /** A QR instance with custom shapes swapped in, or null when no custom shape is active. */
  createQr(input: Omit<RenderInput, 'customDots' | 'customCornerDots'>): QRCodeStyling | null;
  /** Warnings about custom shapes, in display order. */
  warnings(): Warning[];
  /** Refresh thumbnails, names and (when open) the editor. */
  updateViews(): void;
  openEditor(target: CustomShapeKey): void;
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_UPLOAD_CHARS = 500_000;
const SHAPE_TARGETS: CustomShapeKey[] = ['customDot', 'customCornerDot'];

/** Below this center-line coverage, scanners often fail to find the corner markers (measured with jsQR and ZXing). */
const MIN_CORNER_COVERAGE = 0.8;

/** Editor wording per target. */
const TARGET_TEXT: Record<CustomShapeKey, { title: string; canvas: string; pattern: string }> = {
  customDot: { title: 'Custom dot shape', canvas: 'Shape in one module', pattern: 'Pattern preview' },
  customCornerDot: { title: 'Custom corner dot shape', canvas: 'Shape in the 3×3 center', pattern: 'In a corner marker' },
};

/** Fixed module pattern for the editor's dot pattern preview (1 = dark module). */
const SAMPLE_PATTERN = [
  '1011001101',
  '0110110010',
  '1101011011',
  '0010110101',
  '1110010110',
  '0101101001',
  '1011010111',
  '0100111010',
  '1101001101',
  '0110110011',
];

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function thinCornerWarning(coverage: number, matched: boolean): string {
  return (
    `The corner dot shape is thin through its middle (${Math.round(coverage * 100)}% of the center line is filled; aim for 80%+), ` +
    `so scanners may not find the code. ` +
    (matched ? 'Pick a fuller dot shape, or choose a corner dot shape other than “Match dots”.' : 'Pick a fuller shape or increase its size.')
  );
}

export function createCustomShapes(host: ShapeHost): CustomShapes {
  const shapeDialog = $<HTMLDialogElement>('#shape-editor');
  const shapeCanvas = $<SVGSVGElement>('#shape-canvas');
  const shapePattern = $<SVGSVGElement>('#shape-pattern');
  const shapeStatus = $('#shape-status');
  const shapeCopy = $<HTMLButtonElement>('#shape-copy');
  const libraryButtons = $$('[data-library-shape]');

  /** Which custom shape the editor is currently editing. */
  let editorTarget: CustomShapeKey = 'customDot';
  /** Snapshot of the edited shape when the editor opened, for "Undo changes". */
  let configAtOpen: CustomShapeConfig | undefined;
  const parseCache = new Map<string, ParseResult>();
  const coverageCache = new Map<string, number>();
  /** Last drawn state of each thumbnail, so unchanged thumbnails aren't rebuilt on every input. */
  const thumbKeys: Partial<Record<CustomShapeKey, string>> = {};

  function shapeResult(target: CustomShapeKey): ParseResult {
    const source = host.style()[target].source;
    let result = parseCache.get(source);
    if (!result) {
      if (parseCache.size > 20) parseCache.clear();
      result = parseShape(source);
      parseCache.set(source, result);
    }
    return result;
  }

  function activeShape(target: CustomShapeKey): ParsedShape | null {
    if (!host.style()[target].enabled) return null;
    const result = shapeResult(target);
    return result.ok ? result.shape : null;
  }

  /** True when corner dots are set to "Match dots" and so copy the custom dot shape. */
  function cornerDotsMatchCustomDots(): boolean {
    const style = host.style();
    return !style.customCornerDot.enabled && style.cornersDot.type === '' && activeShape('customDot') !== null;
  }

  /**
   * The custom shape drawn for the corner dots, if any: their own shape, or with
   * "Match dots" the custom dot shape (same rotation/flips, sized for the 3×3 corner).
   */
  function cornerDotLayer(): CustomShapeLayer | undefined {
    const style = host.style();
    const own = activeShape('customCornerDot');
    if (own) return { shape: own, opts: { ...style.customCornerDot } };
    const dots = activeShape('customDot');
    if (dots && cornerDotsMatchCustomDots()) {
      return { shape: dots, opts: { ...style.customDot, scale: DEFAULT_STYLE.customCornerDot.scale } };
    }
    return undefined;
  }

  /** Center-line coverage of a corner dot layer; with random rotation, the worst of the three corners. */
  function cornerCoverage(layer: CustomShapeLayer): number {
    const { opts } = layer;
    const key = [serializeShape(layer.shape), opts.scale, opts.rotation, opts.flipX, opts.flipY, opts.randomRotation].join('|');
    let coverage = coverageCache.get(key);
    if (coverage === undefined) {
      const extra = opts.randomRotation ? [0, 1, 2].map(dotAngle) : [0];
      coverage = Math.min(...extra.map((a) => centerLineCoverage(layer.shape, { ...opts, rotation: opts.rotation + a })));
      if (coverageCache.size > 50) coverageCache.clear();
      coverageCache.set(key, coverage);
    }
    return coverage;
  }

  function createQr(input: Omit<RenderInput, 'customDots' | 'customCornerDots'>): QRCodeStyling | null {
    const dots = activeShape('customDot');
    const cornerDots = cornerDotLayer();
    if (!dots && !cornerDots) return null;
    const options = toQrOptions({ ...input, customDots: Boolean(dots), customCornerDots: Boolean(cornerDots) });
    // Register the extension before the first draw so the code is only drawn once.
    const qr = new QRCodeStyling();
    qr.applyExtension(
      customShapesExtension({
        dots: dots ? { shape: dots, opts: { ...input.style.customDot } } : undefined,
        cornerDots,
      }),
    );
    qr.update(options);
    return qr;
  }

  function warnings(): Warning[] {
    const style = host.style();
    const out: Warning[] = [];
    const ownCorner = shapeResult('customCornerDot');
    const corner = cornerDotLayer();
    if (style.customCornerDot.enabled && !ownCorner.ok) {
      out.push({ level: 'warn', text: `Custom corner dot shape: ${ownCorner.error} Showing the regular corner dots instead.` });
    } else if (corner) {
      const coverage = cornerCoverage(corner);
      if (coverage < MIN_CORNER_COVERAGE) {
        out.push({ level: 'warn', text: thinCornerWarning(coverage, !style.customCornerDot.enabled) });
      } else if (corner.opts.scale > 1.4) {
        out.push({ level: 'warn', text: 'Large corner dot shapes run into the ring around them, which can stop scanners from finding the code. Try a size of 130%.' });
      }
    }
    if (style.customDot.enabled) {
      const result = shapeResult('customDot');
      if (!result.ok) {
        out.push({ level: 'warn', text: `Custom dot shape: ${result.error} Showing regular dots instead.` });
      } else if (style.customDot.scale < 1) {
        out.push({ level: 'warn', text: 'Custom shapes smaller than a module leave gaps that many scanners misread. Try a size of 120% or more.' });
      } else {
        out.push({
          level: 'info',
          text: 'Custom shapes are harder for some scanners to read. Test with a phone; if it struggles, increase the shape size or pick a fuller shape.',
        });
      }
    }
    return out;
  }

  function shapeGroup(
    target: CustomShapeKey,
    shape: ParsedShape,
    boxes: { x: number; y: number; size: number }[],
    color: string,
    random = false,
  ) {
    const config = host.style()[target];
    const g = svgEl('g', { fill: color });
    boxes.forEach((box, i) => {
      const rotation = config.rotation + (random && config.randomRotation ? dotAngle(i) : 0);
      g.append(...createShapeElements(document, shape, box, { ...config, rotation }));
    });
    return g;
  }

  /** Solid color used to preview a target's shape in the editor. */
  function targetColor(target: CustomShapeKey): string {
    const style = host.style();
    if (target === 'customCornerDot' && !style.cornersDot.matchDots) return style.cornersDot.fill.color;
    return style.dots.fill.color;
  }

  /**
   * Point the editor's controls (bound with "customDot.*" keys in the markup) at
   * the target being edited, so the generic binding code handles both shapes.
   */
  function retargetEditor(target: CustomShapeKey) {
    editorTarget = target;
    const swap = (value: string) => value.replace(/^(customDot|customCornerDot)\./, `${target}.`);
    for (const el of $$('[data-key]', shapeDialog)) el.dataset.key = swap(el.dataset.key!);
    for (const el of $$('[data-output-for]', shapeDialog)) el.dataset.outputFor = swap(el.dataset.outputFor!);
    const text = TARGET_TEXT[target];
    $('#shape-editor-title').textContent = text.title;
    $('#shape-canvas-caption').textContent = text.canvas;
    $('#shape-pattern-caption').textContent = text.pattern;
    shapeCopy.hidden = target !== 'customCornerDot';
  }

  /** Refresh thumbnails, names, library selection and (when open) the editor previews. */
  function updateViews() {
    const style = host.style();
    for (const target of SHAPE_TARGETS) {
      const config = style[target];
      const key = [config.source, config.scale, config.rotation, config.flipX, config.flipY].join('|');
      if (thumbKeys[target] === key) continue;
      thumbKeys[target] = key;
      const result = shapeResult(target);
      const shape = result.ok ? result.shape : null;
      const libraryMatch = SHAPE_LIBRARY.find((s) => s.svg === config.source);
      for (const el of $$(`[data-shape-name="${target}"]`)) {
        el.textContent = libraryMatch?.name ?? (shape ? 'Custom SVG' : 'Invalid SVG');
      }
      for (const thumb of $$<SVGSVGElement>(`[data-shape-thumb="${target}"]`)) {
        thumb.replaceChildren(...(shape ? [shapeGroup(target, shape, [{ x: 10, y: 10, size: 80 }], 'currentColor')] : []));
      }
    }

    if (!shapeDialog.open) return;

    const target = editorTarget;
    const result = shapeResult(target);
    const shape = result.ok ? result.shape : null;
    const libraryMatch = SHAPE_LIBRARY.find((s) => s.svg === style[target].source);
    for (const btn of libraryButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.libraryShape === libraryMatch?.id));
    }

    shapeStatus.classList.toggle('is-error', !shape);
    shapeStatus.classList.remove('is-warn');
    if (!result.ok) {
      shapeStatus.textContent = result.error;
    } else {
      const { primitives, ignored, viewBox } = result.shape;
      let text = `✓ ${primitives.length} shape element${primitives.length === 1 ? '' : 's'} · viewBox ${viewBox.join(' ')}`;
      if (ignored) text += ` · ${ignored} outline/unsupported element${ignored === 1 ? '' : 's'} ignored`;
      let thin = false;
      if (target === 'customCornerDot') {
        const coverage = cornerCoverage({ shape: result.shape, opts: style.customCornerDot });
        thin = coverage < MIN_CORNER_COVERAGE;
        text += ` · center line ${Math.round(coverage * 100)}% filled`;
        if (thin) text += ' — too thin through the middle, scanners may not find the code (aim for 80%+)';
      }
      shapeStatus.textContent = text;
      shapeStatus.classList.toggle('is-warn', thin);
    }

    const color = targetColor(target);
    const bg = style.background.transparent ? '' : style.background.fill.color;
    shapeCanvas.style.backgroundColor = bg;
    shapePattern.style.backgroundColor = bg;

    // The area being replaced (dashed outline) with the shape fitted inside it; leaves room for sizes up to 150%.
    const box = { x: 25, y: 25, size: 70 };
    shapeCanvas.replaceChildren(
      svgEl('rect', { x: box.x, y: box.y, width: box.size, height: box.size, class: 'module-box' }),
      ...(shape ? [shapeGroup(target, shape, [box], color)] : []),
    );

    if (target === 'customDot') {
      const boxes = SAMPLE_PATTERN.flatMap((row, y) =>
        [...row].flatMap((cell, x) => (cell === '1' ? [{ x: x * 10, y: y * 10, size: 10 }] : [])),
      );
      shapePattern.replaceChildren(...(shape ? [shapeGroup(target, shape, boxes, color, true)] : []));
    } else {
      // A corner marker: 7×7 ring (in the corner square color) around the 3×3 custom dot.
      const m = 100 / 9;
      const ringColor = style.cornersSquare.matchDots ? style.dots.fill.color : style.cornersSquare.fill.color;
      const ring = svgEl('path', {
        d: `M${m} ${m}h${7 * m}v${7 * m}h${-7 * m}z M${2 * m} ${2 * m}v${5 * m}h${5 * m}v${-5 * m}z`,
        fill: ringColor,
        'fill-rule': 'evenodd',
      });
      const center = { x: 3 * m, y: 3 * m, size: 3 * m };
      shapePattern.replaceChildren(ring, ...(shape ? [shapeGroup(target, shape, [center], color)] : []));
    }
  }

  function changed() {
    host.writeControls();
    host.saveStyle();
    host.scheduleRender();
  }

  function setShapeSource(source: string) {
    const config = host.style()[editorTarget];
    config.source = source;
    config.enabled = true;
    changed();
  }

  function showShapeError(message: string) {
    shapeStatus.textContent = message;
    shapeStatus.classList.add('is-error');
  }

  function openEditor(target: CustomShapeKey) {
    retargetEditor(target);
    configAtOpen = { ...host.style()[editorTarget] };
    host.writeControls();
    shapeDialog.showModal();
    updateViews();
  }

  for (const btn of $$('[data-close-dialog]', shapeDialog)) btn.addEventListener('click', () => shapeDialog.close());
  // Clicking the backdrop (the dialog element itself, outside its content) closes it.
  shapeDialog.addEventListener('click', (e) => {
    if (e.target === shapeDialog) shapeDialog.close();
  });

  for (const btn of libraryButtons) {
    btn.addEventListener('click', () => {
      const shape = SHAPE_LIBRARY.find((s) => s.id === btn.dataset.libraryShape);
      if (shape) setShapeSource(shape.svg);
    });
  }

  $<HTMLInputElement>('#shape-upload').addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const result = parseShape(await file.text(), MAX_UPLOAD_CHARS);
    // Store a cleaned-up version: smaller, readable, and stripped of editor metadata.
    if (result.ok) setShapeSource(serializeShape(result.shape));
    else showShapeError(`${file.name}: ${result.error}`);
  });

  shapeCopy.addEventListener('click', () => setShapeSource(host.style().customDot.source));

  $('#shape-fit').addEventListener('click', () => {
    const result = shapeResult(editorTarget);
    if (!result.ok) return;
    // Measure the untransformed geometry in a hidden SVG attached to the page.
    const probe = svgEl('svg', { width: 0, height: 0, style: 'position:absolute;visibility:hidden' });
    const group = svgEl('g');
    for (const p of result.shape.primitives) {
      const el = svgEl(p.tag, p.attrs);
      if (p.transform) el.setAttribute('transform', p.transform);
      group.append(el);
    }
    probe.append(group);
    document.body.append(probe);
    const box = group.getBBox();
    probe.remove();
    if (!box.width || !box.height) return;
    const round = (n: number) => Math.round(n * 100) / 100;
    setShapeSource(serializeShape({ ...result.shape, viewBox: [round(box.x), round(box.y), round(box.width), round(box.height)] }));
  });

  $('#shape-clean').addEventListener('click', () => {
    const result = shapeResult(editorTarget);
    if (result.ok) setShapeSource(serializeShape(result.shape));
  });

  $('#shape-revert').addEventListener('click', () => {
    if (!configAtOpen) return;
    Object.assign(host.style()[editorTarget], configAtOpen, { enabled: true });
    changed();
  });

  return { createQr, warnings, updateViews, openEditor };
}
