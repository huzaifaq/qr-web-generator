// Client-side controller: keeps the form controls, the style/content state and
// the QR preview in sync, and handles export, presets, sharing and theming.

import QRCodeStyling from 'qr-code-styling';
import type { FileExtension } from 'qr-code-styling';
import {
  DEFAULT_STYLE,
  cloneStyle,
  decodeStyle,
  encodeStyle,
  getByPath,
  sanitizeStyle,
  setByPath,
  toQrOptions,
  type Fill,
  type CustomShapeConfig,
  type CustomShapeKey,
  type RenderInput,
  type StyleConfig,
} from '../lib/state';
import { BYTE_CAPACITY, buildPayload, byteLength, type ContentFields, type ContentType } from '../lib/payloads';
import { contrastRatio, luminance } from '../lib/contrast';
import { PRESETS, applyPreset, randomStyle } from '../lib/presets';
import {
  createShapeElements,
  dotAngle,
  customShapesExtension,
  parseShape,
  serializeShape,
  centerLineCoverage,
  type CustomShapeLayer,
  type ParseResult,
  type ParsedShape,
} from '../lib/customShape';
import { SHAPE_LIBRARY } from '../lib/shapes';

const STYLE_KEY = 'qr-style';
const THEME_KEY = 'qr-theme';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));

const styleForm = $<HTMLFormElement>('#style-form');
const contentForm = $<HTMLFormElement>('#content-form');
const previewEl = $('#qr-preview');
const emptyEl = $('#qr-empty');
const warningsEl = $('#qr-warnings');
const metaEl = $('#qr-meta');
const toastEl = $('#toast');
const formatSel = $<HTMLSelectElement>('#export-format');
const sizeSel = $<HTMLSelectElement>('#export-size');
const actionButtons = $$<HTMLButtonElement>('#download, #copy-image');
const logoInput = $<HTMLInputElement>('#logo-input');
const logoThumb = $<HTMLImageElement>('#logo-thumb');
const logoRemove = $<HTMLButtonElement>('#logo-remove');
const logoLabel = $('#logo-label');

// ---------------------------------------------------------------------------
// State

let style: StyleConfig = loadInitialStyle();
let logo: string | undefined;
let contentType: ContentType = 'text';
const content = {} as Record<ContentType, Record<string, string | boolean>>;

function loadInitialStyle(): StyleConfig {
  const match = /[#&]s=([\w-]+)/.exec(location.hash);
  if (match) {
    const shared = decodeStyle(match[1]);
    // Drop the hash so later edits (saved to storage) aren't overridden on reload.
    history.replaceState(null, '', location.pathname + location.search);
    if (shared) {
      saveStyle(shared);
      return shared;
    }
  }
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (raw) return sanitizeStyle(JSON.parse(raw));
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return cloneStyle(DEFAULT_STYLE);
}

function saveStyle(s: StyleConfig = style) {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(s));
  } catch {
    // Ignore: persistence is a convenience only.
  }
}

// ---------------------------------------------------------------------------
// Style controls <-> state

function readControl(el: Control): unknown {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'radio') return el.checked ? el.value : undefined;
    if (el.type === 'range' || el.type === 'number') return Number(el.value);
    if (el.classList.contains('hex')) return normalizeHex(el.value);
  }
  return el.value;
}

function normalizeHex(value: string): string | undefined {
  let v = value.trim().toLowerCase();
  if (!v.startsWith('#')) v = '#' + v;
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v.slice(1).replace(/./g, '$&$&');
  return /^#[0-9a-f]{6}$/.test(v) ? v : undefined;
}

function formatOutput(value: number, format: string | undefined): string {
  if (format === 'percent') return `${Math.round(value * 100)}%`;
  if (format === 'deg') return `${value}°`;
  return `${value}px`;
}

