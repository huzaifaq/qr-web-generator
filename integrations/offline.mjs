import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const TEMPLATE = new URL('./sw.js', import.meta.url);
const SW_FILE = 'sw.js';

/**
 * Writes dist/sw.js, a service worker that caches every file in the build so the site
 * keeps working when the server is down. The cache version is a hash of the build, so
 * browsers pick up a new deploy and drop the old files.
 *
 * @returns {import('astro').AstroIntegration}
 */
export default function offline() {
  return {
    name: 'offline',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const files = (await readdir(root, { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => `${entry.parentPath}/${entry.name}`.slice(root.length).replace(/\\/g, '/').replace(/^\/+/, ''))
          .filter((file) => file !== SW_FILE)
          .sort();

        const hash = createHash('sha256');
        for (const file of files) hash.update(file).update(await readFile(new URL(file, dir)));
        const version = hash.digest('hex').slice(0, 12);

        const source = (await readFile(TEMPLATE, 'utf8'))
          .replace("const VERSION = '__VERSION__';", `const VERSION = ${JSON.stringify(version)};`)
          .replace('const FILES = __FILES__;', `const FILES = ${JSON.stringify(files)};`);
        await writeFile(new URL(SW_FILE, dir), source);
        logger.info(`${SW_FILE}: caching ${files.length} files (version ${version})`);
      },
    },
  };
}
