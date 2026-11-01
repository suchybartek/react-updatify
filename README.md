# react-updatify

Deploy a React + Vite app with one command and **no broken page for your users**.

`npm run build` on the server builds the new version aside, shows an **"Updating"** screen with a progress bar in every open tab, swaps the files safely, and the tabs **reload themselves** into the new version. If the build fails, the running site is not touched.

- No backend, no database: state lives in one static file next to your app (`updatify-status.json`).
- No changes to your React code: a Vite plugin injects the screen.
- Zero runtime dependencies.
- Default look in light and dark mode, customisable with a single `.updatify.css`.

## Quick start

```bash
npm install react-updatify
npx react-updatify init
```

`init` creates two files in your project root:

| File | Purpose |
|---|---|
| `.updatify.json` | Every text, asset path, polling interval and deploy setting, pre-filled with the defaults |
| `.updatify.css` | Style overrides (starts as a commented template, so nothing changes until you edit it) |

**1. `vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import updatify from 'react-updatify';

export default defineConfig({
  plugins: [react(), updatify()],
});
```

**2. `package.json`**

```json
"scripts": {
  "build": "react-updatify build",
  "build:plain": "vite build"
}
```

**3. On the server**, tell it where your web server serves the site from, either in `.updatify.json` (`deploy.target`) or per machine:

```bash
export UPDATIFY_TARGET=/var/www/html/myapp
npm run build
```

Without a target, `react-updatify build` just runs `vite build` (so it is safe on your laptop).

## What happens on `npm run build`

1. Vite builds into `dist/`. The live site is untouched; a failed build stops here.
2. `updatify-status.json` in the target is set to `updating`. Open tabs poll it and show the screen.
3. Files are copied: hashed assets first, each through a temp name + `rename`, `index.html` last (the switch-over).
4. Files that the **previous deployment** copied and the new build no longer has are removed (tracked in `.updatify-manifest.json`).
5. The screen is held for at least `minOverlaySeconds` (default 8 s) so every tab sees it, then the status returns to `normal` and tabs call `location.reload()`.

Tabs that were asleep and missed the screen still find out: every minute the page compares its build id with `updatify-version.json` and shows a **"A new version is available — Refresh"** banner.

Ctrl+C or a crash during deploy hides the screen again and releases the lock. A second `npm run build` started during a deploy refuses to run. If a process was killed hard (`kill -9`), run `npx react-updatify reset`.

## Customising

### Texts and assets: `.updatify.json`

Everything is optional; missing keys fall back to the defaults. Typos are reported as warnings.

```json
{
  "texts": {
    "title": "Aktualizacja",
    "message": "Instalujemy nową wersję. Strona odświeży się sama.",
    "steps": {
      "preparing": "Przygotowanie",
      "copying": "Kopiowanie plików ({done}/{total})",
      "finalizing": "Kończenie"
    },
    "newVersionMessage": "Dostępna jest nowa wersja.",
    "refreshButton": "Odśwież",
    "dismissLabel": "Zamknij"
  },
  "assets": { "logo": "public/logo.svg", "icon": null },
  "poll": { "idleSeconds": 5, "updatingSeconds": 2, "versionCheckSeconds": 60, "staleAfterSeconds": 120 },
  "deploy": {
    "target": null,
    "distDir": "dist",
    "keep": [".well-known", "uploads"],
    "clean": true,
    "minOverlaySeconds": 8,
    "maintenanceDuringBuild": false
  }
}
```

**Assets** (`logo`, `icon`): a path relative to the project root is inlined into `index.html` as a data URI at build time (keep it small); a value starting with `/` or `http(s)://` is used as a URL as-is. `icon: null` is the built-in spinner, `"none"` hides it.

The `deploy` section never reaches the browser.

### Look: `.updatify.css`

The file is injected **after** the default styles, so anything you write wins. The easy way is to override variables:

```css
:root {
  --updatify-accent: #e11d48;
  --updatify-radius: 8px;
  --updatify-font: "Inter", sans-serif;
}
```

All variables: `--updatify-font`, `-accent`, `-accent-contrast`, `-bg`, `-fg`, `-muted`, `-track`, `-backdrop`, `-blur`, `-radius`, `-shadow`, `-card-width`, `-card-padding`, `-title-size`, `-text-size`, `-logo-height`, `-icon-size`, `-bar-height`, `-transition`, `-z-index`. Dark mode follows the system; override it in a `@media (prefers-color-scheme: dark)` block.

For full control, target the stable classes: `.updatify-overlay`, `.updatify-card`, `.updatify-logo`, `.updatify-icon`, `.updatify-title`, `.updatify-message`, `.updatify-progress` (`--indeterminate` when there is no percentage), `.updatify-progress-bar`, `.updatify-step`, `.updatify-banner`, `.updatify-banner-text`, `.updatify-banner-button`, `.updatify-banner-dismiss`. `prefers-reduced-motion` is respected.

### Preview without deploying

Open your site (dev server or production) with:

| URL | Shows |
|---|---|
| `?updatify-preview` | Overlay at 60 % |
| `?updatify-preview=25` | Overlay at 25 % |
| `?updatify-preview=indeterminate` | Overlay with the endless bar |
| `?updatify-preview=banner` | "New version available" banner |

In `vite dev` changes to `.updatify.*` show up after a page reload.

## CLI

```
react-updatify init [--force]                 create .updatify.json and .updatify.css
react-updatify build [--target <dir>] [--dry-run] [-- <vite build args>]
react-updatify status                         print the status file of the target
react-updatify reset                          clear a stuck "updating" status and the lock
```

`--dry-run` builds, then prints what would be copied and removed without touching the target.

Environment overrides (win over `.updatify.json`): `UPDATIFY_TARGET`, `UPDATIFY_KEEP` (comma separated), `UPDATIFY_CLEAN`, `UPDATIFY_MIN_OVERLAY_SECONDS`, `UPDATIFY_MAINTENANCE_DURING_BUILD`.

## Safety rules

- The target must be an absolute path, at least two levels deep, and not `/`, `/var/www`, `/var/www/html`, your home folder, the project, or `dist/`.
- Dotfiles (`.htaccess`) and the `keep` directories (default `.well-known`, `uploads`) are never overwritten or deleted. Dotfiles in `dist/` are skipped too.
- Only files listed in the previous manifest are removed. **On the very first deployment there is no manifest, so nothing is removed**; leftovers from a manual deploy have to be deleted once by hand.
- Nothing is changed when `dist/` has no `index.html`.
- Tip: for the very first run, use `--dry-run` and keep a backup of the target.

## Limits

- State is per target directory. Two apps sharing one target would share one status.
- The reload relies on polling, so a sleeping tab only notices after waking (the banner covers that).
- There is no automatic rollback: to go back, deploy the previous commit again.
- Assumes the status file and your app are served from the same origin and `base` as the page (`updatify-status.json` is fetched relative to Vite's `base`).
- Requires Vite 5+ and Node 18+ (tested with Vite 6 and Node 22).

## Development

```bash
npm test
```

`examples/vite-react` is a tiny app wired up with the plugin: run `npm install` inside it, then `UPDATIFY_TARGET=/some/dir npm run build`.

## License

MIT
