import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updatify } from '../src/vite-plugin.js';
import { tmpDir, writeTree } from './helpers.js';

const logger = { warn() {} };

function run(root, { command = 'build', base = '/', options = {} } = {}) {
  const plugin = updatify({ buildId: 'test-build', ...options });
  plugin.configResolved({ root, command, base, logger });
  return plugin.transformIndexHtml.handler('<html></html>');
}

test('injects style in head and two scripts in body', () => {
  const tags = run(tmpDir());
  assert.deepEqual(tags.map((t) => `${t.tag}:${t.injectTo}`), ['style:head', 'script:body', 'script:body']);
});

test('user CSS is injected after the default CSS so it wins', () => {
  const root = writeTree(tmpDir(), { '.updatify.css': '.updatify-card{border:9px solid red}' });
  const css = run(root)[0].children;
  assert.ok(css.indexOf('.updatify-overlay') < css.indexOf('border:9px solid red'));
});

test('texts from .updatify.json reach the page; deploy settings do not', () => {
  const root = writeTree(tmpDir(), {
    '.updatify.json': JSON.stringify({ texts: { title: 'Aktualizacja' }, deploy: { target: '/var/www/secret-path/site' } }),
  });
  const script = run(root)[1].children;
  assert.match(script, /Aktualizacja/);
  assert.doesNotMatch(script, /secret-path/);
  assert.match(script, /"buildId":"test-build"/);
});

test('config JSON is safe inside an inline script', () => {
  const root = writeTree(tmpDir(), { '.updatify.json': JSON.stringify({ texts: { title: '</script><img src=x onerror=alert(1)>' } }) });
  const script = run(root)[1].children;
  assert.doesNotMatch(script, /<\/script/i);
});

test('base is normalised and dev mode is flagged', () => {
  assert.match(run(tmpDir(), { base: '/app' })[1].children, /"base":"\/app\/"/);
  assert.match(run(tmpDir(), { command: 'serve' })[1].children, /"dev":true/);
  assert.match(run(tmpDir(), { command: 'build' })[1].children, /"dev":false/);
});

test('enabled:false injects nothing', () => {
  assert.deepEqual(run(tmpDir(), { options: { enabled: false } }), []);
});

test('generateBundle emits updatify-version.json with the build id (build only)', () => {
  const plugin = updatify({ buildId: 'abc' });
  const emitted = [];
  plugin.configResolved({ root: tmpDir(), command: 'build', base: '/', logger });
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fileName, 'updatify-version.json');
  assert.equal(JSON.parse(emitted[0].source).buildId, 'abc');

  const dev = updatify({ buildId: 'abc' });
  const none = [];
  dev.configResolved({ root: tmpDir(), command: 'serve', base: '/', logger });
  dev.generateBundle.call({ emitFile: (f) => none.push(f) });
  assert.equal(none.length, 0);
});

test('UPDATIFY_BUILD_ID from the CLI is picked up', () => {
  process.env.UPDATIFY_BUILD_ID = 'from-cli';
  try {
    const plugin = updatify();
    const emitted = [];
    plugin.configResolved({ root: tmpDir(), command: 'build', base: '/', logger });
    plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) });
    assert.equal(JSON.parse(emitted[0].source).buildId, 'from-cli');
  } finally {
    delete process.env.UPDATIFY_BUILD_ID;
  }
});
