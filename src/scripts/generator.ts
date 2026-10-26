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
  type CustomShapeKey,
  type RenderInput,
  type StyleConfig,
} from '../lib/state';
import { BYTE_CAPACITY, buildPayload, byteLength, type ContentFields, type ContentType } from '../lib/payloads';
import { contrastRatio, luminance } from '../lib/contrast';
import { PRESETS, applyPreset, randomStyle } from '../lib/presets';
import type { CustomShapes, Warning } from './customShapes';

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

// The form markup is static, so look the bound controls up once.
const keyedControls = $$<Control>('[data-key]', styleForm);
const outputs = $$<HTMLOutputElement>('[data-output-for]', styleForm);
const showIfEls = $$('[data-show-if]', styleForm);
const disableIfEls = $$<HTMLSelectElement>('[data-disable-if]', styleForm);
const showIfFieldEls = $$('[data-show-if-field]', contentForm);

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
  for (const el of keyedControls) {
    const value = getByPath(style, el.dataset.key!);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(value);
    else if (el instanceof HTMLInputElement && el.type === 'radio') el.checked = el.value === value;
    // Don't rewrite a text field while the user is typing in it (it would move the caret).
    else if (el !== document.activeElement || !(el.classList.contains('hex') || el instanceof HTMLTextAreaElement)) {
      el.value = String(value ?? '');
    }
  }
  for (const out of outputs) {
    out.value = formatOutput(Number(getByPath(style, out.dataset.outputFor!)), out.dataset.format);
  }
  updateVisibility();
  if (shapes) shapes.updateViews();
  else if (usesCustomShapes()) void loadShapes().catch(() => undefined);
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
  for (const el of showIfEls) {
    el.hidden = !evaluate(el.dataset.showIf!, (p) => getByPath(style, p));
  }
  for (const el of disableIfEls) {
    el.disabled = evaluate(el.dataset.disableIf!, (p) => getByPath(style, p));
  }
  for (const el of showIfFieldEls) {
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
//
// The custom-shape code (SVG parsing, editor, scan checks) lives in its own chunk.
// It is fetched when the page goes idle, or right away when a custom shape is in use.

let shapes: CustomShapes | undefined;
let shapesLoading: Promise<CustomShapes> | undefined;

function usesCustomShapes(): boolean {
  return style.customDot.enabled || style.customCornerDot.enabled;
}

function loadShapes(): Promise<CustomShapes> {
  shapesLoading ??= import('./customShapes').then(
    ({ createCustomShapes }) => {
      shapes = createCustomShapes({ style: () => style, writeControls, saveStyle, scheduleRender });
      shapes.updateViews();
      return shapes;
    },
    (err) => {
      shapesLoading = undefined; // allow a retry, e.g. after a network hiccup
      throw err;
    },
  );
  return shapesLoading;
}

/** Create a QR instance, with custom dot / corner dot shapes when they're active. */
function createQr(input: Omit<RenderInput, 'customDots' | 'customCornerDots'>): QRCodeStyling {
  return shapes?.createQr(input) ?? new QRCodeStyling(toQrOptions(input));
}

for (const btn of $$('[data-open-shape-editor]')) {
  btn.addEventListener('click', async () => {
    try {
      (await loadShapes()).openEditor(btn.dataset.openShapeEditor as CustomShapeKey);
    } catch {
      toast('Couldn’t load the shape editor — check your connection and try again.');
    }
  });
}

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

function getWarnings(data: string): Warning[] {
  const out: Warning[] = [];
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
  if (shapes) out.push(...shapes.warnings());
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
  if (usesCustomShapes() && !shapes) {
    // Draw without custom shapes only if the chunk can't be loaded at all.
    await loadShapes().catch(() => undefined);
    if (token !== renderToken) return;
  }
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

async function exportInstance(ext: FileExtension): Promise<QRCodeStyling> {
  if (usesCustomShapes() && !shapes) await loadShapes().catch(() => undefined);
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
    await (await exportInstance(ext)).download({ name: 'qr-code', extension: ext });
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
      .then((qr) => qr.getRawData('png'))
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
// After the first preview is on screen, fetch the custom-shape chunk when the page is idle,
// so the editor opens instantly without competing with the first render.
const whenIdle: (cb: () => void) => void =
  'requestIdleCallback' in window ? (cb) => requestIdleCallback(cb, { timeout: 3000 }) : (cb) => setTimeout(cb, 1500);
render().finally(() => whenIdle(() => void loadShapes().catch(() => undefined)));
