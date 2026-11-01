#!/usr/bin/env node
import path from 'node:path';
import { runBuild } from '../src/deploy.js';
import { initProject } from '../src/init.js';
import { loadConfig } from '../src/config.js';
import { resolveDeploySettings } from '../src/deploy.js';
import { assertSafeTarget } from '../src/sync-dir.js';
import { resetTarget, readStatus } from '../src/status.js';

const HELP = `react-updatify — zero-downtime "Updating" screen for React + Vite

Usage:
  react-updatify init [--force]        Create .updatify.json (texts, assets, intervals, deploy)
                                       and .updatify.css (style overrides) in this folder
  react-updatify build [options] [-- <vite build args>]
                                       Build with Vite and, when a deploy target is set,
                                       swap the files on the server behind an "Updating" screen
  react-updatify status                Show the current status file in the deploy target
  react-updatify reset                 Clear a stuck "updating" status and the deploy lock

Build options:
  --target <dir>   Deploy target (overrides .updatify.json / UPDATIFY_TARGET)
  --dry-run        Build, then only print what would be copied and removed

Environment overrides:
  UPDATIFY_TARGET, UPDATIFY_KEEP, UPDATIFY_CLEAN, UPDATIFY_MIN_OVERLAY_SECONDS,
  UPDATIFY_MAINTENANCE_DURING_BUILD
`;

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  let passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      passthrough = argv.slice(i + 1);
      break;
    }
    if (a === '--target') flags.target = argv[++i];
    else if (a.startsWith('--target=')) flags.target = a.slice('--target='.length);
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--force') flags.force = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else rest.push(a);
  }
  return { flags, rest, passthrough };
}

function targetFor(cwd, flags) {
  const { config } = loadConfig(cwd);
  const settings = resolveDeploySettings(config, process.env, flags);
  if (!settings.target) {
    throw new Error('No deploy target configured (deploy.target in .updatify.json, UPDATIFY_TARGET or --target).');
  }
  return assertSafeTarget(settings.target, { projectRoot: cwd, distDir: path.resolve(cwd, settings.distDir) });
}

async function main() {
  const cwd = process.cwd();
  const { flags, rest, passthrough } = parseArgs(process.argv.slice(2));
  const command = rest[0];

  if (!command || flags.help || command === 'help') {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'init': {
      const { created, skipped } = initProject(cwd, { force: flags.force });
      created.forEach((f) => console.log(`created  ${f}`));
      skipped.forEach((f) => console.log(`skipped  ${f} (already exists, use --force to overwrite)`));
      console.log(`
Next steps:
  1. vite.config.js:
       import updatify from 'react-updatify';
       export default defineConfig({ plugins: [react(), updatify()] });
  2. package.json:   "build": "react-updatify build"      (plain build: "build:plain": "vite build")
  3. On the server, set deploy.target in .updatify.json (or UPDATIFY_TARGET) and run: npm run build
  4. Preview the screen any time: open your site with ?updatify-preview`);
      return 0;
    }

    case 'build':
      return runBuild({ cwd, viteArgs: passthrough, flags });

    case 'status': {
      const status = await readStatus(targetFor(cwd, flags));
      console.log(status ? JSON.stringify(status, null, 2) : 'No status file yet (nothing has been deployed with react-updatify).');
      return 0;
    }

    case 'reset': {
      const target = targetFor(cwd, flags);
      await resetTarget(target);
      console.log(`Status reset to "normal" and lock removed in ${target}`);
      return 0;
    }

    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`[react-updatify] ${err.message}`);
    process.exitCode = 1;
  },
);
