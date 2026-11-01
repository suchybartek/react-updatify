import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MANIFEST_FILE } from './defaults.js';

/** Files swapped last: they are the moment the site switches to the new version. */
const SWITCH_FILES = ['index.html', 'updatify-version.json'];

const BLOCKED_TARGETS = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/opt', '/proc', '/root', '/sbin',
  '/srv', '/sys', '/tmp', '/usr', '/var', '/var/www', '/var/www/html', '/Users', '/Applications',
]);

const toPosix = (p) => p.split(path.sep).join('/');
const isInside = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Refuse obviously dangerous deploy targets (typos in config must not wipe a server).
 * Throws an Error with an explanation; returns the resolved target otherwise.
 */
export function assertSafeTarget(target, { projectRoot, distDir } = {}) {
  if (typeof target !== 'string' || !target.trim()) throw new Error('Deploy target is empty.');
  if (!path.isAbsolute(target)) {
    throw new Error(`Deploy target must be an absolute path (got "${target}").`);
  }
  const resolved = path.resolve(target);
  const { root } = path.parse(resolved);
  const depth = resolved.slice(root.length).split(path.sep).filter(Boolean).length;

  if (resolved === root || depth < 2 || BLOCKED_TARGETS.has(resolved) || resolved === os.homedir()) {
    throw new Error(`Refusing to deploy into "${resolved}": the path is too broad to be a website directory.`);
  }
  if (distDir) {
    const dist = path.resolve(distDir);
    if (resolved === dist || isInside(dist, resolved)) {
      throw new Error('Deploy target must not be the build output directory itself.');
    }
  }
  if (projectRoot) {
    const proj = path.resolve(projectRoot);
    if (resolved === proj || isInside(resolved, proj)) {
      throw new Error('Deploy target must not be the project directory or one of its parents.');
    }
  }
  return resolved;
}

async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(toPosix(path.relative(base, full)));
  }
  return out;
}

async function readManifest(target) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(target, MANIFEST_FILE), 'utf8'));
    return Array.isArray(data.files) ? data.files : null;
  } catch {
    return null;
  }
}

/** Is a relative path off-limits (dotfile anywhere in the path, or inside a `keep` directory)? */
function isProtected(rel, keep) {
  const segments = rel.split('/');
  if (segments.some((s) => s.startsWith('.'))) return true;
  return keep.includes(segments[0]);
}

/**
 * Work out what a sync would do without touching the target.
 * @returns {Promise<{copy:string[], remove:string[], skipped:string[], legacy:boolean}>}
 */
export async function planSync(distDir, target, { keep = [], clean = true } = {}) {
  const dist = await listFiles(distDir);
  if (!dist.includes('index.html')) {
    throw new Error(`"${distDir}" has no index.html: the build output looks incomplete, nothing was changed.`);
  }

  const skipped = dist.filter((rel) => isProtected(rel, keep));
  const deployable = dist.filter((rel) => !isProtected(rel, keep));
  const rank = (rel) => (SWITCH_FILES.includes(rel) ? 1 : 0);
  const copy = deployable.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const previous = await readManifest(target);
  const remove = [];
  if (clean && previous) {
    const next = new Set(copy);
    for (const rel of previous) {
      if (!next.has(rel) && !isProtected(rel, keep) && !path.isAbsolute(rel) && !rel.split('/').includes('..')) {
        remove.push(rel);
      }
    }
  }
  return { copy, remove, skipped, legacy: previous === null };
}

async function sameContent(a, b) {
  try {
    const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
    if (sa.size !== sb.size) return false;
    const [ba, bb] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return ba.equals(bb);
  } catch {
    return false;
  }
}

async function pruneEmptyDirs(target, rel) {
  let dir = path.dirname(path.join(target, rel));
  while (dir !== target && isInside(target, dir)) {
    try {
      await fs.rmdir(dir); // only succeeds when empty
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Copy `distDir` into `target` safely:
 *  1. hashed files first (the old site keeps working because old files are still there),
 *  2. each file via a temp name + rename, so the web server never sees a half-written file,
 *  3. index.html and the version file last (the switch-over),
 *  4. afterwards remove only files recorded in the previous manifest.
 * Dotfiles and `keep` directories are never touched.
 *
 * @returns {Promise<{copied:number, unchanged:number, removed:number, skipped:string[], legacy:boolean}>}
 */
export async function syncDir(distDir, target, { keep = [], clean = true, buildId = null, onProgress, onFile } = {}) {
  const plan = await planSync(distDir, target, { keep, clean });
  await fs.mkdir(target, { recursive: true });

  let copied = 0;
  let unchanged = 0;
  let done = 0;
  for (const rel of plan.copy) {
    const src = path.join(distDir, rel);
    const dest = path.join(target, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });

    if (await sameContent(src, dest)) {
      unchanged++;
    } else {
      const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.updatify-tmp`);
      try {
        await fs.copyFile(src, tmp);
        await fs.rename(tmp, dest);
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      copied++;
    }
    onFile?.(rel);
    onProgress?.(++done, plan.copy.length);
  }

  // Manifest is written after the switch-over so a failed copy keeps the old one.
  const manifest = { buildId, updatedAt: new Date().toISOString(), files: plan.copy };
  const manifestPath = path.join(target, MANIFEST_FILE);
  await fs.writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2));
  await fs.rename(`${manifestPath}.tmp`, manifestPath);

  let removed = 0;
  for (const rel of plan.remove) {
    const dest = path.join(target, rel);
    if (!isInside(target, dest)) continue;
    try {
      await fs.rm(dest);
      removed++;
      await pruneEmptyDirs(target, rel);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  return { copied, unchanged, removed, skipped: plan.skipped, legacy: plan.legacy };
}
