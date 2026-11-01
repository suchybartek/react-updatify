import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadUserCss, resolveAsset, deepMerge, toClientConfig } from '../src/config.js';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { initProject } from '../src/init.js';
import { tmpDir, writeTree } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('without .updatify.json the defaults are used', () => {
  const root = tmpDir();
  const { config, found, warnings } = loadConfig(root);
  assert.equal(found, false);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.deepEqual(warnings, []);
});

test('user values are deep-merged over the defaults', () => {
  const root = tmpDir();
  writeTree(root, {
    '.updatify.json': JSON.stringify({ texts: { title: 'Aktualizacja', steps: { copying: 'Kopiowanie {done}/{total}' } }, poll: { idleSeconds: 10 } }),
  });
  const { config, warnings } = loadConfig(root);
  assert.equal(config.texts.title, 'Aktualizacja');
  assert.equal(config.texts.steps.copying, 'Kopiowanie {done}/{total}');
  assert.equal(config.texts.steps.finalizing, DEFAULT_CONFIG.texts.steps.finalizing, 'untouched keys keep defaults');
  assert.equal(config.poll.idleSeconds, 10);
  assert.equal(config.poll.updatingSeconds, DEFAULT_CONFIG.poll.updatingSeconds);
  assert.deepEqual(warnings, []);
});

test('unknown keys and wrong types produce warnings, not crashes', () => {
  const root = tmpDir();
  writeTree(root, { '.updatify.json': JSON.stringify({ texts: { titel: 'x' }, poll: { idleSeconds: '5' }, nope: 1 }) });
  const { warnings } = loadConfig(root);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.some((w) => w.includes('texts.titel')));
  assert.ok(warnings.some((w) => w.includes('poll.idleSeconds')));
  assert.ok(warnings.some((w) => w.includes('"nope"')));
});

test('invalid JSON throws an error that names the file', () => {
  const root = tmpDir();
  writeTree(root, { '.updatify.json': '{ not json' });
  assert.throws(() => loadConfig(root), /Cannot parse .*\.updatify\.json/);
});

test('arrays are replaced, not merged', () => {
  assert.deepEqual(deepMerge({ keep: ['a', 'b'] }, { keep: ['c'] }), { keep: ['c'] });
});

test('loadUserCss returns "" when the file is missing', () => {
  assert.equal(loadUserCss(tmpDir()), '');
});

test('assets: file paths are inlined, URLs are kept, null/none pass through', () => {
  const root = tmpDir();
  writeTree(root, { 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  assert.match(resolveAsset(root, 'logo.svg', 'logo'), /^data:image\/svg\+xml;base64,/);
  assert.equal(resolveAsset(root, '/logo.svg', 'logo'), '/logo.svg');
  assert.equal(resolveAsset(root, 'https://cdn.example.com/x.png', 'logo'), 'https://cdn.example.com/x.png');
  assert.equal(resolveAsset(root, null, 'logo'), null);
  assert.equal(resolveAsset(root, 'none', 'icon'), 'none');
});

test('assets: missing file and unsupported type give a clear error', () => {
  const root = tmpDir();
  writeTree(root, { 'file.txt': 'x' });
  assert.throws(() => resolveAsset(root, 'missing.png', 'logo'), /assets\.logo.*does not exist/);
  assert.throws(() => resolveAsset(root, 'file.txt', 'logo'), /unsupported image type/);
});

test('toClientConfig exposes only what the browser needs', () => {
  const root = tmpDir();
  const client = toClientConfig(DEFAULT_CONFIG, root, { buildId: 'b1', base: '/' });
  assert.equal(client.buildId, 'b1');
  assert.ok(client.texts && client.assets && client.poll);
  assert.equal('deploy' in client, false, 'deploy settings (server paths) must not leak into index.html');
});

test('init creates both files once and does not overwrite without --force', () => {
  const root = tmpDir();
  const first = initProject(root);
  assert.deepEqual(first.created.sort(), ['.updatify.css', '.updatify.json']);
  fs.writeFileSync(path.join(root, '.updatify.json'), '{"texts":{"title":"mine"}}');
  const second = initProject(root);
  assert.deepEqual(second.created, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.updatify.json'), 'utf8')).texts.title, 'mine');
  initProject(root, { force: true });
  assert.equal(loadConfig(root).config.texts.title, DEFAULT_CONFIG.texts.title);
});

test('the generated .updatify.json is a valid, warning-free config', () => {
  const root = tmpDir();
  initProject(root);
  const { warnings, config } = loadConfig(root);
  assert.deepEqual(warnings, []);
  assert.deepEqual(config, DEFAULT_CONFIG);
});

test('template.css documents every --updatify-* variable of default.css', () => {
  const defaults = fs.readFileSync(path.join(here, '../src/default.css'), 'utf8');
  const template = fs.readFileSync(path.join(here, '../src/template.css'), 'utf8');
  const vars = new Set(defaults.match(/--updatify-[\w-]+(?=\s*:)/g));
  assert.ok(vars.size > 10);
  for (const v of vars) assert.ok(template.includes(v), `template.css is missing ${v}`);
});