function writeControls() {
  for (const el of $$<Control>('[data-key]', styleForm)) {
    const value = getByPath(style, el.dataset.key!);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(value);
    else if (el instanceof HTMLInputElement && el.type === 'radio') el.checked = el.value === value;
    // Don't rewrite a text field while the user is typing in it (it would move the caret).
    else if (el !== document.activeElement || !(el.classList.contains('hex') || el instanceof HTMLTextAreaElement)) {
      el.value = String(value ?? '');
    }
  }
  for (const out of $$<HTMLOutputElement>('[data-output-for]', styleForm)) {
    out.value = formatOutput(Number(getByPath(style, out.dataset.outputFor!)), out.dataset.format);
  }
  updateVisibility();
  updateShapeViews();
}

/**
 * Evaluates a visibility expression such as `dots.fill.mode!=solid`,
 * `!background.transparent`, `wifi.encryption=WPA|WEP`, `cornersDot.type=` (empty)
 * or `$logo`. Terms joined with `&` must all be true.
 */
function evaluate(expr: string, lookup: (path: string) => unknown): boolean {
  if (expr.includes('&')) return expr.split('&').every((part) => evaluate(part, lookup));
  const m = /^(!?)([$\w.]+)(?:(!=|=)(.*))?$/.exec(expr);
  if (!m) return true;
  const [, negate, path, op, values] = m;
  const value = path === '$logo' ? Boolean(logo) : lookup(path);
  let result: boolean;
  if (op) {
    const inList = values.split('|').includes(String(value));
    result = op === '=' ? inList : !inList;
  } else {
    result = Boolean(value);
  }
  return negate ? !result : result;
}

function updateVisibility() {
  for (const el of $$('[data-show-if]', styleForm)) {
    el.hidden = !evaluate(el.dataset.showIf!, (p) => getByPath(style, p));
  }
  for (const el of $$<HTMLSelectElement>('[data-disable-if]', styleForm)) {
    el.disabled = evaluate(el.dataset.disableIf!, (p) => getByPath(style, p));
  }
  for (const el of $$('[data-show-if-field]', contentForm)) {
    el.hidden = !evaluate(el.dataset.showIfField!, (p) => getByPath(content, p));
  }
}

let saveTimer: number | undefined;

styleForm.addEventListener('input', (e) => {
  const el = e.target as Control;
  if (!el.dataset?.key) return;
  const value = readControl(el);
  if (value === undefined) return;
  setByPath(style, el.dataset.key, value);
  writeControls();
  scheduleRender();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveStyle, 300);
});

// Normalize a half-typed hex value once the field loses focus.
styleForm.addEventListener('focusout', (e) => {
  if ((e.target as HTMLElement).classList?.contains('hex')) writeControls();
});

function setStyle(next: StyleConfig) {
  style = next;
  writeControls();
  saveStyle();
  render();
}

for (const btn of $$<HTMLButtonElement>('[data-preset]')) {
  btn.addEventListener('click', () => {
    const preset = PRESETS.find((p) => p.id === btn.dataset.preset);
    if (preset) setStyle(applyPreset(preset));
  });
}
$('#randomize').addEventListener('click', () => setStyle(randomStyle()));
$('#reset').addEventListener('click', () => setStyle(cloneStyle(DEFAULT_STYLE)));

// ---------------------------------------------------------------------------
// Content

function readContentFields() {
  for (const el of $$<Control>('[data-field]', contentForm)) {
    const [group, name] = el.dataset.field!.split('.') as [ContentType, string];
    content[group] ??= {};
    content[group][name] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
  }
}

contentForm.addEventListener('input', (e) => {
  const el = e.target as Control;
  const path = el.dataset?.field;
  if (!path) return;
  const [group, name] = path.split('.') as [ContentType, string];
  content[group][name] = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
  updateVisibility();
  scheduleRender();
});

for (const tab of $$<HTMLInputElement>('[data-content-type]')) {
  tab.addEventListener('change', () => {
    if (!tab.checked) return;
    contentType = tab.value as ContentType;
    for (const panel of $$('[data-panel]', contentForm)) panel.hidden = panel.dataset.panel !== contentType;
    render();
  });
}

function currentPayload(): string {
  return buildPayload(contentType, content[contentType] as unknown as ContentFields[ContentType]);
}

// ---------------------------------------------------------------------------
// Logo

