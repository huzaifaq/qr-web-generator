// @ts-check
import { defineConfig } from 'astro/config';
import offline from './integrations/offline.mjs';

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
    // Astro 7 applies its own file naming unless it is overridden per environment.
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: { entryFileNames: 'assets/app.[hash].js' },
          },
        },
      },
    },
  },
  // Writes dist/sw.js so the site keeps working when the server is down.
  integrations: [offline()],
  devToolbar: {
    enabled: false,
  },
});
