import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { loadConfig } from './config.js';
import { generateBuildId } from './vite-plugin.js';
import { assertSafeTarget, planSync, syncDir } from './sync-dir.js';
import { acquireLock, writeStatus } from './status.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(String(value));
};

/** Config file values, overridden by UPDATIFY_* environment variables, overridden by CLI flags. */
export function resolveDeploySettings(config, env = process.env, flags = {}) {
  const d = config.deploy;
  return {
    target: flags.target || env.UPDATIFY_TARGET || d.target || null,
    distDir: d.distDir,
    keep: env.UPDATIFY_KEEP ? env.UPDATIFY_KEEP.split(',').map((s) => s.trim()).filter(Boolean) : d.keep,
    clean: bool(env.UPDATIFY_CLEAN, d.clean),
    minOverlaySeconds: env.UPDATIFY_MIN_OVERLAY_SECONDS ? Number(env.UPDATIFY_MIN_OVERLAY_SECONDS) : d.minOverlaySeconds,
    maintenanceDuringBuild: bool(env.UPDATIFY_MAINTENANCE_DURING_BUILD, d.maintenanceDuringBuild),
  };
}

function findViteBin(root) {
  const req = createRequire(path.join(root, 'package.json'));
  let pkgPath;
  try {
    pkgPath = req.resolve('vite/package.json');
  } catch {
    throw new Error('Could not find "vite" in this project. Install it with: npm install -D vite');
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vite;
  return path.join(path.dirname(pkgPath), bin);
}

/** Run `vite build`; resolves with the exit code. `child` is exposed so signals can stop it. */
function runVite(root, args, env, holder) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [findViteBin(root), 'build', ...args], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    holder.child = child;
    child.on('error', reject);
    child.on('close', (code, signal) => {
      holder.child = null;
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

/**
 * `react-updatify build`: the whole flow from the design doc.
 *  - no target configured  → plain `vite build`
 *  - target configured     → build into dist/, show the "Updating" screen, swap files
 *                            safely, clean old files, hide the screen
 * Resolves with the process exit code.
 */
export async function runBuild({ cwd = process.cwd(), viteArgs = [], flags = {}, log = console } = {}) {
  const { config, warnings } = loadConfig(cwd);
  warnings.forEach((w) => log.warn(`[react-updatify] ${w}`));

  const settings = resolveDeploySettings(config, process.env, flags);
  const buildId = process.env.UPDATIFY_BUILD_ID || generateBuildId();
  const env = { UPDATIFY_BUILD_ID: buildId };
  const holder = { child: null };

  if (!settings.target) {
    log.info('[react-updatify] No deploy target configured: building only (set deploy.target or UPDATIFY_TARGET to deploy).');
    return runVite(cwd, viteArgs, env, holder);
  }

  const distDir = path.resolve(cwd, settings.distDir);
  const target = assertSafeTarget(settings.target, { projectRoot: cwd, distDir });
  const dryRun = Boolean(flags.dryRun);
  const texts = config.texts.steps;

  if (settings.minOverlaySeconds < config.poll.idleSeconds + 1) {
    log.warn(
      `[react-updatify] deploy.minOverlaySeconds (${settings.minOverlaySeconds}) is shorter than poll.idleSeconds (${config.poll.idleSeconds}) + 1: ` +
        'some open tabs may miss the update screen (they will still get the "new version" banner).',
    );
  }

  const release = dryRun ? async () => {} : await acquireLock(target);
  let heartbeat = null;
  let finished = false;
  let status = { mode: 'updating', progress: null, step: null, buildId };
  let startedAt = 0;

  // Status writes are serialized so a heartbeat can never overwrite the final "normal" status.
  let writes = Promise.resolve();
  const push = (patch) => {
    status = { ...status, ...patch };
    if (dryRun) return Promise.resolve();
    const snapshot = status;
    writes = writes
      .then(() => writeStatus(target, snapshot))
      .catch((err) => log.warn(`[react-updatify] Could not write the status file: ${err.message}`));
    return writes;
  };

  const finish = async (success, reason) => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
    await push({
      mode: 'normal',
      progress: null,
      step: null,
      lastResult: success ? 'success' : 'failed',
      lastError: success ? null : String(reason || 'failed').slice(0, 500),
      finishedAt: new Date().toISOString(),
    });
    await release().catch(() => {});
  };

  const begin = async (step, progress) => {
    startedAt = Date.now();
    await push({ mode: 'updating', progress, step, startedAt: new Date(startedAt).toISOString(), lastResult: null });
    // Keeps `updatedAt` fresh so browsers do not consider a long build "abandoned".
    heartbeat = setInterval(() => push({}), 5000);
  };

  // Ctrl+C / kill: stop the build, hide the screen, release the lock.
  const onSignal = (signal) => async () => {
    holder.child?.kill('SIGTERM');
    await finish(false, `interrupted (${signal})`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const handlers = { SIGINT: onSignal('SIGINT'), SIGTERM: onSignal('SIGTERM') };
  for (const [sig, fn] of Object.entries(handlers)) process.once(sig, fn);

  try {
    if (settings.maintenanceDuringBuild) await begin(texts.building, 2);

    const code = await runVite(cwd, ['--outDir', distDir, ...viteArgs], env, holder);
    if (code !== 0) {
      await finish(false, `vite build failed with exit code ${code}`);
      log.error('[react-updatify] Build failed: the running site was not touched.');
      return code;
    }

    if (dryRun) {
      const plan = await planSync(distDir, target, { keep: settings.keep, clean: settings.clean });
      log.info(`[react-updatify] Dry run → ${target}`);
      log.info(`  would copy   ${plan.copy.length} file(s)`);
      log.info(`  would remove ${plan.remove.length} file(s)${plan.legacy ? ' (first deploy: no manifest yet, nothing is removed)' : ''}`);
      plan.remove.forEach((f) => log.info(`    - ${f}`));
      if (plan.skipped.length) log.info(`  would skip   ${plan.skipped.length} protected file(s)`);
      await finish(true);
      return 0;
    }

    // Fails here (before anything in the target changed) when dist/ has no index.html.
    await planSync(distDir, target, { keep: settings.keep, clean: settings.clean });

    if (!settings.maintenanceDuringBuild) await begin(texts.preparing, 5);
    else await push({ step: texts.preparing, progress: 5 });

    let lastPush = 0;
    const result = await syncDir(distDir, target, {
      keep: settings.keep,
      clean: settings.clean,
      buildId,
      onProgress: (done, total) => {
        const now = Date.now();
        if (done < total && now - lastPush < 400) return;
        lastPush = now;
        void push({ progress: Math.round(5 + (done / total) * 88), step: fmt(texts.copying, { done, total }) });
      },
    });

    // Hold the screen so every open tab gets a chance to see it, easing the bar to 100%.
    const holdMs = settings.minOverlaySeconds * 1000;
    while (Date.now() - startedAt < holdMs) {
      const ratio = (Date.now() - startedAt) / holdMs;
      await push({ progress: Math.min(99, Math.round(93 + 6 * ratio)), step: texts.finalizing });
      await sleep(400);
    }
    await push({ progress: 100, step: texts.finalizing });
    await finish(true);

    log.info(
      `[react-updatify] Deployed build ${buildId} → ${target} ` +
        `(${result.copied} copied, ${result.unchanged} unchanged, ${result.removed} removed, ${result.skipped.length} protected skipped)`,
    );
    if (result.legacy && settings.clean) {
      log.info('[react-updatify] First deployment: no previous manifest, so old files were left in place. Later deployments clean up automatically.');
    }
    return 0;
  } catch (err) {
    await finish(false, err.message);
    log.error(`[react-updatify] Deploy failed: ${err.message}`);
    return 1;
  } finally {
    clearInterval(heartbeat);
    for (const [sig, fn] of Object.entries(handlers)) process.removeListener(sig, fn);
  }
}
