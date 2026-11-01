import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeStatus, readStatus, acquireLock, resetTarget } from '../src/status.js';
import { tmpDir } from './helpers.js';

test('writeStatus stamps updatedAt and readStatus returns it', async () => {
  const target = tmpDir();
  await writeStatus(target, { mode: 'updating', progress: 10 });
  const status = await readStatus(target);
  assert.equal(status.mode, 'updating');
  assert.equal(status.progress, 10);
  assert.ok(Date.parse(status.updatedAt) > 0);
  assert.deepEqual(fs.readdirSync(target).filter((f) => f.endsWith('.tmp')), []);
});

test('readStatus returns null when there is no file', async () => {
  assert.equal(await readStatus(tmpDir()), null);
});

test('a second deploy cannot take the lock while the first is alive', async () => {
  const target = tmpDir();
  const release = await acquireLock(target);
  await assert.rejects(acquireLock(target), /Another deploy is already running/);
  await release();
  const again = await acquireLock(target);
  await again();
});

test('a lock left by a dead process is replaced', async () => {
  const target = tmpDir();
  fs.writeFileSync(
    path.join(target, '.updatify-lock'),
    JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), startedAt: new Date().toISOString() }),
  );
  const release = await acquireLock(target);
  await release();
});

test('a lock older than 30 minutes is replaced even if the pid looks alive', async () => {
  const target = tmpDir();
  fs.writeFileSync(
    path.join(target, '.updatify-lock'),
    JSON.stringify({ pid: process.pid, host: 'some-other-host', startedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }),
  );
  const release = await acquireLock(target);
  await release();
});

test('resetTarget clears "updating" and removes the lock', async () => {
  const target = tmpDir();
  await acquireLock(target);
  await writeStatus(target, { mode: 'updating', progress: 50 });
  await resetTarget(target);
  assert.equal((await readStatus(target)).mode, 'normal');
  assert.equal(fs.existsSync(path.join(target, '.updatify-lock')), false);
});