logoInput.addEventListener('change', () => {
  const file = logoInput.files?.[0];
  if (!file) return;
  if (file.size > MAX_LOGO_BYTES) {
    toast('That image is larger than 5 MB — please choose a smaller one.');
    logoInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    logo = String(reader.result);
    logoThumb.src = logo;
    logoThumb.hidden = false;
    logoRemove.hidden = false;
    logoLabel.textContent = 'Change image';
    updateVisibility();
    render();
  };
  reader.readAsDataURL(file);
});

logoRemove.addEventListener('click', () => {
  logo = undefined;
  logoInput.value = '';
  logoThumb.hidden = true;
  logoThumb.removeAttribute('src');
  logoRemove.hidden = true;
  logoLabel.textContent = 'Upload image';
  updateVisibility();
  render();
});

// ---------------------------------------------------------------------------
// Custom shapes (dots and corner dots)

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_UPLOAD_CHARS = 500_000;
const SHAPE_TARGETS: CustomShapeKey[] = ['customDot', 'customCornerDot'];
const shapeDialog = $<HTMLDialogElement>('#shape-editor');
const shapeCanvas = $<SVGSVGElement>('#shape-canvas');
const shapePattern = $<SVGSVGElement>('#shape-pattern');
const shapeStatus = $('#shape-status');
const shapeCopy = $<HTMLButtonElement>('#shape-copy');

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

/** Which custom shape the editor is currently editing. */
let editorTarget: CustomShapeKey = 'customDot';
/** Snapshot of the edited shape when the editor opened, for "Undo changes". */
let configAtOpen: CustomShapeConfig | undefined;
const parseCache = new Map<string, ParseResult>();

function shapeResult(target: CustomShapeKey): ParseResult {
  const source = style[target].source;
  let result = parseCache.get(source);
  if (!result) {
    if (parseCache.size > 20) parseCache.clear();
    result = parseShape(source);
    parseCache.set(source, result);
  }
  return result;
}

function activeShape(target: CustomShapeKey): ParsedShape | null {
  if (!style[target].enabled) return null;
  const result = shapeResult(target);
  return result.ok ? result.shape : null;
}

/** True when corner dots are set to "Match dots" and so copy the custom dot shape. */
function cornerDotsMatchCustomDots(): boolean {
  return !style.customCornerDot.enabled && style.cornersDot.type === '' && activeShape('customDot') !== null;
}

/**
 * The custom shape drawn for the corner dots, if any: their own shape, or with
 * "Match dots" the custom dot shape (same rotation/flips, sized for the 3×3 corner).
 */
function cornerDotLayer(): CustomShapeLayer | undefined {
  const own = activeShape('customCornerDot');
  if (own) return { shape: own, opts: { ...style.customCornerDot } };
  const dots = activeShape('customDot');
  if (dots && cornerDotsMatchCustomDots()) {
    return { shape: dots, opts: { ...style.customDot, scale: DEFAULT_STYLE.customCornerDot.scale } };
  }
  return undefined;
}

