// @ts-check
import { defineConfig } from 'astro/config';

// Fully static output: `npm run build` writes plain HTML/CSS/JS to dist/.
// If you serve the site from a sub-path (e.g. https://example.com/qr/),
// set `base: '/qr'` below and rebuild.
export default defineConfig({
  output: 'static',
  base: '/',
  build: {
    assets: 'assets',
  },
  vite: {
    build: {
      rollupOptions: {
        output: { entryFileNames: 'assets/app.[hash].js' },
      },
    },
  },
  devToolbar: {
    enabled: false,
  },
});
