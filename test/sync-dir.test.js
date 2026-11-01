import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncDir, planSync, assertSafeTarget } from '../src/sync-dir.js';
import { tmpDir, writeTree, listTree } from './helpers.js';

const build1 = {
  'index.html': '<html>v1</html>',
  'updatify-version.json': '{"buildId":"1"}',
  'assets/app-aaa.js': 'js1',
  'assets/app-aaa.css': 'css1',
};
const build2 = {
  'index.html': '<html>v2</html>',
  'updatify-version.json': '{"buildId":"2"}',
  'assets/app-bbb.js': 'js2',
  'assets/app-aaa.css': 'css1', // unchanged
};

test('first deploy copies everything, index.html and version file go last', async () => {
  const dist = writeTree(tmpDir(), build1);
  const target = path.join(tmpDir(), 'site');
  const order = [];
  const res = await syncDir(dist, target, { onFile: (f) => order.push(f) });

  assert.equal(res.copied, 4);
  assert.equal(res.legacy, true);
  assert.deepEqual(order.slice(-2).sort(), ['index.html', 'updatify-version.json']);
  assert.ok(order.indexOf('assets/app-aaa.js') < order.indexOf('index.html'));
  assert.equal(fs.readFileSync(path.join(target, 'index.html'), 'utf8'), '<html>v1</html>');
});

test('no temp files are left behind', async () => {
  const dist = writeTree(tmpDir(), build1);
  const target = path.join(tmpDir(), 'site');
  await syncDir(dist, target);
  assert.deepEqual(listTree(target).filter((f) => f.includes('updatify-tmp')), []);
});

test('second deploy removes only files from the previous manifest', async () => {
  const target = path.join(tmpDir(), 'site');
  await syncDir(writeTree(tmpDir(), build1), target);

  // Files that are not ours: must survive.
  writeTree(target, { '.htaccess': 'rewrite', 'robots.txt': 'user file', 'uploads/photo.jpg': 'img', '.well-known/x': 'y' });

  const res = await syncDir(writeTree(tmpDir(), build2), target, { keep: ['.well-known', 'uploads'] });
  assert.equal(res.legacy, false);
  assert.equal(res.removed, 1);
  assert.equal(res.unchanged >= 1, true);

  const files = listTree(target);
  assert.ok(!files.includes('assets/app-aaa.js'), 'old hashed file removed');
  assert.ok(files.includes('assets/app-bbb.js'));
  for (const kept of ['.htaccess', 'robots.txt', 'uploads/photo.jpg', '.well-known/x']) {
    assert.ok(files.includes(kept), `${kept} must survive`);
  }
});

test('first deploy (no manifest) deletes nothing that was already there', async () => {
  const target = writeTree(path.join(tmpDir(), 'site'), { 'assets/old-legacy.js': 'x', 'index.html': 'old' });
  const res = await syncDir(writeTree(tmpDir(), build1), target);
  assert.equal(res.removed, 0);
  assert.ok(listTree(target).includes('assets/old-legacy.js'));
});

test('clean: false keeps old files', async () => {
  const target = path.join(tmpDir(), 'site');
  await syncDir(writeTree(tmpDir(), build1), target, { clean: false });
  const res = await syncDir(writeTree(tmpDir(), build2), target, { clean: false });
  assert.equal(res.removed, 0);
  assert.ok(listTree(target).includes('assets/app-aaa.js'));
});

test('empty directories left by removed files are pruned', async () => {
  const target = path.join(tmpDir(), 'site');
  await syncDir(writeTree(tmpDir(), { 'index.html': 'a', 'assets/img/x.png': 'x' }), target);
  await syncDir(writeTree(tmpDir(), { 'index.html': 'b' }), target);
  assert.equal(fs.existsSync(path.join(target, 'assets')), false);
});

test('dotfiles and keep-directories coming from dist are skipped, not copied', async () => {
  const dist = writeTree(tmpDir(), { 'index.html': 'a', '.htaccess': 'from dist', 'uploads/x.txt': 'x' });
  const target = path.join(tmpDir(), 'site');
  const res = await syncDir(dist, target, { keep: ['uploads'] });
  assert.deepEqual(res.skipped.sort(), ['.htaccess', 'uploads/x.txt']);
  assert.deepEqual(listTree(target).filter((f) => !f.startsWith('.updatify')), ['index.html']);
});

test('dist without index.html changes nothing in the target', async () => {
  const target = writeTree(path.join(tmpDir(), 'site'), { 'index.html': 'live' });
  const dist = writeTree(tmpDir(), { 'assets/a.js': 'x' });
  await assert.rejects(syncDir(dist, target), /no index\.html/);
  assert.equal(fs.readFileSync(path.join(target, 'index.html'), 'utf8'), 'live');
  assert.deepEqual(listTree(target), ['index.html']);
});

test('planSync is read-only and reports the removal list', async () => {
  const target = path.join(tmpDir(), 'site');
  await syncDir(writeTree(tmpDir(), build1), target);
  const before = listTree(target);
  const plan = await planSync(writeTree(tmpDir(), build2), target, { keep: [], clean: true });
  assert.deepEqual(plan.remove, ['assets/app-aaa.js']);
  assert.deepEqual(listTree(target), before);
});

test('a tampered manifest cannot delete outside the target', async () => {
  const outside = writeTree(tmpDir(), { 'secret.txt': 'keep me' });
  const target = path.join(tmpDir(), 'site');
  await syncDir(writeTree(tmpDir(), build1), target);
  const manifestPath = path.join(target, '.updatify-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.push(path.relative(target, path.join(outside, 'secret.txt')), '../../etc/passwd');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  await syncDir(writeTree(tmpDir(), build2), target);
  assert.equal(fs.existsSync(path.join(outside, 'secret.txt')), true);
});

test('assertSafeTarget refuses dangerous paths', () => {
  const project = tmpDir();
  const dist = path.join(project, 'dist');
  for (const bad of ['/', '/var/www', '/var/www/html', '/usr', os.homedir(), 'relative/path', '', dist, path.join(dist, 'x'), project, path.dirname(project)]) {
    assert.throws(() => assertSafeTarget(bad, { projectRoot: project, distDir: dist }), undefined, `should refuse "${bad}"`);
  }
});

test('assertSafeTarget accepts a normal website directory', () => {
  const project = tmpDir();
  assert.equal(assertSafeTarget('/var/www/html/mysite', { projectRoot: project, distDir: path.join(project, 'dist') }), '/var/www/html/mysite');
  assert.equal(assertSafeTarget('/usr/share/nginx/html', { projectRoot: project }), '/usr/share/nginx/html');
});
