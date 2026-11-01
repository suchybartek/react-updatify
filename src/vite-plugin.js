import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadUserCss, toClientConfig } from './config.js';
import { VERSION_FILE } from './defaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readOwn = (name) => fs.readFileSync(path.join(here, name), 'utf8');

export function generateBuildId() {
  return Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

/** JSON that is safe to embed inside an inline <script>. */
const safeJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

const safeCss = (css) => css.replace(/<\/style/gi, '<\\/style');
const safeJs = (js) => js.replace(/<\/script/gi, '<\\/script');

/**
 * Vite plugin: gives every build an id, writes `updatify-version.json`, and
 * injects the "Updating" overlay runtime (plus default and user CSS) into
 * index.html. No changes to the React code are needed.
 *
 * @param {object} [options]
 * @param {string} [options.buildId]  Override the build id (default: $UPDATIFY_BUILD_ID or generated).
 * @param {boolean} [options.enabled] Set to false to disable injection (e.g. for preview builds).
 */
export function updatify(options = {}) {
  const buildId = options.buildId || process.env.UPDATIFY_BUILD_ID || generateBuildId();
  let resolved;

  return {
    name: 'react-updatify',

    configResolved(config) {
      resolved = config;
    },

    transformIndexHtml: {
      order: 'post',
      handler() {
        if (options.enabled === false) return [];
        const root = resolved.root;
        const isDev = resolved.command === 'serve';

        // Re-read on every call so edits to .updatify.* show up on a dev-server reload.
        const { config, warnings } = loadConfig(root);
        const warn = (msg) => resolved.logger.warn(`[react-updatify] ${msg}`);
        warnings.forEach(warn);

        let base = resolved.base || '';
        if (base && !base.endsWith('/')) base += '/';

        const clientConfig = toClientConfig(config, root, { base, buildId, dev: isDev }, warn);
        const css = readOwn('default.css') + '\n' + loadUserCss(root);

        return [
          { tag: 'style', attrs: { id: 'updatify-style' }, children: safeCss(css), injectTo: 'head' },
          {
            tag: 'script',
            children: `window.__UPDATIFY__=${safeJson(clientConfig)};`,
            injectTo: 'body',
          },
          { tag: 'script', children: safeJs(readOwn('client.js')), injectTo: 'body' },
        ];
      },
    },

    generateBundle() {
      if (resolved.command !== 'build') return;
      this.emitFile({
        type: 'asset',
        fileName: VERSION_FILE,
        source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default updatify;
