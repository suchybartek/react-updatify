import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, CONFIG_FILE, CSS_FILE } from './defaults.js';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge: objects are merged, arrays and scalars are replaced. */
export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = key in base ? deepMerge(base[key], override[key]) : override[key];
  }
  return out;
}

/** Report unknown keys and wrong types so typos in .updatify.json do not fail silently. */
export function validateConfig(user, defaults = DEFAULT_CONFIG, prefix = '') {
  const warnings = [];
  if (!isPlainObject(user)) return warnings;
  for (const key of Object.keys(user)) {
    const where = prefix + key;
    if (!(key in defaults)) {
      warnings.push(`${CONFIG_FILE}: unknown option "${where}" (ignored)`);
      continue;
    }
    const def = defaults[key];
    const val = user[key];
    if (isPlainObject(def)) {
      if (!isPlainObject(val)) warnings.push(`${CONFIG_FILE}: "${where}" should be an object`);
      else warnings.push(...validateConfig(val, def, where + '.'));
    } else if (def !== null && val !== null && typeof def !== typeof val) {
      warnings.push(`${CONFIG_FILE}: "${where}" should be of type ${Array.isArray(def) ? 'array' : typeof def}`);
    }
  }
  return warnings;
}

/**
 * Load `.updatify.json` from `root` (optional file) merged over the defaults.
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[], found: boolean }}
 */
export function loadConfig(root, file = CONFIG_FILE) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) {
    return { config: structuredClone(DEFAULT_CONFIG), warnings: [], found: false };
  }
  let user;
  try {
    user = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot parse ${filePath}: ${err.message}`);
  }
  if (!isPlainObject(user)) throw new Error(`${filePath} must contain a JSON object`);
  return {
    config: deepMerge(structuredClone(DEFAULT_CONFIG), user),
    warnings: validateConfig(user),
    found: true,
  };
}

/** Contents of the optional `.updatify.css` ('' when it does not exist). */
export function loadUserCss(root, file = CSS_FILE) {
  const filePath = path.join(root, file);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

const MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

const INLINE_WARN_BYTES = 200 * 1024;

/**
 * Turn an asset setting into something the browser can load.
 *  - null / "none"                → returned unchanged
 *  - "/x.svg", "http(s)://…", data: → used as a URL as-is
 *  - anything else                → file path relative to `root`, inlined as a data URI
 */
export function resolveAsset(root, value, name, warn = () => {}) {
  if (value === null || value === undefined || value === 'none') return value ?? null;
  if (typeof value !== 'string') throw new Error(`${CONFIG_FILE}: assets.${name} must be a string or null`);
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('/')) return value;

  const filePath = path.resolve(root, value);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${CONFIG_FILE}: assets.${name} points to a file that does not exist: ${value}`);
  }
  const mime = MIME[path.extname(filePath).toLowerCase()];
  if (!mime) {
    throw new Error(`${CONFIG_FILE}: assets.${name} has an unsupported image type (${path.extname(filePath) || 'no extension'})`);
  }
  const buf = fs.readFileSync(filePath);
  if (buf.length > INLINE_WARN_BYTES) {
    warn(`assets.${name} (${value}) is ${Math.round(buf.length / 1024)} KB and is inlined into index.html; consider a smaller image.`);
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Config subset that is embedded in index.html for the browser runtime. */
export function toClientConfig(config, root, extra = {}, warn = () => {}) {
  return {
    texts: config.texts,
    assets: {
      logo: resolveAsset(root, config.assets.logo, 'logo', warn),
      icon: resolveAsset(root, config.assets.icon, 'icon', warn),
    },
    poll: config.poll,
    ...extra,
  };
}
