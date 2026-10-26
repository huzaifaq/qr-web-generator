# QR Studio

A static website for generating styled QR codes, built with [Astro](https://astro.build) and
[qr-code-styling](https://github.com/kozakdenys/qr-code-styling). Everything runs in the
browser. Content, styles, uploaded logos and SVG shapes are never sent anywhere.

## Features

- **Content types:** URL/text, WiFi, contact (vCard 3.0), email, SMS, and phone.
- **Dots:** 6 built-in shapes, with a solid color or a linear/radial gradient.
- **Corner squares and corner dots:** 8 built-in shapes each. They can match the dots or use their own color or gradient.
- **Custom SVG shapes:** replace the dots, the three corner dots, or both with any filled SVG shape.
  - **Sources:** a library of 16 shapes (star, heart, hexagon, sparkle, leaf…), or upload your own `.svg`.
  - **Independent:** dots and corner dots each have their own shape and settings.
  - **Match dots:** with this setting and no custom corner shape, the corner dots copy the custom dot shape.
  - **Built-in shape:** the built-in shape dropdown is disabled while a custom shape is on.
- **Shape editor:**
  - **SVG code view:** live validation and an explanation when a shape can't be used.
  - **Tools:**
    - **Upload SVG:** cleans the file automatically.
    - **Fit to bounds:** tightens the viewBox to the shape.
    - **Clean up:** strips everything except usable shapes.
    - **Undo changes:** restores the shape and its settings.
    - **Copy dot shape:** corner dots only.
  - **Controls:** size, rotation, horizontal/vertical flip, and random rotation per dot.
  - **Previews:** the shape in a single module, a dot pattern, or a full corner marker, in your colors.
- **Background:** color or gradient, transparent, rounded corners, square or circular code, and an adjustable quiet zone.
- **Logo:** upload an image and set its size and padding, with an option to hide the dots behind it. Error correction switches to High automatically.
- **Error correction:** L, M, Q, or H.
- **Presets, randomize, and reset:** 11 presets, including *Starry Night* (star dots) and *Hearts* (heart dots and corners).
- **Export:** PNG, SVG, JPEG, or WebP at 256 to 2048 px, or copy the image to the clipboard. Custom shapes work in every format.
- **Scannability warnings:**
  - low contrast, inverted colors, large logos, and content near the capacity limit;
  - custom shapes that are too small, or corner shapes that are too large;
  - corner shapes too thin through the middle for scanners to find the code.
- **Style link:** shares the design, including custom shapes, but never the content. The style is also remembered in `localStorage`.
- Light and dark themes, and a responsive layout.

## Development

Requires Node.js 22.23.4 or newer (required by Astro 7).

```sh
npm install
npm run dev       # dev server at http://localhost:4321
npm test          # unit tests (payload builders, style state, SVG shape parsing)
npm run check     # type-check .astro and .ts files
npm run build     # static output in dist/
npm run preview   # serve dist/ locally
```

## Deployment

`npm run build` writes a fully static site to `dist/`:

```
dist/
  index.html
  favicon.svg
  assets/app.<hash>.js            main script (~22 KB gzipped)
  assets/customShapes.<hash>.js   custom-shape editor (~6 KB gzipped), loaded after first render
  assets/index.<hash>.css
```

Copy the contents of `dist/` to your web server's document root (for example `/usr/share/nginx/html`).
No server-side runtime or rewrites are needed. Files in `assets/` have content hashes in their names,
so they can be cached long-term (`Cache-Control: public, max-age=31536000, immutable`).
Keep `index.html` uncached or on a short cache.

To serve from a sub-path such as `https://example.com/qr/`, set `base: '/qr'` in
`astro.config.mjs` and rebuild.

## Project structure

```
src/
  pages/index.astro                 page layout
  layouts/Layout.astro              <head>, theme bootstrap
  components/                       content tabs, style panel, presets, preview
  components/ShapeEditor.astro      custom shape editor dialog (shared by dots and corner dots)
  components/CustomShapeSummary.astro  shape thumbnail + "Edit shape…" card
  components/controls/              reusable form controls bound to style state via data-key
  lib/payloads.ts                   builds the encoded string for each content type
  lib/state.ts                      style model, defaults, sanitizing, qr-code-styling mapping
  lib/presets.ts                    presets and randomizer
  lib/shapes.ts                     built-in custom shape library
  lib/customShape.ts                safe SVG shape parser, qr-code-styling extension, scan checks
  lib/contrast.ts                   WCAG contrast helpers
  scripts/generator.ts              client controller (DOM <-> state <-> renderer, export)
  scripts/customShapes.ts           custom shapes: rendering, scan checks, editor (separate chunk)
  styles/global.css                 theme tokens and styles
tests/                              Vitest unit tests
```

Style controls bind to the state with `data-key="dots.fill.color"`-style paths. Conditional controls use
`data-show-if="dots.fill.mode!=solid"` or `data-disable-if="customDot.enabled"`. Terms can be combined with `&`,
and an empty value matches an empty string (`cornersDot.type=`).

To add a new option:

1. Add a field to `StyleConfig` and `DEFAULT_STYLE`.
2. Validate it in `sanitizeStyle`.
3. Map it in `toQrOptions`.
4. Add a control to `StylePanel.astro`.

### Custom shapes

**Safety.** Uploaded and shared SVGs are untrusted, so they are never inserted as markup. `parseShape` keeps only
filled `path`, `circle`, `ellipse`, `rect`, `polygon`, and `polyline` elements. It checks each geometry and
transform attribute against an allowlist, then rebuilds the elements with `createElementNS`. Scripts, event
handlers, `url(...)` values and stroke-only outlines are dropped.

**Rendering.** While a custom shape is active, the dots (or corner dots) are drawn as plain squares. The
`customShapesExtension` extension then replaces each square inside its clip path with the custom shape, so gradients
and every export format work unchanged. qr-code-styling paints each corner dot through a rect exactly the size of
the 3×3 area. The extension enlarges that rect so shapes drawn larger than 100%, or rotated, aren't cropped. The
clip path still limits the paint to the shape.

**Editor and state.** The style holds two independent shapes, `customDot` and `customCornerDot`. One editor dialog
edits both and rebinds its controls to the shape being edited when it opens. If the corner dots are set to
**Match dots** and have no custom shape of their own, they copy the custom dot shape, with its rotation and flips,
at the corner's default size. Styles saved with the older "use dot shape for corner dots" setting migrate
automatically.

**Loading.** All custom-shape code is in `scripts/customShapes.ts`, which `generator.ts` imports dynamically.
The browser fetches it once the first preview is drawn and the page is idle. If a saved or shared style uses a custom
shape, it's fetched straight away and the first preview waits for it. Keep `state.ts` and the other main-bundle
modules from importing `lib/customShape.ts` directly, or the bundler will pull it back into the main script.

**Scannability.** Scanners sample the center of each module, so shapes with a hollow or thin center scan poorly.
Tests with the jsQR and ZXing decoders set the defaults:

- **Dots:** 120% of a module. Every library shape decodes at that size, though star, sparkle and plus decode only
  with the more lenient ZXing.
- **Corner dots:** 130% of the 3×3 center.
  - Scanners find the code using the 1:1:3:1:1 stripes across each corner marker. At 130%, every library shape
    except triangle and cross (an X) still decodes.
  - `centerLineCoverage` measures how much of the horizontal and vertical center lines a corner shape fills. Below
    80%, the app warns that scanners may not find the code. In testing, that threshold flagged exactly the shapes
    that failed.
  - Above 140%, shapes run into the surrounding ring, and the app warns about that too.

Always test with a phone before printing.
