import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, CONFIG_FILE, CSS_FILE } from './defaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Contents of the starter `.updatify.css` (every variable commented out). */
export function cssTemplate() {
  return fs.readFileSync(path.join(here, 'template.css'), 'utf8');
}

/**
 * Create `.updatify.json` and `.updatify.css` in `root`.
 * Existing files are kept unless `force` is set.
 * @returns {{ created: string[], skipped: string[] }}
 */
export function initProject(root, { force = false } = {}) {
  const files = {
    [CONFIG_FILE]: JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
    [CSS_FILE]: cssTemplate(),
  };
  const created = [];
  const skipped = [];
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    if (fs.existsSync(file) && !force) {
      skipped.push(name);
      continue;
    }
    fs.writeFileSync(file, content);
    created.push(name);
  }
  return { created, skipped };
}