/** Create a QR instance, swapping in custom dot / corner dot shapes when active. */
function createQr(input: Omit<RenderInput, 'customDots' | 'customCornerDots'>): QRCodeStyling {
  const dots = activeShape('customDot');
  const cornerDots = cornerDotLayer();
  const options = toQrOptions({ ...input, customDots: Boolean(dots), customCornerDots: Boolean(cornerDots) });
  if (!dots && !cornerDots) return new QRCodeStyling(options);
  // Register the extension before the first draw so the code is only drawn once.
  const qr = new QRCodeStyling();
  qr.applyExtension(
    customShapesExtension({
      dots: dots ? { shape: dots, opts: { ...style.customDot } } : undefined,
      cornerDots,
    }),
  );
  qr.update(options);
  return qr;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function shapeGroup(
  target: CustomShapeKey,
  shape: ParsedShape,
  boxes: { x: number; y: number; size: number }[],
  color: string,
  random = false,
) {
  const config = style[target];
  const g = svgEl('g', { fill: color });
  boxes.forEach((box, i) => {
    const rotation = config.rotation + (random && config.randomRotation ? dotAngle(i) : 0);
    g.append(...createShapeElements(document, shape, box, { ...config, rotation }));
  });
  return g;
}

/** Solid color used to preview a target's shape in the editor. */
function targetColor(target: CustomShapeKey): string {
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
function updateShapeViews() {
  for (const target of SHAPE_TARGETS) {
    const result = shapeResult(target);
    const shape = result.ok ? result.shape : null;
    const libraryMatch = SHAPE_LIBRARY.find((s) => s.svg === style[target].source);
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
  for (const btn of $$('[data-library-shape]')) {
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

function setShapeSource(source: string) {
  style[editorTarget].source = source;
  style[editorTarget].enabled = true;
  writeControls();
  saveStyle();
  scheduleRender();
}

function showShapeError(message: string) {
  shapeStatus.textContent = message;
  shapeStatus.classList.add('is-error');
}

for (const btn of $$('[data-open-shape-editor]')) {
  btn.addEventListener('click', () => {
    retargetEditor(btn.dataset.openShapeEditor as CustomShapeKey);
    configAtOpen = { ...style[editorTarget] };
    writeControls();
    shapeDialog.showModal();
    updateShapeViews();
  });
}
for (const btn of $$('[data-close-dialog]', shapeDialog)) btn.addEventListener('click', () => shapeDialog.close());
// Clicking the backdrop (the dialog element itself, outside its content) closes it.
shapeDialog.addEventListener('click', (e) => {
  if (e.target === shapeDialog) shapeDialog.close();
});

for (const btn of $$('[data-library-shape]')) {
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

shapeCopy.addEventListener('click', () => setShapeSource(style.customDot.source));

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
  Object.assign(style[editorTarget], configAtOpen, { enabled: true });
  writeControls();
  saveStyle();
  scheduleRender();
});

// ---------------------------------------------------------------------------
// Rendering

let renderTimer: number | undefined;
let renderToken = 0;

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 80);
}

function fillColors(fill: Fill): string[] {
  return fill.mode === 'solid' ? [fill.color] : [fill.color, fill.color2];
}

/** Below this center-line coverage, scanners often fail to find the corner markers (measured with jsQR and ZXing). */
const MIN_CORNER_COVERAGE = 0.8;

/** Center-line coverage of a corner dot layer; with random rotation, the worst of the three corners. */
function cornerCoverage(layer: CustomShapeLayer): number {
  const extra = layer.opts.randomRotation ? [0, 1, 2].map(dotAngle) : [0];
  return Math.min(...extra.map((a) => centerLineCoverage(layer.shape, { ...layer.opts, rotation: layer.opts.rotation + a })));
}

function thinCornerWarning(coverage: number, matched: boolean): string {
  return (
    `The corner dot shape is thin through its middle (${Math.round(coverage * 100)}% of the center line is filled; aim for 80%+), ` +
    `so scanners may not find the code. ` +
    (matched ? 'Pick a fuller dot shape, or choose a corner dot shape other than “Match dots”.' : 'Pick a fuller shape or increase its size.')
  );
}

function getWarnings(data: string): { level: 'warn' | 'error' | 'info'; text: string }[] {
  const out: { level: 'warn' | 'error' | 'info'; text: string }[] = [];
  const ec = logo ? 'H' : style.errorCorrection;
  const bytes = byteLength(data);
  const capacity = BYTE_CAPACITY[ec];

  if (bytes > capacity) {
    out.push({ level: 'error', text: `Too much content: ${bytes} bytes, but the limit at error correction ${ec} is ${capacity}.` });
    return out;
  }
  if (bytes > capacity * 0.8) out.push({ level: 'warn', text: 'Content is close to the maximum capacity — the code will be very dense.' });

  const fg = [
    ...fillColors(style.dots.fill),
    ...(style.cornersSquare.matchDots ? [] : fillColors(style.cornersSquare.fill)),
    ...(style.cornersDot.matchDots ? [] : fillColors(style.cornersDot.fill)),
  ];
  if (style.background.transparent) {
    out.push({ level: 'info', text: 'Transparent background — make sure the surface behind the code contrasts with the dots.' });
  } else {
    const bg = fillColors(style.background.fill);
    const minRatio = Math.min(...fg.flatMap((f) => bg.map((b) => contrastRatio(f, b))));
    if (minRatio < 3) {
      out.push({ level: 'warn', text: `Low contrast (${minRatio.toFixed(1)}:1) — many scanners need at least 3:1, ideally 4:1 or more.` });
    }
    const avg = (list: string[]) => list.reduce((s, c) => s + luminance(c), 0) / list.length;
    if (avg(fg) > avg(bg)) {
      out.push({ level: 'info', text: 'Light code on a dark background — some older scanners can’t read inverted codes.' });
    }
  }
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
  if (logo && style.logo.size > 0.45) {
    out.push({ level: 'warn', text: 'A large logo can make the code unreadable — test it with a phone before printing.' });
  }
  return out;
}

function renderWarnings(list: ReturnType<typeof getWarnings>) {
  warningsEl.replaceChildren(
    ...list.map((w) => {
      const li = document.createElement('li');
      li.className = `warning warning-${w.level}`;
      li.textContent = w.text;
      return li;
    }),
  );
}

async function render() {
  clearTimeout(renderTimer);
  const token = ++renderToken;
  const data = currentPayload();
  const warnings = data ? getWarnings(data) : [];
  const blocked = !data || warnings.some((w) => w.level === 'error');

  renderWarnings(warnings);
  emptyEl.hidden = Boolean(data);
  previewEl.classList.toggle('is-blocked', blocked);
  actionButtons.forEach((b) => (b.disabled = blocked));

  if (blocked) {
    previewEl.replaceChildren();
    metaEl.textContent = '';
    return;
  }

  try {
    // Draw off-screen first, then swap, so the preview never flashes empty.
    const qr = createQr({ style, data, logo });
    const stage = document.createElement('div');
    qr.append(stage);
    await qr._svgDrawingPromise;
    if (token !== renderToken) return;
    previewEl.replaceChildren(...stage.childNodes);

    const modules = qr._qr?.getModuleCount() ?? 0;
    const version = modules ? (modules - 17) / 4 : 0;
    const ec = logo ? 'H' : style.errorCorrection;
    metaEl.textContent = `Version ${version} · ${modules}×${modules} modules · ${byteLength(data)} bytes · EC ${ec}`;
  } catch (err) {
    if (token !== renderToken) return;
    previewEl.replaceChildren();
    actionButtons.forEach((b) => (b.disabled = true));
    renderWarnings([{ level: 'error', text: `Could not generate the code: ${(err as Error).message}` }]);
  }
}

// ---------------------------------------------------------------------------
// Export

function exportInstance(ext: FileExtension): QRCodeStyling {
  return createQr({
    style,
    data: currentPayload(),
    logo,
    size: Number(sizeSel.value),
    type: ext === 'svg' ? 'svg' : 'canvas',
    opaque: ext === 'jpeg',
  });
}

$('#download').addEventListener('click', async () => {
  const ext = formatSel.value as FileExtension;
  try {
    await exportInstance(ext).download({ name: 'qr-code', extension: ext });
  } catch (err) {
    toast(`Download failed: ${(err as Error).message}`);
  }
});

$('#copy-image').addEventListener('click', async () => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    toast('Copying images isn’t supported in this browser — use Download instead.');
    return;
  }
  try {
    // Pass a promise so Safari keeps the user-gesture context.
    const blob = exportInstance('png')
      .getRawData('png')
      .then((b) => {
        if (!(b instanceof Blob)) throw new Error('No image data');
        return b;
      });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied to clipboard.');
  } catch {
    toast('Could not copy the image — use Download instead.');
  }
});

$('#share-style').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#s=${encodeStyle(style)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Style link copied. It contains only the design, not your content.');
  } catch {
    window.prompt('Copy this link to share the style:', url);
  }
});

let toastTimer: number | undefined;
function toast(message: string) {
  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove('is-visible');
    toastTimer = window.setTimeout(() => (toastEl.textContent = ''), 200);
  }, 3000);
}

// ---------------------------------------------------------------------------
// Theme

$('#theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Ignore.
  }
});

// ---------------------------------------------------------------------------
// Init

readContentFields();
writeControls();
render();
