import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STATUS_FILE, LOCK_FILE } from './defaults.js';

/**
 * Write the status file the browser polls. Atomic (temp file + rename) so a
 * poll never reads a half-written file.
 */
export async function writeStatus(target, data) {
  const file = path.join(target, STATUS_FILE);
  const tmp = `${file}.tmp`;
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await fs.writeFile(tmp, JSON.stringify(payload));
  await fs.rename(tmp, file);
  return payload;
}

export async function readStatus(target) {
  try {
    return JSON.parse(await fs.readFile(path.join(target, STATUS_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

const LOCK_MAX_AGE_MS = 30 * 60 * 1000;

function isStale(lock) {
  if (!lock || typeof lock !== 'object') return true;
  const age = Date.now() - Date.parse(lock.startedAt || 0);
  if (!(age < LOCK_MAX_AGE_MS)) return true;
  // The pid is only meaningful on the machine that created the lock.
  return lock.host === os.hostname() && typeof lock.pid === 'number' && !pidAlive(lock.pid);
}

/**
 * Take the deploy lock for `target` so two builds cannot overwrite each other's
 * status. Throws when another live deploy holds it.
 * @returns {Promise<() => Promise<void>>} release function
 */
export async function acquireLock(target) {
  await fs.mkdir(target, { recursive: true });
  const file = path.join(target, LOCK_FILE);
  const body = JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, body, { flag: 'wx' });
      return async () => {
        await fs.rm(file, { force: true });
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let lock = null;
      try {
        lock = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch { /* unreadable lock counts as stale */ }
      if (isStale(lock)) {
        await fs.rm(file, { force: true });
        continue;
      }
      throw new Error(
        `Another deploy is already running (pid ${lock.pid} on ${lock.host}, started ${lock.startedAt}). ` +
          'If that is not true, run `npx react-updatify reset`.',
      );
    }
  }
  throw new Error('Could not acquire the deploy lock.');
}

/** Clear a stuck "updating" status and remove the lock (recovery after kill -9, power loss...). */
export async function resetTarget(target) {
  await writeStatus(target, { mode: 'normal', lastResult: 'failed', progress: null, step: null });
  await fs.rm(path.join(target, LOCK_FILE), { force: true });
}
