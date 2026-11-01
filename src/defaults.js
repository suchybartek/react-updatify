/**
 * Default configuration. `.updatify.json` in the project root is deep-merged
 * on top of this object; anything the user does not set falls back to these
 * values. `npx react-updatify init` writes this whole object to disk so every
 * text and path can be edited in one place.
 */
export const DEFAULT_CONFIG = {
  texts: {
    title: 'Updating the app',
    message: 'A new version is being installed. This page will refresh automatically in a moment.',
    steps: {
      building: 'Building the new version',
      preparing: 'Preparing the update',
      copying: 'Copying files ({done}/{total})',
      finalizing: 'Finalizing',
    },
    newVersionMessage: 'A new version is available.',
    refreshButton: 'Refresh',
    dismissLabel: 'Dismiss',
  },
  assets: {
    // Image shown above the title. A path relative to the project root is
    // inlined as a data URI at build time; a value starting with "/" or
    // "http(s)://" is used as a URL as-is. null = no logo.
    logo: null,
    // Icon shown above the title. null = built-in spinner icon,
    // "none" = no icon, otherwise same rules as `logo`.
    icon: null,
  },
  poll: {
    idleSeconds: 5,
    updatingSeconds: 2,
    versionCheckSeconds: 60,
    // A status file that says "updating" but has not been refreshed for this
    // long is treated as abandoned (e.g. the deploy process was killed).
    staleAfterSeconds: 120,
  },
  deploy: {
    // Directory served by your web server. null = `react-updatify build`
    // only builds (like plain `vite build`). Can be overridden with the
    // UPDATIFY_TARGET environment variable (handy for server-only paths).
    target: null,
    distDir: 'dist',
    // Directories (first path segment) in the target that are never touched.
    keep: ['.well-known', 'uploads'],
    // Remove files from the previous deployment that the new build no longer has.
    clean: true,
    // The "Updating" screen is held at least this long so every open tab sees it.
    minOverlaySeconds: 8,
    // Show the "Updating" screen during `vite build` too, not only while copying.
    maintenanceDuringBuild: false,
  },
};

export const STATUS_FILE = 'updatify-status.json';
export const VERSION_FILE = 'updatify-version.json';
export const MANIFEST_FILE = '.updatify-manifest.json';
export const LOCK_FILE = '.updatify-lock';
export const CONFIG_FILE = '.updatify.json';
export const CSS_FILE = '.updatify.css';
