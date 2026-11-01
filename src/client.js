/* react-updatify browser runtime.
   Inlined into index.html by the Vite plugin; reads window.__UPDATIFY__.
   Plain ES5-style DOM code on purpose: it must keep working even when the
   React bundle is old, broken or still downloading. */
(function () {
  'use strict';

  var cfg = window.__UPDATIFY__;
  if (!cfg || window.__UPDATIFY_STARTED__) return;
  window.__UPDATIFY_STARTED__ = true;

  var doc = document;
  var overlay = null;
  var banner = null;
  var parts = {};
  var lastMode = 'normal';
  var dismissedBuild = null;
  var statusTimer = null;
  var versionTimer = null;

  var SPINNER_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fileUrl(name) {
    return new URL((cfg.base || '') + name, doc.baseURI).toString();
  }

  /** Resolves to { ok:false } when the server is unreachable, otherwise { ok:true, data, now }. */
  function fetchJson(name) {
    return fetch(fileUrl(name) + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        var now = Date.parse(res.headers.get('date') || '') || Date.now();
        if (res.status >= 500) return { ok: false };
        if (!res.ok) return { ok: true, data: null, now: now };
        return res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { /* SPA fallback returned HTML: no status file */ }
          return { ok: true, data: data, now: now };
        });
      })
      .catch(function () { return { ok: false }; });
  }

  function isUpdating(status, now) {
    if (!status || status.mode !== 'updating') return false;
    var at = Date.parse(status.updatedAt);
    return !(at && now - at > cfg.poll.staleAfterSeconds * 1000);
  }

  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, k) {
      return vars && vars[k] !== undefined ? vars[k] : m;
    });
  }

  /* ---------- Overlay ---------- */

  function buildOverlay() {
    var texts = cfg.texts;
    var assets = cfg.assets || {};
    overlay = el('div', 'updatify-overlay');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-labelledby', 'updatify-title');

    var card = el('div', 'updatify-card');
    if (assets.logo) {
      var logo = el('img', 'updatify-logo');
      logo.src = assets.logo;
      logo.alt = '';
      card.appendChild(logo);
    }
    if (assets.icon !== 'none') {
      if (assets.icon) {
        var img = el('img', 'updatify-icon');
        img.src = assets.icon;
        img.alt = '';
        card.appendChild(img);
      } else {
        var icon = el('div', 'updatify-icon');
        icon.innerHTML = SPINNER_SVG; // constant markup defined above
        card.appendChild(icon);
      }
    }
    parts.title = el('h2', 'updatify-title', texts.title);
    parts.title.id = 'updatify-title';
    parts.message = el('p', 'updatify-message', texts.message);
    parts.progress = el('div', 'updatify-progress');
    parts.progress.setAttribute('role', 'progressbar');
    parts.progress.setAttribute('aria-valuemin', '0');
    parts.progress.setAttribute('aria-valuemax', '100');
    parts.bar = el('div', 'updatify-progress-bar');
    parts.progress.appendChild(parts.bar);
    parts.step = el('p', 'updatify-step');

    card.appendChild(parts.title);
    card.appendChild(parts.message);
    card.appendChild(parts.progress);
    card.appendChild(parts.step);
    overlay.appendChild(card);
    doc.body.appendChild(overlay);
    doc.documentElement.classList.add('updatify-active');
  }

  function showOverlay(status) {
    if (banner) hideBanner();
    if (!overlay) buildOverlay();
    if (status.title) parts.title.textContent = status.title;
    if (status.message) parts.message.textContent = status.message;
    parts.step.textContent = status.step || '';

    var p = typeof status.progress === 'number' ? Math.max(0, Math.min(100, status.progress)) : null;
    if (p === null) {
      parts.progress.className = 'updatify-progress updatify-progress--indeterminate';
      parts.progress.removeAttribute('aria-valuenow');
      parts.bar.style.width = '';
    } else {
      parts.progress.className = 'updatify-progress';
      parts.progress.setAttribute('aria-valuenow', String(Math.round(p)));
      parts.bar.style.width = p + '%';
    }
  }

  function hideOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    parts = {};
    doc.documentElement.classList.remove('updatify-active');
  }

  /* ---------- "New version available" banner ---------- */

  function showBanner(buildId) {
    if (banner || overlay || dismissedBuild === buildId) return;
    var texts = cfg.texts;
    banner = el('div', 'updatify-banner');
    banner.setAttribute('role', 'status');
    banner.appendChild(el('span', 'updatify-banner-text', texts.newVersionMessage));

    var refresh = el('button', 'updatify-banner-button', texts.refreshButton);
    refresh.type = 'button';
    refresh.onclick = function () { location.reload(); };
    banner.appendChild(refresh);

    var close = el('button', 'updatify-banner-dismiss', '×');
    close.type = 'button';
    close.setAttribute('aria-label', texts.dismissLabel);
    close.onclick = function () { dismissedBuild = buildId; hideBanner(); };
    banner.appendChild(close);

    doc.body.appendChild(banner);
  }

  function hideBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  /* ---------- Polling ---------- */

  function tickStatus() {
    fetchJson('updatify-status.json').then(function (r) {
      var mode = lastMode;
      if (r.ok) {
        var status = r.data;
        if (isUpdating(status, r.now)) {
          mode = 'updating';
          showOverlay(status);
        } else {
          mode = 'normal';
          if (lastMode === 'updating') {
            hideOverlay();
            // A failed deploy leaves the old version in place: nothing to reload for.
            if (!(status && status.lastResult === 'failed')) {
              location.reload();
              return;
            }
          }
        }
      }
      lastMode = mode;
      var seconds = mode === 'updating' ? cfg.poll.updatingSeconds : cfg.poll.idleSeconds;
      statusTimer = setTimeout(tickStatus, seconds * 1000);
    });
  }

  function tickVersion() {
    fetchJson('updatify-version.json').then(function (r) {
      var data = r.ok && r.data;
      if (data && data.buildId && cfg.buildId && data.buildId !== cfg.buildId && lastMode !== 'updating') {
        showBanner(data.buildId);
      }
      versionTimer = setTimeout(tickVersion, cfg.poll.versionCheckSeconds * 1000);
    });
  }

  function restartPolling() {
    clearTimeout(statusTimer);
    clearTimeout(versionTimer);
    tickStatus();
    tickVersion();
  }

  /* ---------- Preview (?updatify-preview, ?updatify-preview=40, =indeterminate, =banner) ---------- */

  function previewValue() {
    var m = /[?&]updatify-preview(?:=([^&]*))?/.exec(location.search);
    return m ? decodeURIComponent(m[1] || '') : null;
  }

  function runPreview(value) {
    if (value === 'banner') {
      showBanner('preview');
      return;
    }
    var progress = value === 'indeterminate' ? null : value === '' || isNaN(Number(value)) ? 60 : Number(value);
    showOverlay({
      mode: 'updating',
      progress: progress,
      step: fmt(cfg.texts.steps.copying, { done: 6, total: 10 }),
    });
  }

  function start() {
    var preview = previewValue();
    if (preview !== null) return runPreview(preview);
    if (cfg.dev) return; // dev server: nothing to poll, only preview is available
    restartPolling();
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'visible') restartPolling();
    });
  }

  if (doc.body) start();
  else doc.addEventListener('DOMContentLoaded', start);
})();
