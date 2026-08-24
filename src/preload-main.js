'use strict';

/**
 * Main-window preload. Two jobs:
 *   1. Inject the user's appearance CSS (accent / background image + blur + dim /
 *      font / density / custom CSS) into the DeepSeek Harness web UI.
 *   2. Inject a "桌面外观" block into the web UI's Settings → General section so
 *      the user can change those options in place.
 */
const { ipcRenderer } = require('electron');

const DEFAULTS = {
  accent: '',
  customCss: '',
  background: '',    // data URL of the background image
  backgroundBlur: 0, // px
  backgroundDim: 0,  // 0..1 dark overlay over the image
  opacity: 0.7,      // 0..1 surface solidity (lower = see-through)
  fontFamily: '',
  fontSize: '',
  density: ''        // '' | 'compact' | 'cozy'
};

const ROW_ID = 'dsh-desktop-appearance-row';

// ---------- color utils ----------

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const p = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

// ---------- theme CSS generation ----------

function accentCss(c) {
  const hover = shade(c, -0.12);
  return `
:root, body, body[data-ds-dark-theme] {
  --dsw-static-deepseek-400: ${c} !important;
  --dsw-static-deepseek-450: ${c} !important;
  --dsw-static-deepseek-500: ${hover} !important;
  --dsw-alias-brand-primary-new-colorprimary-new-color: ${c} !important;
  --dsw-alias-button-info-fill: ${c} !important;
  --dsw-alias-button-info-hover: ${hover} !important;
  --dsw-alias-label-primary-bluish: ${c} !important;
  --dsw-specific-sidebar-nav-item-active-accent: ${c} !important;
  --dsw-specific-bubble-highlight: ${c} !important;
}
`;
}

/** Layered surface transparency (faithful port of the reference repo's
 *  `mixWallpaperSurfaces`). Only the main canvas becomes strongly see-through;
 *  the raised surfaces that carry text (cards, composer) keep their solidity,
 *  so text stays readable over the wallpaper. */
function surfaceCss(a) {
  const op = a.opacity === undefined ? 0.7 : Math.max(0.1, Math.min(0.95, Number(a.opacity) || 0.7));
  const kept = Math.round(op * 100); // glass solidity percent
  let canvas;
  if (kept <= 40) canvas = Math.round(kept * 0.375);
  else if (kept <= 80) canvas = Math.round(15 + (kept - 40) * 0.75);
  else canvas = Math.round(45 + (kept - 80) * 2.75);
  const sidebar = Math.round((canvas + kept) / 2);

  const lightBase = 'var(--dsw-static-neutral-bluish-00)';
  const darkBase = 'var(--dsw-static-neutral-bluish-950)';
  const darkRaised = 'var(--dsw-static-neutral-bluish-875)';

  return `
body {
  --dsw-alias-bg-base: color-mix(in srgb, ${lightBase} ${canvas}%, transparent) !important;
  --dsw-alias-bg-layer-1: color-mix(in srgb, ${lightBase} ${kept}%, transparent) !important;
  --dsw-alias-bg-layer-2: color-mix(in srgb, ${lightBase} ${kept}%, transparent) !important;
  --dsw-alias-bg-layer-3: color-mix(in srgb, ${lightBase} ${kept}%, transparent) !important;
  --dsw-specific-sidebar-fill: color-mix(in srgb, ${lightBase} ${sidebar}%, transparent) !important;
}
body[data-ds-dark-theme] {
  --dsw-alias-bg-base: color-mix(in srgb, ${darkBase} ${canvas}%, transparent) !important;
  --dsw-alias-bg-layer-1: color-mix(in srgb, ${darkRaised} ${kept}%, transparent) !important;
  --dsw-alias-bg-layer-2: color-mix(in srgb, ${darkRaised} ${kept}%, transparent) !important;
  --dsw-alias-bg-layer-3: color-mix(in srgb, ${darkRaised} ${kept}%, transparent) !important;
  --dsw-specific-sidebar-fill: color-mix(in srgb, ${darkRaised} ${sidebar}%, transparent) !important;
}
`;
}

const WALLPAPER_LAYER_ID = 'dsh-wallpaper';
const WALLPAPER_INNER_ID = 'dsh-wallpaper-inner';
const WALLPAPER_ATTR = 'data-dsh-wallpaper';
const WALLPAPER_BLEED = 48;

/** Manage the fixed wallpaper layer (image + blur), painted behind `#root`. */
function applyWallpaperLayer(a) {
  const root = document.documentElement;
  if (!root || !document.body) return;

  if (!a.background) {
    root.removeAttribute(WALLPAPER_ATTR);
    root.style.removeProperty('--dsh-wallpaper-blur');
    const layer = document.getElementById(WALLPAPER_LAYER_ID);
    if (layer) layer.remove();
    return;
  }

  root.setAttribute(WALLPAPER_ATTR, '');
  const blurPx = Number(a.backgroundBlur) || 0;
  root.style.setProperty('--dsh-wallpaper-blur', `${blurPx}px`);

  let layer = document.getElementById(WALLPAPER_LAYER_ID);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = WALLPAPER_LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('div');
    inner.id = WALLPAPER_INNER_ID;
    layer.appendChild(inner);
    document.body.insertBefore(layer, document.body.firstChild);
  }
  const inner = layer.firstElementChild;
  if (inner) {
    const dim = Math.max(0, Math.min(1, Number(a.backgroundDim) || 0));
    const dimLayer = dim > 0 ? `linear-gradient(rgba(0, 0, 0, ${dim}), rgba(0, 0, 0, ${dim})), ` : '';
    inner.style.backgroundImage = `${dimLayer}url("${a.background}")`;
  }
}

function fontCss(a) {
  let css = '';
  if (a.fontFamily) css += `html, body { font-family: ${a.fontFamily} !important; }\n`;
  if (a.fontSize) css += `html { font-size: ${a.fontSize} !important; }\n`;
  return css;
}

function densityCss(density) {
  if (density === 'compact') return `body { line-height: 1.35 !important; }\n`;
  if (density === 'cozy') return `body { line-height: 1.72 !important; }\n`;
  return '';
}

function buildThemeCss(a) {
  let css = '';
  if (a.accent) css += accentCss(a.accent);
  if (a.background) css += surfaceCss(a);
  if (a.fontFamily || a.fontSize) css += fontCss(a);
  if (a.density) css += densityCss(a.density);
  if (a.customCss) css += `\n/* --- custom CSS --- */\n${a.customCss}\n`;
  return css;
}

let themeEl = null;
function applyTheme(a) {
  if (!themeEl) {
    themeEl = document.createElement('style');
    themeEl.id = 'dsh-desktop-theme';
    (document.head || document.documentElement).appendChild(themeEl);
  }
  themeEl.textContent = buildThemeCss(a);
  applyWallpaperLayer(a);
  console.log('[dsh-desktop] background:', !!(a.background), 'blur:', a.backgroundBlur, 'dim:', a.backgroundDim);
  // Diagnostic: report what actually landed, so we can see why the wallpaper
  // does not show through without needing manual DevTools inspection.
  setTimeout(() => {
    try {
      const cs = getComputedStyle(document.body);
      const root = document.getElementById('root');
      const rootBg = root ? getComputedStyle(root).backgroundColor : 'n/a';
      const layers = [];
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      for (const el of document.querySelectorAll('body *')) {
        if (layers.length >= 8) break;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.5 || r.height < vh * 0.5) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue;
        const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 30);
        layers.push({ t: el.tagName.toLowerCase(), c: cls, bg });
      }
      console.log('[dsh-desktop debug]', JSON.stringify({
        hasBg: !!a.background,
        opacity: a.opacity,
        bodyBgImage: (cs.backgroundImage || 'none').slice(0, 40),
        bodyBgColor: cs.backgroundColor,
        rootBg,
        opaqueLayers: layers
      }));
    } catch (e) {
      console.log('[dsh-desktop debug] err', e && e.message);
    }
  }, 60);
}

// ---------- controls styling ----------

const CONTROLS_CSS = `
#dsh-desktop-appearance-row {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(128,128,128,0.18);
}
.dshd-title { font-weight: 700; font-size: 13px; opacity: 0.92; }
.dshd-field { display: flex; flex-direction: column; gap: 6px; }
.dshd-label { font-size: 12px; opacity: 0.6; }
.dshd-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshd-row input[type="text"],
.dshd-row select { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; color: inherit; padding: 5px 8px; font-size: 12px; }
.dshd-row input[type="color"] { width: 34px; height: 26px; padding: 0; border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; background: none; }
.dshd-row input[type="range"] { flex: 1; min-width: 120px; }
.dshd-btn { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; color: inherit; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.dshd-btn:hover { background: rgba(255,255,255,0.14); }
.dshd-textarea { width: 100%; min-height: 80px; resize: vertical; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; color: inherit; padding: 8px; font: 11.5px/1.5 Consolas, monospace; }
.dshd-hint { font-size: 11px; opacity: 0.5; }
.dshd-update-log { width: 100%; box-sizing: border-box; max-height: 180px; overflow: auto; margin: 8px 0 0; padding: 8px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.14); border-radius: 6px; font: 11px/1.5 Consolas, monospace; white-space: pre-wrap; word-break: break-all; color: inherit; }
#dsh-desktop-plugin-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(128,128,128,0.18);
}
#dshd-plugin-center,
#dshd-diagnostics-center {
  position: fixed;
  z-index: 2147483641;
  inset: 0 0 0 auto;
  width: clamp(460px, 48vw, 820px);
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr);
  overflow: hidden;
  color: #181b22;
  background: #fff;
  border-left: 1px solid #dfe3e9;
  box-shadow: -12px 0 32px rgba(29, 36, 53, .12);
}
#dshd-plugin-center[hidden],
#dshd-diagnostics-center[hidden] { display: none !important; }
.dshd-plugin-center-head,
.dshd-diagnostics-center-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid #dfe3e9;
}
.dshd-plugin-center-head strong,
.dshd-diagnostics-center-head strong { font-size: 15px; }
.dshd-plugin-center-head span,
.dshd-diagnostics-center-head span { flex: 1; color: #6e7686; font-size: 12px; }
.dshd-plugin-center-close { width: 30px; height: 30px; border: 0; color: #687083; background: transparent; cursor: pointer; font-size: 20px; }
#dshd-plugin-center .dshd-plugin-standalone {
  position: static;
  min-width: 0;
  overflow: auto;
  box-sizing: border-box;
  gap: 18px !important;
  padding: 18px 24px 28px !important;
  border-bottom: 0 !important;
  background: #fff;
}
#dshd-plugin-center .dshd-plugin-list { max-height: none; overflow: visible; }
#dshd-plugin-center .dshd-plugin-card { padding: 13px 14px; border: 1px solid #e2e5eb; border-radius: 6px; background: #fff; }
#dshd-plugin-center .dshd-plugin-card:hover { border-color: #bdc6ff; box-shadow: 0 2px 10px rgba(29, 36, 53, .06); }
#dshd-plugin-center .dshd-plugin-card-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
#dshd-plugin-center .dshd-plugin-card-source { color: #6e7686; font-size: 11px; }
#dshd-plugin-center .dshd-plugin-card-link { color: #4d6bfe; font-size: 11px; text-decoration: none; }
#dshd-plugin-center .dshd-plugin-card-link:hover { text-decoration: underline; }
#dshd-plugin-center .dshd-plugin-card-meta { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; color: #6e7686; font-size: 11px; }
#dshd-plugin-center .dshd-plugin-card-meta strong { color: #4e5665; font-weight: 650; }
.dshd-plugin-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dshd-plugin-head-copy { min-width: 0; }
.dshd-plugin-head-copy .dshd-hint { margin-top: 4px; line-height: 1.55; }
.dshd-plugin-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshd-plugin-search { flex: 1 1 220px; min-width: 160px; height: 31px; box-sizing: border-box; padding: 0 9px; border: 1px solid rgba(128,128,128,0.28); border-radius: 5px; color: inherit; background: rgba(255,255,255,0.06); font-size: 12px; }
.dshd-plugin-action { white-space: nowrap; }
.dshd-plugin-section { display: flex; flex-direction: column; gap: 7px; }
.dshd-plugin-section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 700; }
.dshd-plugin-section-title span { font-size: 11px; font-weight: 400; opacity: .55; }
.dshd-plugin-list { display: flex; flex-direction: column; gap: 7px; max-height: 300px; overflow: auto; }
.dshd-plugin-card { padding: 10px 0; border-top: 1px solid rgba(128,128,128,0.18); }
.dshd-plugin-card-head { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
.dshd-plugin-card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 12px Consolas, monospace; }
.dshd-plugin-card-version { font: 11px Consolas, monospace; opacity: .55; }
.dshd-plugin-card-description { margin: 5px 0 7px; font-size: 11px; line-height: 1.5; opacity: .72; }
.dshd-plugin-card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshd-plugin-compat { min-width: 0; font-size: 11px; opacity: .6; }
.dshd-plugin-compat.compatible { color: #287a45; opacity: 1; }
.dshd-plugin-compat.declared { color: #9a6500; opacity: 1; }
.dshd-plugin-danger { color: #b42318; border-color: rgba(180,35,24,0.35); }
.dshd-plugin-status { min-height: 18px; font-size: 11px; line-height: 1.5; opacity: .62; white-space: pre-wrap; }
.dshd-plugin-status.error { color: #b42318; opacity: 1; }
.dshd-plugin-card-status { display: none; margin-top: 9px; padding: 8px 10px; border-radius: 4px; font-size: 11px; line-height: 1.5; }
.dshd-plugin-card-status.visible { display: block; }
.dshd-plugin-card-status.working { color: #3154c9; background: rgba(77,107,254,.09); }
.dshd-plugin-card-status.error { color: #b42318; background: rgba(180,35,24,.08); }
.dshd-plugin-card-status.success { color: #287a45; background: rgba(40,122,69,.09); }
.dshd-plugin-card.working { border-color: rgba(77,107,254,.42); }
.dshd-plugin-card button:disabled { cursor: wait; opacity: .62; }
.dshd-plugin-empty { padding: 10px 0; font-size: 11px; line-height: 1.5; opacity: .58; }
.dshd-plugin-restart { align-self: flex-start; }
.dshd-plugin-standalone {
  position: absolute;
  z-index: 3;
  top: 52px;
  right: 0;
  bottom: 0;
  left: 200px;
  overflow: auto;
  box-sizing: border-box;
  gap: 18px !important;
  padding: 18px 24px 28px !important;
  border-bottom: 0 !important;
  background: inherit;
}
.dshd-plugin-standalone[hidden] { display: none !important; }
.dshd-plugin-standalone .dshd-title { font-size: 17px; }
.dshd-plugin-standalone .dshd-plugin-head-copy .dshd-hint { margin-top: 6px; font-size: 12px; }
.dshd-plugin-standalone .dshd-plugin-search { height: 36px; padding: 0 11px; }
.dshd-plugin-standalone .dshd-plugin-action { height: 36px; padding: 0 14px; }
.dshd-plugin-standalone > .dshd-plugin-status {
  min-height: 0;
  padding: 9px 11px;
  border: 1px solid rgba(77,107,254,.15);
  border-radius: 5px;
  color: inherit;
  background: rgba(77,107,254,.06);
  opacity: .78;
}
.dshd-plugin-standalone > .dshd-plugin-status.error {
  border-color: rgba(180,35,24,.18);
  background: rgba(180,35,24,.07);
}
.dshd-plugin-standalone .dshd-plugin-section { gap: 10px; }
.dshd-plugin-standalone .dshd-plugin-section-title { font-size: 13px; }
.dshd-plugin-standalone .dshd-plugin-list { max-height: none; overflow: visible; gap: 9px; }
.dshd-plugin-standalone .dshd-plugin-card {
  padding: 12px 14px;
  border: 1px solid rgba(128,128,128,0.2);
  border-radius: 6px;
  background: rgba(128,128,128,0.035);
}
.dshd-plugin-standalone .dshd-plugin-card-name { font-size: 13px; }
.dshd-plugin-standalone .dshd-plugin-card-description {
  display: -webkit-box;
  margin: 7px 0 10px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.dshd-diagnostics-body { min-width: 0; overflow: auto; padding: 18px 24px 30px; background: #fff; }
.dshd-diagnostics-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.dshd-diagnostics-summary { margin-bottom: 14px; padding: 11px 13px; border: 1px solid #dfe3e9; border-radius: 6px; color: #4e5665; background: #f8f9fb; font-size: 12px; line-height: 1.55; }
.dshd-diagnostics-list { display: flex; flex-direction: column; gap: 8px; }
.dshd-diagnostic-card { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 12px 13px; border: 1px solid #e2e5eb; border-radius: 6px; }
.dshd-diagnostic-dot { width: 9px; height: 9px; border-radius: 50%; background: #8b93a3; }
.dshd-diagnostic-card.ok .dshd-diagnostic-dot { background: #2e9b56; }
.dshd-diagnostic-card.warn .dshd-diagnostic-dot { background: #d08a16; }
.dshd-diagnostic-card.error .dshd-diagnostic-dot { background: #cf3f35; }
.dshd-diagnostic-copy { min-width: 0; }
.dshd-diagnostic-copy strong { display: block; margin-bottom: 3px; font-size: 12px; }
.dshd-diagnostic-copy span { display: block; overflow: hidden; color: #737b8b; font-size: 11px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.dshd-diagnostics-status { min-height: 18px; margin-top: 12px; color: #687083; font-size: 11px; white-space: pre-wrap; }
.dshd-diagnostics-status.error { color: #b42318; }
#dshd-update-center {
  position: fixed;
  z-index: 2147483641;
  inset: 0 0 0 auto;
  width: clamp(420px, 42vw, 680px);
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr);
  overflow: hidden;
  color: #181b22;
  background: #fff;
  border-left: 1px solid #dfe3e9;
  box-shadow: -12px 0 32px rgba(29, 36, 53, .12);
}
#dshd-update-center[hidden] { display: none !important; }
.dshd-update-head { display: flex; align-items: center; gap: 10px; padding: 0 14px 0 18px; border-bottom: 1px solid #dfe3e9; }
.dshd-update-head strong { font-size: 15px; }
.dshd-update-head span { flex: 1; color: #6e7686; font-size: 12px; }
.dshd-update-body { min-width: 0; overflow: auto; padding: 20px 24px 30px; background: #fff; }
.dshd-update-status { padding: 14px; border: 1px solid #dfe3e9; border-radius: 7px; background: #f8f9fb; }
.dshd-update-status strong { display: block; font-size: 16px; }
.dshd-update-status p { margin: 7px 0 0; color: #687083; font-size: 12px; line-height: 1.55; white-space: pre-wrap; }
.dshd-update-status.error { color: #a92b24; border-color: #f0c7c4; background: #fff6f5; }
.dshd-update-status.available, .dshd-update-status.ready { border-color: #b9c7ff; background: #f5f7ff; }
.dshd-update-progress { height: 7px; margin-top: 14px; overflow: hidden; border-radius: 4px; background: #e7eaf0; }
.dshd-update-progress > span { display: block; height: 100%; border-radius: inherit; background: #4d6bfe; transition: width .2s ease; }
.dshd-update-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.dshd-update-section { margin-top: 22px; }
.dshd-update-section h3 { margin: 0 0 9px; font-size: 12px; }
.dshd-update-component { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid #edf0f4; color: #687083; font: 12px Consolas, monospace; }
.dshd-update-component strong { color: #303746; font-weight: 600; }
.dshd-update-notes { margin-top: 14px; padding: 12px; border: 1px solid #edf0f4; border-radius: 6px; color: #4e5665; font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
.dshd-update-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; color: #4e5665; font-size: 12px; }
.dshd-update-field select { min-width: 150px; padding: 5px 7px; border: 1px solid #dfe3e9; border-radius: 5px; background: #fff; color: inherit; }
.dshd-update-meta { margin-top: 14px; color: #8a92a1; font-size: 11px; }
`;

const WALLPAPER_CSS = `
#${WALLPAPER_LAYER_ID} {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}
#${WALLPAPER_INNER_ID} {
  position: absolute;
  left: -${WALLPAPER_BLEED}px;
  top: -${WALLPAPER_BLEED}px;
  width: calc(100% + ${WALLPAPER_BLEED * 2}px);
  height: calc(100% + ${WALLPAPER_BLEED * 2}px);
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  filter: blur(var(--dsh-wallpaper-blur, 0px));
}
html[${WALLPAPER_ATTR}],
html[${WALLPAPER_ATTR}] body,
html[${WALLPAPER_ATTR}] #root {
  background: transparent !important;
}
html[${WALLPAPER_ATTR}] #root {
  position: relative;
  z-index: 1;
}
`;

function injectControlsCss() {
  if (document.getElementById('dsh-desktop-controls-css')) return;
  const s = document.createElement('style');
  s.id = 'dsh-desktop-controls-css';
  s.textContent = CONTROLS_CSS + WALLPAPER_CSS;
  (document.head || document.documentElement).appendChild(s);
}

// ---------- state ----------

let state = { ...DEFAULTS };
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ipcRenderer.invoke('appearance:save', state), 250);
}

function update(patch) {
  state = { ...state, ...patch };
  applyTheme(state);
  persist();
}

// ---------- injected settings row ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function field(labelText, control, hintText) {
  const f = el('div', 'dshd-field');
  f.appendChild(el('div', 'dshd-label', labelText));
  f.appendChild(control);
  if (hintText) f.appendChild(el('div', 'dshd-hint', hintText));
  return f;
}

function buildRow() {
  const row = el('div', '');
  row.id = ROW_ID;
  row.setAttribute('data-slot', 'settings.general.item');
  row.appendChild(el('div', 'dshd-title', '桌面外观'));

  // --- background image ---
  const fileInput = el('input', '');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  const pickBtn = el('button', 'dshd-btn', '选择背景图片');
  const clearBtn = el('button', 'dshd-btn', '清除背景');
  const bgRow = el('div', 'dshd-row');
  bgRow.appendChild(pickBtn);
  bgRow.appendChild(clearBtn);
  bgRow.appendChild(fileInput);
  const bgLabel = el('div', 'dshd-hint', state.background ? '已设置背景' : '未设置');
  const bgField = field('背景图片', bgRow);
  bgField.appendChild(bgLabel);

  pickBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', () => {
    update({ background: '' });
    bgLabel.textContent = '未设置';
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      update({ background: String(reader.result) });
      bgLabel.textContent = '已设置背景';
    };
    reader.readAsDataURL(f);
  });

  // --- blur / dim ---
  const blur = el('input', '');
  blur.type = 'range'; blur.min = '0'; blur.max = '20'; blur.step = '1'; blur.value = String(state.backgroundBlur || 0);
  blur.addEventListener('input', () => update({ backgroundBlur: Number(blur.value) }));

  const dim = el('input', '');
  dim.type = 'range'; dim.min = '0'; dim.max = '1'; dim.step = '0.05'; dim.value = String(state.backgroundDim || 0);
  dim.addEventListener('input', () => update({ backgroundDim: Number(dim.value) }));

  // --- glass opacity (surface transparency) ---
  const opacity = el('input', '');
  opacity.type = 'range'; opacity.min = '0.1'; opacity.max = '0.95'; opacity.step = '0.05';
  opacity.value = String(state.opacity === undefined ? 0.7 : state.opacity);
  opacity.addEventListener('input', () => update({ opacity: Number(opacity.value) }));

  // --- font ---
  const fontFamily = el('input', '');
  fontFamily.type = 'text'; fontFamily.placeholder = '例如 Microsoft YaHei'; fontFamily.value = state.fontFamily || '';
  fontFamily.addEventListener('input', () => update({ fontFamily: fontFamily.value.trim() }));

  const fontSize = el('select', '');
  const sizeOpts = [['', '默认'], ['13px', '小'], ['14px', '中'], ['16px', '大'], ['18px', '特大']];
  for (const [v, t] of sizeOpts) {
    const o = el('option', '', t);
    o.value = v;
    if (v === state.fontSize) o.selected = true;
    fontSize.appendChild(o);
  }
  fontSize.addEventListener('change', () => update({ fontSize: fontSize.value }));

  // --- density ---
  const density = el('select', '');
  const denOpts = [['', '默认'], ['compact', '紧凑'], ['cozy', '宽松']];
  for (const [v, t] of denOpts) {
    const o = el('option', '', t);
    o.value = v;
    if (v === state.density) o.selected = true;
    density.appendChild(o);
  }
  density.addEventListener('change', () => update({ density: density.value }));

  // --- accent ---
  const accent = el('input', '');
  accent.type = 'color'; accent.value = state.accent || '#4176e6';
  accent.addEventListener('input', () => update({ accent: accent.value }));
  const resetAccent = el('button', 'dshd-btn', '恢复默认');
  resetAccent.addEventListener('click', () => { accent.value = '#4176e6'; update({ accent: '' }); });
  const accentRow = el('div', 'dshd-row');
  accentRow.appendChild(accent);
  accentRow.appendChild(resetAccent);

  // --- custom css ---
  const cssArea = el('textarea', 'dshd-textarea');
  cssArea.placeholder = '/* 在这里写任意自定义样式 */';
  cssArea.value = state.customCss || '';
  cssArea.addEventListener('input', () => update({ customCss: cssArea.value }));

  row.appendChild(bgField);
  row.appendChild(field('背景模糊（像素）', blur));
  row.appendChild(field('背景变暗（0=不变）', dim));
  row.appendChild(field('界面透明度（越低越透）', opacity, '默认 0.7；调低更透、调高文字更稳'));
  row.appendChild(field('界面字体', fontFamily));
  row.appendChild(field('字号', fontSize));
  row.appendChild(field('布局密度', density));
  row.appendChild(field('强调色', accentRow));
  row.appendChild(field('自定义 CSS', cssArea, '改字体、背景、配色等；保存后实时生效'));

  return row;
}

// ---------- plugin management in Settings -> General ----------

const PLUGIN_ROW_ID = 'dsh-desktop-plugin-row';

function buildPluginSettingsRow() {
  const row = el('div', '');
  row.id = PLUGIN_ROW_ID;
  row.setAttribute('data-slot', 'settings.general.item');
  row.setAttribute('data-dsh-plugin-settings', '');

  const head = el('div', 'dshd-plugin-head');
  const copy = el('div', 'dshd-plugin-head-copy');
  copy.appendChild(el('div', 'dshd-title', '搜索与管理'));
  copy.appendChild(el('div', 'dshd-hint', '目录首次联网读取后会缓存 6 小时，本地搜索无需重复下载。安装前会备份 web profile，插件变更后需要重启桌面端。'));
  head.appendChild(copy);
  row.appendChild(head);

  const status = el('div', 'dshd-plugin-status', '正在读取已安装插件…');
  row.appendChild(status);

  const searchToolbar = el('div', 'dshd-plugin-toolbar');
  const search = el('input', 'dshd-plugin-search');
  search.type = 'search';
  search.placeholder = '搜索插件名称、分类或关键词';
  search.setAttribute('aria-label', '搜索插件仓库');
  const searchButton = el('button', 'dshd-btn dshd-plugin-action', '搜索插件');
  searchToolbar.appendChild(search);
  searchToolbar.appendChild(searchButton);
  row.appendChild(searchToolbar);

  const installedSection = el('section', 'dshd-plugin-section');
  const installedTitle = el('div', 'dshd-plugin-section-title');
  installedTitle.appendChild(el('strong', '', '已安装'));
  const installedCount = el('span', '', '读取中');
  installedTitle.appendChild(installedCount);
  const installedList = el('div', 'dshd-plugin-list');
  installedSection.appendChild(installedTitle);
  installedSection.appendChild(installedList);
  row.appendChild(installedSection);

  const marketplaceSection = el('section', 'dshd-plugin-section');
  const marketplaceTitle = el('div', 'dshd-plugin-section-title');
  marketplaceTitle.appendChild(el('strong', '', '插件目录'));
  marketplaceTitle.appendChild(el('span', '', '来自 awesome-dsh-plugin curated registry'));
  const marketplaceList = el('div', 'dshd-plugin-list');
  marketplaceSection.appendChild(marketplaceTitle);
  marketplaceSection.appendChild(marketplaceList);
  row.appendChild(marketplaceSection);

  const restartArea = el('div', 'dshd-row');
  row.appendChild(restartArea);
  let installedByName = new Map();

  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  const setCardStatus = (card, statusEl, kind, message) => {
    card.classList.toggle('working', kind === 'working');
    statusEl.className = `dshd-plugin-card-status visible ${kind}`;
    statusEl.textContent = message;
  };

  const showRestart = () => {
    if (restartArea.querySelector('button')) return;
    const restart = el('button', 'dshd-btn dshd-plugin-restart', '重启桌面端');
    restart.title = '插件安装、更新、启停或卸载完成后重新加载 Harness 插件树';
    restart.addEventListener('click', () => ipcRenderer.invoke('desktop:restart'));
    restartArea.appendChild(restart);
  };

  const compatibilityLabel = (compatibility, activeBundle) => {
    const value = compatibility || { status: 'unknown' };
    const text = value.status === 'compatible'
      ? '兼容声明匹配'
      : value.status === 'declared'
        ? `待核实：${value.declared}`
        : '兼容性待核实';
    return {
      className: `dshd-plugin-compat ${value.status}`,
      text: activeBundle === false ? `${text} · 已停用` : text
    };
  };

  const renderEmpty = (container, message) => {
    container.replaceChildren(el('div', 'dshd-plugin-empty', message));
  };

  const renderInstalled = (items) => {
    installedList.replaceChildren();
    installedCount.textContent = `${items.length} 个`;
    if (!items.length) {
      renderEmpty(installedList, '当前没有第三方插件。可以从下方 curated 目录开始浏览。');
      return;
    }
    for (const item of items) {
      const card = el('article', 'dshd-plugin-card');
      const header = el('div', 'dshd-plugin-card-head');
      header.appendChild(el('strong', 'dshd-plugin-card-name', item.name));
      if (item.version) header.appendChild(el('span', 'dshd-plugin-card-version', item.version));
      card.appendChild(header);
      if (item.description) card.appendChild(el('div', 'dshd-plugin-card-description', item.description));
      const foot = el('div', 'dshd-plugin-card-foot');
      const compatibility = compatibilityLabel(item.compatibility, item.activeBundle);
      foot.appendChild(el('span', compatibility.className, compatibility.text));
      const toggle = el('button', 'dshd-btn', item.activeBundle ? '停用' : '启用');
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        setStatus(`正在${item.activeBundle ? '停用' : '启用'} ${item.name}…`);
        setCardStatus(card, cardStatus, 'working', '正在备份并修改 web profile bundle 列表…');
        const response = await ipcRenderer.invoke('plugins:toggle', item.name, !item.activeBundle);
        if (!response || !response.ok) {
          setStatus('插件状态修改失败。', true);
          setCardStatus(card, cardStatus, 'error', (response && response.message) || '操作失败');
          toggle.disabled = false;
          return;
        }
        setStatus(`已${item.activeBundle ? '停用' : '启用'} ${item.name}，重启后生效。`);
        setCardStatus(card, cardStatus, 'success', '配置已保存，重启桌面端后生效。');
        showRestart();
        await loadInstalled(true);
      });
      foot.appendChild(toggle);
      const update = el('button', 'dshd-btn', '检查更新');
      update.addEventListener('click', async () => {
        update.disabled = true;
        update.textContent = '检查中…';
        setStatus(`正在检查并更新 ${item.name}…`);
        setCardStatus(card, cardStatus, 'working', item.sourceKind === 'github' ? '正在检查 GitHub 最新 commit 并重新校验成品…' : '正在从 npm 检查最新成品版本…');
        const response = await ipcRenderer.invoke('plugins:update', item.name);
        if (!response || !response.ok) {
          setStatus('插件更新未完成。', true);
          setCardStatus(card, cardStatus, 'error', (response && response.message) || '更新失败');
          update.disabled = false;
          update.textContent = '重试更新';
          return;
        }
        update.textContent = response.updated ? '已更新' : '已是最新';
        setStatus(`${item.name} 更新检查完成。${response.updated ? '发现并安装了新版本，' : '当前未发现版本变化，'}重启后完成验证。`);
        setCardStatus(card, cardStatus, 'success', response.updated
          ? `已从 ${response.previousVersion || response.previousCommit || '当前版本'} 更新到 ${response.version || response.commit || '最新来源'}。`
          : '已重新校验并安装当前最新来源。');
        showRestart();
        await loadInstalled(true);
      });
      foot.appendChild(update);
      const remove = el('button', 'dshd-btn dshd-plugin-danger', '卸载');
      const cardStatus = el('div', 'dshd-plugin-card-status');
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        remove.textContent = '卸载中…';
        setStatus(`正在卸载 ${item.name}，请勿关闭桌面端。`);
        setCardStatus(card, cardStatus, 'working', '正在卸载并备份 web profile…');
        const response = await ipcRenderer.invoke('plugins:remove', item.name);
        if (!response || !response.ok) {
          const message = (response && response.message) || '卸载失败，请稍后重试。';
          setStatus('卸载未完成，请查看对应插件的提示。', true);
          setCardStatus(card, cardStatus, 'error', message);
          remove.disabled = false;
          remove.textContent = '重试卸载';
          return;
        }
        setStatus(`已卸载 ${item.name}。需要重启桌面端。`);
        setCardStatus(card, cardStatus, 'success', '卸载完成。重启桌面端后会从 Harness 插件树移除。');
        showRestart();
        await loadInstalled(true);
      });
      foot.appendChild(remove);
      card.appendChild(foot);
      card.appendChild(cardStatus);
      installedList.appendChild(card);
    }
  };

  const renderMarketplace = (items) => {
    marketplaceList.replaceChildren();
    if (!items.length) {
      renderEmpty(marketplaceList, '没有找到匹配的插件。可以换一个关键词，或清空搜索查看完整目录。');
      return;
    }
    for (const item of items) {
      const card = el('article', 'dshd-plugin-card');
      const header = el('div', 'dshd-plugin-card-head');
      header.appendChild(el('strong', 'dshd-plugin-card-name', item.name));
      if (item.version) header.appendChild(el('span', 'dshd-plugin-card-version', item.version));
      card.appendChild(header);
      card.appendChild(el('div', 'dshd-plugin-card-description', item.description || item.id));
      const meta = el('div', 'dshd-plugin-card-meta');
      if (item.category) meta.appendChild(el('span', '', item.category));
      if (item.stars) meta.appendChild(el('span', '', `★ ${item.stars}`));
      if (item.downloads) meta.appendChild(el('span', '', `下载 ${item.downloads}`));
      if (item.source) meta.appendChild(el('span', 'dsh-plugin-card-source', item.source === 'npm' ? 'npm 成品包' : 'GitHub 成品校验'));
      if (meta.childNodes.length) card.appendChild(meta);
      if (item.repositoryUrl) {
        const link = el('a', 'dsh-plugin-card-link', '查看仓库');
        link.href = item.repositoryUrl;
        link.target = '_blank';
        link.rel = 'noreferrer';
        card.appendChild(link);
      }
      const foot = el('div', 'dshd-plugin-card-foot');
      foot.appendChild(el('span', 'dshd-plugin-compat compatible', item.curated ? 'curated 来源' : '来源待核实'));
      const existing = installedByName.get(item.installedPackageName) || installedByName.get(item.installSpec) || installedByName.get(item.name);
      const install = el('button', 'dshd-btn', existing ? '检查更新' : (item.source === 'github' ? '校验并安装' : '安装'));
      const cardStatus = el('div', 'dshd-plugin-card-status');
      install.addEventListener('click', async () => {
        install.disabled = true;
        install.textContent = existing ? '检查中…' : '安装中…';
        setStatus(`正在${existing ? '检查并更新' : '安装'} ${item.name}，请勿关闭桌面端。`);
        setCardStatus(card, cardStatus, 'working', item.source === 'github'
          ? '正在锁定 GitHub commit，并检查 bundle、入口文件和安装脚本…'
          : '正在从 npm 获取成品包并备份 web profile…');
        const response = existing
          ? await ipcRenderer.invoke('plugins:update', existing.name)
          : await ipcRenderer.invoke('plugins:install', {
            name: item.name,
            installSpec: item.installSpec,
            source: item.source,
            repositoryUrl: item.repositoryUrl
          });
        if (!response || !response.ok) {
          const message = (response && response.message) || '安装失败，请稍后重试。';
          setStatus('安装未完成，请查看对应插件的提示。', true);
          setCardStatus(card, cardStatus, 'error', message);
          install.disabled = false;
          install.textContent = existing ? '重试更新' : (item.source === 'github' ? '重新校验' : '重试安装');
          return;
        }
        install.textContent = existing ? (response.updated ? '已更新' : '已是最新') : '已安装';
        setStatus(`${existing ? '更新检查完成' : '已安装'} ${item.name}。需要重启桌面端。`);
        const sourceDetail = response.sourceKind === 'github-verified' && response.commit
          ? `已锁定并安装 commit ${response.commit.slice(0, 12)}。`
          : '成品包安装完成。';
        setCardStatus(card, cardStatus, 'success', `${sourceDetail} 重启桌面端后会加载这个插件。`);
        showRestart();
        await loadInstalled(true);
      });
      foot.appendChild(install);
      card.appendChild(foot);
      card.appendChild(cardStatus);
      marketplaceList.appendChild(card);
    }
  };

  async function loadInstalled(preserveStatus = false) {
    const response = await ipcRenderer.invoke('plugins:list');
    if (!response || !response.ok) {
      installedCount.textContent = '读取失败';
      renderEmpty(installedList, '无法读取已安装插件。');
      setStatus((response && response.message) || '无法读取已安装插件', true);
      return;
    }
    renderInstalled(response.items || []);
    installedByName = new Map((response.items || []).flatMap((item) => [
      [item.name, item],
      [item.requested, item]
    ].filter(([name]) => Boolean(name))));
    if (!preserveStatus) setStatus('插件目录已读取。安装和卸载完成后请重启桌面端。');
    return response.items || [];
  }

  async function searchMarketplace() {
    searchButton.disabled = true;
    setStatus('正在读取插件目录；已有缓存时会立即完成…');
    renderEmpty(marketplaceList, '正在加载目录并搜索…');
    const response = await ipcRenderer.invoke('plugins:search', search.value);
    searchButton.disabled = false;
    if (!response || !response.ok) {
      renderEmpty(marketplaceList, '仓库索引读取失败。');
      setStatus((response && response.message) || '仓库索引读取失败', true);
      return;
    }
    renderMarketplace(response.items || []);
    const catalog = response.catalog || {};
    const sourceLabel = catalog.source === 'network'
      ? '已更新网络目录'
      : catalog.source === 'stale'
        ? '已使用本地旧缓存，正在后台更新'
        : '已使用本地缓存';
    setStatus(`搜索完成，找到 ${(response.items || []).length} 个插件。${sourceLabel}。`);
  }

  searchButton.addEventListener('click', searchMarketplace);
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchMarketplace(); });
  loadInstalled().catch((error) => setStatus(error && error.message ? error.message : '无法读取已安装插件', true));

  return row;
}

// ---------- injection ----------

function injectRow(rowId, builder) {
  if (document.getElementById(rowId)) return;
  const anchors = document.querySelectorAll('[data-slot="settings.general.item"]');
  if (anchors.length === 0) return;
  const anchor = anchors[anchors.length - 1];
  const section = anchor.parentElement;
  if (!section) return;
  section.appendChild(builder());
}

function tryInject() {
  try {
    injectRow(ROW_ID, buildRow);
  } catch {
    /* ignore transient DOM races */
  }
}

// ---------- boot ----------

function boot() {
  injectControlsCss();

  const root = document.documentElement || document.body || document;
  if (root) {
    const mo = new MutationObserver(tryInject);
    mo.observe(root, { childList: true, subtree: true });
  }
  // Safety net: re-inject if React reconciles the section and drops our row.
  setInterval(tryInject, 800);
  tryInject();
}

ipcRenderer.invoke('appearance:get').then((a) => {
  state = { ...DEFAULTS, ...(a || {}) };
  applyTheme(state);
});
ipcRenderer.on('appearance:update', (_e, a) => {
  state = { ...DEFAULTS, ...(a || {}) };
  applyTheme(state);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ---------- split workbench: embedded browser ----------

const TOOLS_LAUNCHER_ID = 'dshd-tools-launcher';
const TOOLS_SHELL_ID = 'dshd-tools-shell';
const TOOLS_RATIO = 0.44;
const TOOLS_MIN_WIDTH = 420;
const TOOLS_MAX_WIDTH = 1100;
const TOOLS_KEEP_CHAT_WIDTH = 320;
const TOOLS_RESIZE_RAIL_WIDTH = 10;
const DEFAULT_BROWSER_URL = '';

const TOOLS_CSS = `
#${TOOLS_LAUNCHER_ID} {
  position: fixed;
  z-index: 2147483640;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  padding: 3px;
  border: 1px solid rgba(215, 219, 227, .94);
  border-radius: 6px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 4px 14px rgba(29, 36, 53, .18);
  cursor: grab;
  touch-action: none;
}
#${TOOLS_LAUNCHER_ID}.dragging { cursor: grabbing; opacity: .9; }
#${TOOLS_LAUNCHER_ID} { flex-direction: column; gap: 2px; }
#${TOOLS_LAUNCHER_ID} .dshd-tools-drag-handle {
  width: 34px;
  height: 13px;
  color: #8992a2;
  cursor: grab;
  font-size: 12px;
  line-height: 11px;
  text-align: center;
  user-select: none;
}
#${TOOLS_LAUNCHER_ID}.dragging .dshd-tools-drag-handle { cursor: grabbing; }
#${TOOLS_LAUNCHER_ID}[hidden], #${TOOLS_SHELL_ID}[hidden] { display: none !important; }
#${TOOLS_LAUNCHER_ID} button,
#${TOOLS_SHELL_ID} button,
#${TOOLS_SHELL_ID} input { font: inherit; letter-spacing: 0; }
#${TOOLS_LAUNCHER_ID} button {
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #4b5363;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
#${TOOLS_LAUNCHER_ID} button:hover { background: #edf0ff; color: #4d6bfe; }
#${TOOLS_SHELL_ID} {
  position: fixed;
  z-index: 2147483641;
  inset: 0 0 0 auto;
  width: 44vw;
  display: grid;
  grid-template-rows: 44px 38px 46px auto auto auto minmax(0, 1fr);
  overflow: hidden;
  color: #181b22;
  background: #fff;
  border-left: 1px solid #dfe3e9;
  box-shadow: -12px 0 32px rgba(29, 36, 53, .12);
}
.dshd-tool-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 11px 0 16px;
  border-bottom: 1px solid #dfe3e9;
}
.dshd-tool-head strong { font-size: 14px; white-space: nowrap; }
.dshd-local-badge { display: none; padding: 2px 6px; border: 1px solid #b8dfc4; border-radius: 3px; color: #277443; background: #edf9f0; font-size: 10px; white-space: nowrap; }
.dshd-local-badge.visible { display: inline-block; }
.dshd-tool-expand { width: 30px; height: 30px; border: 1px solid #dfe3e9; border-radius: 4px; color: #596172; background: #fff; cursor: pointer; font-size: 16px; }
.dshd-tool-expand:hover { color: #4d6bfe; background: #edf0ff; border-color: #bdc6ff; }
.dshd-tool-action { position: relative; width: 30px; height: 30px; padding: 0; border: 1px solid #dfe3e9; border-radius: 4px; color: #596172; background: #fff; cursor: pointer; font-size: 14px; }
.dshd-tool-action:hover { color: #4d6bfe; background: #edf0ff; border-color: #bdc6ff; }
.dshd-tool-action.has-items::after { content: ''; position: absolute; width: 6px; height: 6px; margin: -2px 0 0 -2px; border-radius: 50%; background: #4d6bfe; }
.dshd-browser-resize-rail {
  position: absolute;
  z-index: 2;
  left: 0;
  top: 128px;
  bottom: 0;
  width: 10px;
  cursor: col-resize;
  background: transparent;
}
.dshd-browser-resize-rail::after {
  content: '';
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 4px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background .15s ease;
}
.dshd-browser-resize-rail:hover::after,
.dshd-browser-resize-rail.dragging::after { background: #bdc6ff; }
.dshd-tool-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #6e7686;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshd-tool-switch { display: flex; gap: 3px; margin-left: auto; }
.dshd-tool-switch button {
  height: 30px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 3px;
  color: #596172;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}
.dshd-tool-switch button.active { color: #4d6bfe; background: #edf0ff; border-color: #bdc6ff; font-weight: 700; }
.dshd-tool-close { width: 30px; height: 30px; margin-left: 2px; border: 0; color: #687083; background: transparent; cursor: pointer; font-size: 20px; }
.dshd-browser-state { min-width: 0; }
.dshd-browser-state.loading::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #4d6bfe; box-shadow: 0 0 0 3px #edf0ff; vertical-align: 1px; }
.dshd-browser-state.error { color: #b42318; }
.dshd-browser-progress { position: absolute; z-index: 3; top: 126px; left: 10px; right: 0; height: 2px; overflow: hidden; pointer-events: none; }
.dshd-browser-progress::after { content: ''; display: block; width: 36%; height: 100%; background: #4d6bfe; transform: translateX(-110%); }
.dshd-browser-progress.loading::after { animation: dshd-progress 1.05s ease-in-out infinite; }
@keyframes dshd-progress { to { transform: translateX(390%); } }
.dshd-browser-tabs { display: grid; grid-template-columns: minmax(0, 1fr) 34px; align-items: stretch; min-width: 0; padding-left: 10px; background: #f5f6f8; border-bottom: 1px solid #dfe3e9; }
.dshd-browser-tab-list { display: flex; align-items: end; gap: 2px; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.dshd-browser-tab { display: grid; grid-template-columns: 14px minmax(44px, 1fr) 20px; align-items: center; gap: 5px; width: 170px; min-width: 96px; max-width: 190px; height: 32px; margin-top: 5px; padding: 0 4px 0 8px; border: 1px solid transparent; border-bottom: 0; border-radius: 5px 5px 0 0; color: #606879; background: transparent; cursor: pointer; }
.dshd-browser-tab.active { color: #282d37; background: #fff; border-color: #dfe3e9; }
.dshd-browser-tab.loading .dshd-tab-icon { animation: dshd-spin .9s linear infinite; }
@keyframes dshd-spin { to { transform: rotate(360deg); } }
.dshd-tab-icon { width: 14px; height: 14px; object-fit: contain; }
.dshd-tab-title { overflow: hidden; font-size: 11px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.dshd-tab-close { width: 20px !important; min-width: 20px !important; height: 20px !important; padding: 0 !important; border: 0 !important; border-radius: 3px !important; background: transparent !important; font-size: 15px !important; line-height: 1 !important; }
.dshd-tab-close:hover { color: #b42318 !important; background: #fceeed !important; }
.dshd-tab-new { align-self: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px; color: #596172; background: transparent; cursor: pointer; font-size: 18px; }
.dshd-tab-new:hover { color: #4d6bfe; background: #e8ebf9; }
.dshd-browser-chrome {
  display: grid;
  grid-template-columns: 32px 32px 32px minmax(90px, 1fr) 32px 32px 32px 32px;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  background: #fafbfc;
  border-bottom: 1px solid #dfe3e9;
}
.dshd-browser-chrome button { height: 32px; min-width: 32px; padding: 0; border: 1px solid #dfe3e9; border-radius: 4px; color: #4e5665; background: #fff; cursor: pointer; font-size: 16px; }
.dshd-browser-chrome button:hover:not(:disabled) { color: #4d6bfe; border-color: #bdc6ff; background: #f3f5ff; }
.dshd-browser-chrome button:disabled { opacity: .38; cursor: default; }
.dshd-browser-url { min-width: 0; height: 32px; padding: 0 10px; border: 1px solid #d7dbe3; border-radius: 4px; color: #404755; background: #fff; font-size: 12px; }
.dshd-browser-find { display: none; grid-template-columns: minmax(100px, 1fr) auto 30px 30px 30px; gap: 5px; align-items: center; padding: 4px 10px 4px 16px; background: #fafbfc; border-bottom: 1px solid #dfe3e9; }
#${TOOLS_SHELL_ID}.find-open .dshd-browser-find { display: grid; }
.dshd-browser-find input { min-width: 0; height: 30px; padding: 0 8px; border: 1px solid #d7dbe3; border-radius: 4px; color: #404755; background: #fff; font-size: 12px; }
.dshd-browser-find span { min-width: 46px; color: #737b8b; font-size: 11px; text-align: center; }
.dshd-browser-find button { width: 30px; height: 30px; padding: 0; border: 1px solid #dfe3e9; border-radius: 4px; color: #596172; background: #fff; cursor: pointer; }
.dshd-browser-error { display: none; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 42px; padding: 6px 12px 6px 16px; color: #8f2019; background: #fff4f2; border-bottom: 1px solid #f0c8c4; font-size: 11px; }
.dshd-browser-error.visible { display: grid; }
.dshd-browser-error span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshd-browser-error button { height: 28px; padding: 0 10px; border: 1px solid #d89c96; border-radius: 4px; color: #8f2019; background: #fff; cursor: pointer; }
.dshd-downloads { display: none; max-height: 190px; overflow: auto; padding: 8px 10px 10px 16px; background: #fafbfc; border-bottom: 1px solid #dfe3e9; }
.dshd-downloads.visible { display: block; }
.dshd-download-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 12px; font-weight: 700; }
.dshd-download-head button { border: 0; color: #596172; background: transparent; cursor: pointer; font-size: 11px; }
.dshd-download-empty { padding: 12px 0; color: #7c8493; font-size: 11px; text-align: center; }
.dshd-download-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 8px; padding: 7px 0; border-top: 1px solid #e7e9ee; }
.dshd-download-name { overflow: hidden; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.dshd-download-meta { color: #737b8b; font-size: 10px; }
.dshd-download-actions { grid-row: 1 / span 2; grid-column: 2; display: flex; align-items: center; gap: 4px; }
.dshd-download-actions button { height: 26px; padding: 0 7px; border: 1px solid #dfe3e9; border-radius: 3px; color: #596172; background: #fff; cursor: pointer; font-size: 10px; }
.dshd-download-track { grid-column: 1 / -1; height: 3px; overflow: hidden; border-radius: 2px; background: #e6e8ed; }
.dshd-download-track span { display: block; height: 100%; background: #4d6bfe; }
.dshd-browser-library { display: none; max-height: 260px; overflow: auto; padding: 9px 10px 11px 16px; background: #fafbfc; border-bottom: 1px solid #dfe3e9; }
.dshd-browser-library.visible { display: block; }
.dshd-library-section + .dshd-library-section { margin-top: 12px; }
.dshd-library-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; font-size: 12px; font-weight: 700; }
.dshd-library-head button { border: 0; color: #596172; background: transparent; cursor: pointer; font-size: 10px; }
.dshd-library-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 8px; padding: 7px 0; border-top: 1px solid #e7e9ee; }
.dshd-library-link { min-width: 0; border: 0; padding: 0; color: #333a48; background: transparent; cursor: pointer; text-align: left; }
.dshd-library-link strong, .dshd-library-link small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshd-library-link strong { font-size: 11px; }
.dshd-library-link small { margin-top: 3px; color: #7b8392; font-size: 9px; }
.dshd-library-remove { grid-column: 2; grid-row: 1; width: 24px; height: 24px; border: 0; border-radius: 3px; color: #7a8291; background: transparent; cursor: pointer; }
.dshd-library-remove:hover { color: #b42318; background: #fceeed; }
.dshd-editor-pane {
  position: absolute;
  z-index: 4;
  inset: 44px 0 0 10px;
  display: grid;
  grid-template-rows: 38px 42px minmax(0, 1fr) 28px;
  min-width: 0;
  background: #fff;
}
.dshd-editor-pane[hidden] { display: none !important; }
.dshd-editor-tabs { display: flex; min-width: 0; overflow-x: auto; overflow-y: hidden; padding-left: 6px; background: #f5f6f8; border-bottom: 1px solid #dfe3e9; scrollbar-width: thin; }
.dshd-editor-tab { display: grid; grid-template-columns: minmax(54px, 1fr) 20px; align-items: center; gap: 4px; width: 164px; min-width: 100px; max-width: 190px; height: 33px; margin-top: 5px; padding: 0 4px 0 9px; border: 1px solid transparent; border-bottom: 0; border-radius: 5px 5px 0 0; color: #606879; background: transparent; cursor: pointer; }
.dshd-editor-tab.active { color: #282d37; background: #fff; border-color: #dfe3e9; }
.dshd-editor-tab-name { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.dshd-editor-tab.dirty .dshd-editor-tab-name::after { content: ' ●'; color: #4d6bfe; }
.dshd-editor-tab-close { width: 20px !important; height: 20px !important; padding: 0 !important; border: 0 !important; border-radius: 3px !important; color: #6c7483; background: transparent !important; cursor: pointer; font-size: 15px !important; }
.dshd-editor-tab-close:hover { color: #b42318; background: #fceeed !important; }
.dshd-editor-toolbar { display: grid; grid-template-columns: auto auto auto auto minmax(100px, 1fr) auto auto auto; gap: 6px; align-items: center; padding: 5px 10px; background: #fafbfc; border-bottom: 1px solid #dfe3e9; }
.dshd-editor-toolbar button { height: 30px; padding: 0 9px; border: 1px solid #dfe3e9; border-radius: 4px; color: #4e5665; background: #fff; cursor: pointer; font-size: 11px; }
.dshd-editor-toolbar button:hover:not(:disabled) { color: #4d6bfe; border-color: #bdc6ff; background: #f3f5ff; }
.dshd-editor-toolbar button:disabled { opacity: .42; cursor: default; }
.dshd-editor-find { min-width: 0; height: 30px; padding: 0 9px; border: 1px solid #d7dbe3; border-radius: 4px; color: #404755; background: #fff; font-size: 11px; }
.dshd-editor-canvas { display: grid; grid-template-columns: auto minmax(0, 1fr); min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
.dshd-editor-canvas.wrap-mode { grid-template-columns: minmax(0, 1fr); }
.dshd-editor-canvas.wrap-mode .dshd-editor-lines,
.dshd-editor-canvas.no-gutter .dshd-editor-lines { display: none; }
.dshd-editor-lines { min-width: 44px; margin: 0; overflow: hidden; padding: 14px 9px 40px 7px; color: #a0a6b1; background: #f7f8fa; border-right: 1px solid #e5e7eb; font: 12px/1.6 Consolas, 'Cascadia Mono', monospace; text-align: right; user-select: none; }
.dshd-editor-text { width: 100%; height: 100%; min-width: 0; min-height: 0; resize: none; overflow: auto; padding: 14px 16px 40px; border: 0; outline: 0; color: #232833; background: #fff; font: 12px/1.6 Consolas, 'Cascadia Mono', monospace; tab-size: 2; white-space: pre; }
.dshd-editor-text.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.dshd-editor-empty { grid-column: 1 / -1; display: grid; place-items: center; color: #7c8493; font-size: 12px; }
.dshd-editor-lines[hidden], .dshd-editor-text[hidden], .dshd-editor-empty[hidden] { display: none !important; }
.dshd-editor-status { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 0 12px; color: #687083; background: #fafbfc; border-top: 1px solid #e3e6eb; font-size: 10px; }
.dshd-editor-status span:first-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshd-editor-status.error { color: #a52a22; background: #fff4f2; }
#${TOOLS_SHELL_ID}.editor-mode .dshd-local-badge,
#${TOOLS_SHELL_ID}.editor-mode .dshd-browser-only { display: none !important; }
a[data-dsh-browser-link] { cursor: pointer; text-decoration: underline; text-decoration-color: currentColor; text-underline-offset: 3px; }
`;

let toolsShell = null;
let toolsLauncher = null;
let toolMode = 'closed';
let browserUrl = DEFAULT_BROWSER_URL;
let browserState = { open: false };
let openBrowserPanel = null;
let openPluginCenter = null;
let closePluginCenter = null;
let openDiagnosticsCenter = null;
let closeDiagnosticsCenter = null;
let openUpdateCenter = null;
let closeUpdateCenter = null;
let closeBrowserPanel = null;
let openFileEditor = null;
let browserPanelWidth = 0;
let toolsLauncherPosition = null;

function toolbarPositionLimits() {
  const height = toolsLauncher ? toolsLauncher.offsetHeight : 150;
  return { min: 12, max: Math.max(12, window.innerHeight - height - 12) };
}

function applyToolsLauncherPosition() {
  if (!toolsLauncher) return;
  const limits = toolbarPositionLimits();
  const position = toolsLauncherPosition || { side: 'right', top: Math.round(window.innerHeight * 0.5 - toolsLauncher.offsetHeight * 0.5) };
  const top = Math.max(limits.min, Math.min(limits.max, Number(position.top) || limits.min));
  toolsLauncherPosition = { side: position.side === 'left' ? 'left' : 'right', top };
  toolsLauncher.style.top = `${top}px`;
  toolsLauncher.style.bottom = 'auto';
  toolsLauncher.style.transform = 'none';
  toolsLauncher.style.left = toolsLauncherPosition.side === 'left' ? '12px' : 'auto';
  toolsLauncher.style.right = toolsLauncherPosition.side === 'right' ? '12px' : 'auto';
}

function loadToolsLauncherPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem('dsh-desktop-tools-position') || 'null');
    if (saved && (saved.side === 'left' || saved.side === 'right')) toolsLauncherPosition = saved;
  } catch { /* use the default position */ }
}

function saveToolsLauncherPosition() {
  if (!toolsLauncherPosition) return;
  localStorage.setItem('dsh-desktop-tools-position', JSON.stringify(toolsLauncherPosition));
}

function browserWidthLimits() {
  const max = Math.min(TOOLS_MAX_WIDTH, Math.max(TOOLS_MIN_WIDTH, Math.floor(window.innerWidth * 0.78)));
  const min = Math.min(TOOLS_MIN_WIDTH, Math.max(300, window.innerWidth - TOOLS_KEEP_CHAT_WIDTH));
  return { min, max: Math.max(min, max) };
}

function clampBrowserWidth(value) {
  const limits = browserWidthLimits();
  return Math.round(Math.max(limits.min, Math.min(limits.max, Number(value) || 0)));
}

function bootPluginCenter() {
  if (document.getElementById('dshd-plugin-center')) return;
  const panel = el('aside', '');
  panel.id = 'dshd-plugin-center';
  panel.hidden = true;
  const head = el('header', 'dshd-plugin-center-head');
  head.appendChild(el('strong', '', '插件中心'));
  head.appendChild(el('span', '', 'curated registry · npm 优先'));
  const close = toolButton('×', 'dshd-plugin-center-close', '关闭插件中心');
  head.appendChild(close);
  const row = buildPluginSettingsRow();
  row.removeAttribute('data-slot');
  row.classList.add('dshd-plugin-standalone');
  panel.appendChild(head);
  panel.appendChild(row);
  document.body.appendChild(panel);
  const closePanel = () => {
    panel.hidden = true;
    if (toolsLauncher) toolsLauncher.hidden = false;
  };
  closePluginCenter = closePanel;
  close.addEventListener('click', closePanel);
  openPluginCenter = () => {
    if (closeBrowserPanel) closeBrowserPanel();
    if (closeDiagnosticsCenter) closeDiagnosticsCenter();
    if (closeUpdateCenter) closeUpdateCenter();
    panel.hidden = false;
    if (toolsLauncher) toolsLauncher.hidden = false;
  };
}

function bootDiagnosticsCenter() {
  if (document.getElementById('dshd-diagnostics-center')) return;
  const panel = el('aside', '');
  panel.id = 'dshd-diagnostics-center';
  panel.hidden = true;
  const head = el('header', 'dshd-diagnostics-center-head');
  head.appendChild(el('strong', '', '诊断与修复中心'));
  head.appendChild(el('span', '', '运行环境 · 配置 · 网络'));
  const close = toolButton('×', 'dshd-plugin-center-close', '关闭诊断中心');
  head.appendChild(close);
  const body = el('div', 'dshd-diagnostics-body');
  const toolbar = el('div', 'dshd-diagnostics-toolbar');
  const run = el('button', 'dshd-btn', '重新检查');
  const exportReport = el('button', 'dshd-btn', '导出脱敏报告');
  const backup = el('button', 'dshd-btn', '备份运行配置');
  const clearCache = el('button', 'dshd-btn', '清理插件目录缓存');
  exportReport.disabled = true;
  toolbar.appendChild(run);
  toolbar.appendChild(exportReport);
  toolbar.appendChild(backup);
  toolbar.appendChild(clearCache);
  const summary = el('div', 'dshd-diagnostics-summary', '尚未运行检查。');
  const list = el('div', 'dshd-diagnostics-list');
  const status = el('div', 'dshd-diagnostics-status');
  body.appendChild(toolbar);
  body.appendChild(summary);
  body.appendChild(list);
  body.appendChild(status);
  panel.appendChild(head);
  panel.appendChild(body);
  document.body.appendChild(panel);
  let lastReport = null;

  const setStatus = (message, error = false) => {
    status.textContent = message || '';
    status.classList.toggle('error', error);
  };
  const performRepair = async (action, button) => {
    button.disabled = true;
    setStatus('正在执行操作…');
    const response = await ipcRenderer.invoke('diagnostics:repair', action);
    button.disabled = false;
    if (!response || !response.ok) {
      setStatus((response && response.message) || '操作失败', true);
      return;
    }
    const location = response.destination || response.backup || response.directory || '';
    setStatus(`${response.message || '操作完成'}${location ? `\n${location}` : ''}`);
    await runChecks();
  };
  const render = (report) => {
    lastReport = report;
    exportReport.disabled = !report;
    const counts = report.summary || { ok: 0, warn: 0, error: 0 };
    summary.textContent = `检查完成：${counts.ok} 项正常，${counts.warn} 项提醒，${counts.error} 项错误。报告不会读取或显示 API Key 内容。`;
    list.replaceChildren();
    for (const check of report.checks || []) {
      const card = el('article', `dshd-diagnostic-card ${check.status || 'warn'}`);
      card.appendChild(el('span', 'dshd-diagnostic-dot'));
      const copy = el('div', 'dshd-diagnostic-copy');
      copy.appendChild(el('strong', '', check.label || check.id));
      const detail = el('span', '', check.summary || '');
      detail.title = check.summary || '';
      copy.appendChild(detail);
      card.appendChild(copy);
      if (check.repair) {
        const fix = el('button', 'dshd-btn', '安全修复');
        fix.addEventListener('click', () => performRepair(check.repair, fix));
        card.appendChild(fix);
      } else card.appendChild(el('span', ''));
      list.appendChild(card);
    }
  };
  async function runChecks() {
    run.disabled = true;
    run.textContent = '检查中…';
    setStatus('正在检查本地运行环境和三个公共网络端点…');
    const response = await ipcRenderer.invoke('diagnostics:run');
    run.disabled = false;
    run.textContent = '重新检查';
    if (!response || !response.ok) {
      setStatus((response && response.message) || '诊断失败', true);
      return;
    }
    render(response.report);
    setStatus(`检查时间：${new Date(response.report.generatedAt).toLocaleString()}`);
  }
  run.addEventListener('click', runChecks);
  exportReport.addEventListener('click', async () => {
    if (!lastReport) return;
    const response = await ipcRenderer.invoke('diagnostics:export', lastReport);
    if (!response || !response.ok) {
      if (!(response && response.cancelled)) setStatus((response && response.message) || '导出失败', true);
      return;
    }
    setStatus(`脱敏报告已导出：\n${response.path}`);
  });
  backup.addEventListener('click', () => performRepair('backup-config', backup));
  clearCache.addEventListener('click', () => performRepair('clear-marketplace-cache', clearCache));

  const closePanel = () => {
    panel.hidden = true;
    if (toolsLauncher) toolsLauncher.hidden = false;
  };
  closeDiagnosticsCenter = closePanel;
  close.addEventListener('click', closePanel);
  openDiagnosticsCenter = () => {
    if (closeBrowserPanel) closeBrowserPanel();
    if (closePluginCenter) closePluginCenter();
    if (closeUpdateCenter) closeUpdateCenter();
    panel.hidden = false;
    if (toolsLauncher) toolsLauncher.hidden = false;
    if (!lastReport) runChecks();
  };
}

function bootUpdateCenter() {
  if (document.getElementById('dshd-update-center')) return;
  const panel = el('aside', '');
  panel.id = 'dshd-update-center';
  panel.hidden = true;
  const head = el('header', 'dshd-update-head');
  head.appendChild(el('strong', '', '更新中心'));
  head.appendChild(el('span', '', '桌面应用 · Harness · 运行时'));
  const close = toolButton('×', 'dshd-plugin-center-close', '关闭更新中心');
  head.appendChild(close);
  const body = el('div', 'dshd-update-body');
  const statusCard = el('section', 'dshd-update-status');
  const statusTitle = el('strong', '', '准备检查更新');
  const statusMessage = el('p', '', '更新会先检查，只有你确认后才下载。');
  const progress = el('div', 'dshd-update-progress');
  const progressBar = el('span', '');
  progressBar.style.width = '0%';
  progress.appendChild(progressBar);
  statusCard.appendChild(statusTitle);
  statusCard.appendChild(statusMessage);
  statusCard.appendChild(progress);
  const actions = el('div', 'dshd-update-actions');
  const check = el('button', 'dshd-btn', '检查更新');
  const download = el('button', 'dshd-btn', '下载更新');
  const install = el('button', 'dshd-btn', '重启并安装');
  const skip = el('button', 'dshd-btn', '跳过此版本');
  const unskip = el('button', 'dshd-btn', '取消跳过');
  actions.appendChild(check);
  actions.appendChild(download);
  actions.appendChild(install);
  actions.appendChild(skip);
  actions.appendChild(unskip);
  statusCard.appendChild(actions);
  body.appendChild(statusCard);

  const componentSection = el('section', 'dshd-update-section');
  componentSection.appendChild(el('h3', '', '当前内置组件'));
  const components = el('div', '');
  componentSection.appendChild(components);
  const harnessActions = el('div', 'dshd-update-actions');
  const harnessCheck = el('button', 'dshd-btn', '检查 Harness 上游');
  const harnessStatus = el('div', 'dshd-update-meta', '上游检查只提供维护提示，不会修改本地运行时。');
  harnessActions.appendChild(harnessCheck);
  componentSection.appendChild(harnessActions);
  componentSection.appendChild(harnessStatus);
  body.appendChild(componentSection);

  const preferenceSection = el('section', 'dshd-update-section');
  preferenceSection.appendChild(el('h3', '', '更新偏好'));
  const modeField = el('label', 'dshd-update-field');
  modeField.appendChild(el('span', '', '自动检查'));
  const mode = document.createElement('select');
  mode.innerHTML = '<option value="default">自动检查（每天一次）</option><option value="start">仅启动时检查</option><option value="manual">仅手动检查</option><option value="none">关闭更新检查</option>';
  modeField.appendChild(mode);
  const channelField = el('label', 'dshd-update-field');
  channelField.appendChild(el('span', '', '更新通道'));
  const channel = document.createElement('select');
  channel.innerHTML = '<option value="stable">Stable 稳定版</option><option value="preview">Preview 预览版</option>';
  channelField.appendChild(channel);
  preferenceSection.appendChild(modeField);
  preferenceSection.appendChild(channelField);
  body.appendChild(preferenceSection);
  const notes = el('div', 'dshd-update-notes');
  notes.hidden = true;
  body.appendChild(notes);
  const meta = el('div', 'dshd-update-meta', '应用版本信息读取中…');
  body.appendChild(meta);
  panel.appendChild(head);
  panel.appendChild(body);
  document.body.appendChild(panel);

  let updateState = null;
  const setStatus = (message, error = false) => {
    statusMessage.textContent = message || '';
    statusCard.classList.toggle('error', error);
  };
  const render = (state) => {
    updateState = state || {};
    const pct = state && state.progress ? Math.max(0, Math.min(100, Number(state.progress.percent) || 0)) : 0;
    progressBar.style.width = `${pct}%`;
    progress.hidden = !state || !['downloading', 'ready'].includes(state.status);
    statusCard.className = `dshd-update-status ${state && state.status ? state.status : ''}`;
    statusTitle.textContent = state && state.availableVersion && ['available', 'downloading', 'ready', 'skipped'].includes(state.status)
      ? `发现桌面版本 ${state.availableVersion}`
      : state && state.status === 'not-available' ? '当前已是最新版本' : (state && state.status === 'unsupported' ? '开发预览模式' : (state && state.status === 'error' ? '更新检查失败' : '更新中心'));
    setStatus((state && state.message) || '准备检查更新', state && state.status === 'error');
    check.disabled = !state || ['checking', 'downloading'].includes(state.status);
    download.disabled = !state || state.status !== 'available';
    install.disabled = !state || state.status !== 'ready';
    skip.disabled = !state || !state.availableVersion || !['available', 'skipped'].includes(state.status);
    unskip.disabled = !state || !state.preferences || !state.preferences.skippedVersion;
    mode.value = (state && state.preferences && state.preferences.mode) || 'default';
    channel.value = (state && state.preferences && state.preferences.channel) || 'stable';
    if (state && state.releaseNotes) { notes.hidden = false; notes.textContent = state.releaseNotes; }
    else notes.hidden = true;
    const c = state && state.components || {};
    components.replaceChildren();
    for (const [label, value] of [['桌面版本', state && state.appVersion], ['Harness', c.harness], ['便携 Node.js', c.node], ['pnpm', c.pnpm]]) {
      const item = el('div', 'dshd-update-component');
      item.appendChild(el('span', '', label));
      item.appendChild(el('strong', '', value || '未检测到'));
      components.appendChild(item);
    }
    meta.textContent = state && state.lastCheckedAt ? `上次检查：${new Date(state.lastCheckedAt).toLocaleString()}` : '更新源：GitHub Releases';
  };
  const invoke = async (channelName) => {
    try { render(await ipcRenderer.invoke(channelName)); }
    catch (error) { setStatus(error && error.message ? error.message : String(error), true); }
  };
  check.addEventListener('click', () => invoke('desktop-update:check'));
  harnessCheck.addEventListener('click', async () => {
    harnessCheck.disabled = true;
    harnessStatus.textContent = '正在读取官方 Harness 版本…';
    try {
      const result = await ipcRenderer.invoke('update:check');
      if (!result || !result.ok) throw new Error((result && result.message) || '上游检查失败');
      harnessStatus.textContent = result.current === result.latest
        ? `Harness ${result.current} 已与官方 package.json 版本一致。`
        : `本地 Harness ${result.current}，官方 package.json 为 ${result.latest}。请由维护者评估后随桌面版本升级。`;
    } catch (error) {
      harnessStatus.textContent = error && error.message ? error.message : String(error);
    } finally {
      harnessCheck.disabled = false;
    }
  });
  download.addEventListener('click', () => invoke('desktop-update:download'));
  install.addEventListener('click', () => invoke('desktop-update:install'));
  skip.addEventListener('click', () => invoke('desktop-update:skip'));
  unskip.addEventListener('click', () => invoke('desktop-update:unskip'));
  mode.addEventListener('change', () => invokePreferences());
  channel.addEventListener('change', () => invokePreferences());
  async function invokePreferences() {
    try { render(await ipcRenderer.invoke('desktop-update:preferences', { mode: mode.value, channel: channel.value })); }
    catch (error) { setStatus(error && error.message ? error.message : String(error), true); }
  }
  ipcRenderer.on('desktop-update:state', (_event, state) => render(state));
  ipcRenderer.invoke('desktop-update:state').then(render).catch(() => {});
  const closePanel = () => { panel.hidden = true; if (toolsLauncher) toolsLauncher.hidden = false; };
  closeUpdateCenter = closePanel;
  close.addEventListener('click', closePanel);
  openUpdateCenter = () => {
    if (closeBrowserPanel) closeBrowserPanel();
    if (closePluginCenter) closePluginCenter();
    if (closeDiagnosticsCenter) closeDiagnosticsCenter();
    panel.hidden = false;
    if (toolsLauncher) toolsLauncher.hidden = false;
    if (!updateState) invoke('desktop-update:state');
  };
}

function setToolsLayout() {
  if (!browserPanelWidth) {
    const saved = Number(localStorage.getItem('dsh-desktop-browser-width'));
    browserPanelWidth = clampBrowserWidth(saved || Math.round(window.innerWidth * TOOLS_RATIO));
  }
  browserPanelWidth = clampBrowserWidth(browserPanelWidth);
  if (toolsShell) toolsShell.style.width = `${browserPanelWidth}px`;
  const panelLeft = Math.max(0, window.innerWidth - browserPanelWidth);
  const extra = toolsShell ? [...toolsShell.querySelectorAll('.dshd-browser-find, .dshd-browser-error, .dshd-downloads, .dshd-browser-library')]
    .reduce((sum, item) => sum + (getComputedStyle(item).display === 'none' ? 0 : item.offsetHeight), 0) : 0;
  const contentTop = 128 + extra;
  const rail = toolsShell && toolsShell.querySelector('.dshd-browser-resize-rail');
  const progress = toolsShell && toolsShell.querySelector('.dshd-browser-progress');
  if (rail) rail.style.top = `${contentTop}px`;
  if (progress) progress.style.top = `${Math.max(0, contentTop - 2)}px`;
  ipcRenderer.invoke('browser:layout', {
    left: panelLeft + TOOLS_RESIZE_RAIL_WIDTH,
    top: contentTop,
    width: Math.max(1, browserPanelWidth - TOOLS_RESIZE_RAIL_WIDTH)
  }).catch(() => {});
}

function toolButton(label, className, title) {
  const button = el('button', className, label);
  if (title) button.title = title;
  return button;
}

function makeToolShell() {
  const launcher = el('div', '');
  launcher.id = TOOLS_LAUNCHER_ID;
  const dragHandle = el('div', 'dshd-tools-drag-handle', '⋮⋮');
  dragHandle.title = '拖动工具栏';
  dragHandle.setAttribute('aria-label', '拖动工具栏');
  launcher.appendChild(dragHandle);
  const launchBrowser = toolButton('◫', '', '显示/隐藏侧边面板（Ctrl+Alt+B）');
  launchBrowser.setAttribute('aria-label', '显示/隐藏侧边面板');
  launcher.appendChild(launchBrowser);
  const launchEditor = toolButton('▧', '', '打开文件编辑器');
  launchEditor.setAttribute('aria-label', '打开文件编辑器');
  launcher.appendChild(launchEditor);
  const launchPlugins = toolButton('🧩', '', '打开插件中心');
  launchPlugins.setAttribute('aria-label', '打开插件中心');
  launcher.appendChild(launchPlugins);
  const launchDiagnostics = toolButton('🛠', '', '打开诊断与修复中心');
  launchDiagnostics.setAttribute('aria-label', '打开诊断与修复中心');
  launcher.appendChild(launchDiagnostics);
  const launchUpdates = toolButton('⇧', '', '打开更新中心');
  launchUpdates.setAttribute('aria-label', '打开更新中心');
  launcher.appendChild(launchUpdates);

  const shell = el('aside', '');
  shell.id = TOOLS_SHELL_ID;
  shell.hidden = true;
  const head = el('header', 'dshd-tool-head');
  const title = el('strong', '', '浏览器');
  const localBadge = el('span', 'dshd-local-badge', '本地预览');
  const meta = el('span', 'dshd-tool-meta dshd-browser-state', '准备就绪');
  const quoteSelection = toolButton('❞', 'dshd-tool-action', '引用网页选中文字到聊天');
  const capture = toolButton('▣', 'dshd-tool-action', '截取当前网页并加入聊天');
  const downloadButton = toolButton('⇩', 'dshd-tool-action', '显示下载中心');
  const libraryButton = toolButton('▤', 'dshd-tool-action', '显示书签和历史记录');
  for (const item of [quoteSelection, capture, downloadButton, libraryButton]) item.classList.add('dshd-browser-only');
  quoteSelection.setAttribute('aria-label', '引用网页选中文字到聊天');
  capture.setAttribute('aria-label', '截取当前网页并加入聊天');
  downloadButton.setAttribute('aria-label', '显示下载中心');
  libraryButton.setAttribute('aria-label', '显示书签和历史记录');
  const expand = toolButton('⇱', 'dshd-tool-expand', '展开 / 恢复浏览器宽度');
  const close = toolButton('×', 'dshd-tool-close', '关闭内置浏览器');
  head.appendChild(title);
  head.appendChild(localBadge);
  head.appendChild(meta);
  head.appendChild(quoteSelection);
  head.appendChild(capture);
  head.appendChild(downloadButton);
  head.appendChild(libraryButton);
  head.appendChild(expand);
  head.appendChild(close);

  const tabs = el('div', 'dshd-browser-tabs');
  tabs.classList.add('dshd-browser-only');
  const tabList = el('div', 'dshd-browser-tab-list');
  tabList.setAttribute('role', 'tablist');
  const newTab = toolButton('+', 'dshd-tab-new', '新建标签页（Ctrl+T）');
  tabs.appendChild(tabList);
  tabs.appendChild(newTab);

  const chrome = el('div', 'dshd-browser-chrome');
  chrome.classList.add('dshd-browser-only');
  const resizeRail = el('div', 'dshd-browser-resize-rail');
  resizeRail.setAttribute('aria-label', '拖动调整浏览器宽度');
  const back = toolButton('‹', '', '后退');
  const forward = toolButton('›', '', '前进');
  const reload = toolButton('↻', '', '刷新');
  const address = el('input', 'dshd-browser-url');
  address.type = 'text';
  address.value = browserUrl;
  address.placeholder = '输入网址，例如 deepseek.com';
  address.setAttribute('aria-label', '网址');
  const bookmark = toolButton('☆', '', '添加当前网页到书签');
  const findButton = toolButton('⌕', '', '在页面中查找（Ctrl+F）');
  const zoom = toolButton('100%', '', '页面缩放：Ctrl++ / Ctrl+- / Ctrl+0');
  zoom.style.fontSize = '10px';
  const external = toolButton('↗', '', '在系统浏览器中打开');
  chrome.appendChild(back);
  chrome.appendChild(forward);
  chrome.appendChild(reload);
  chrome.appendChild(address);
  chrome.appendChild(bookmark);
  chrome.appendChild(findButton);
  chrome.appendChild(zoom);
  chrome.appendChild(external);

  const findBar = el('div', 'dshd-browser-find');
  findBar.classList.add('dshd-browser-only');
  const findInput = el('input', '');
  findInput.type = 'text';
  findInput.placeholder = '在页面中查找';
  const findCount = el('span', '', '0/0');
  const findPrevious = toolButton('↑', '', '上一个匹配项');
  const findNext = toolButton('↓', '', '下一个匹配项');
  const closeFind = toolButton('×', '', '关闭查找');
  findBar.appendChild(findInput);
  findBar.appendChild(findCount);
  findBar.appendChild(findPrevious);
  findBar.appendChild(findNext);
  findBar.appendChild(closeFind);
  const errorBar = el('div', 'dshd-browser-error');
  errorBar.classList.add('dshd-browser-only');
  const errorText = el('span', '', '网页加载失败');
  const retryError = toolButton('重新加载', '', '重新加载当前网页');
  errorBar.appendChild(errorText);
  errorBar.appendChild(retryError);
  const downloadsPanel = el('section', 'dshd-downloads');
  downloadsPanel.classList.add('dshd-browser-only');
  const downloadHead = el('div', 'dshd-download-head');
  downloadHead.appendChild(el('span', '', '下载中心'));
  const clearDownloads = toolButton('清除已完成', '', '清除已结束的下载记录');
  downloadHead.appendChild(clearDownloads);
  const downloadList = el('div', 'dshd-download-list');
  downloadsPanel.appendChild(downloadHead);
  downloadsPanel.appendChild(downloadList);
  const libraryPanel = el('section', 'dshd-browser-library');
  libraryPanel.classList.add('dshd-browser-only');
  const bookmarksSection = el('div', 'dshd-library-section');
  const bookmarksHead = el('div', 'dshd-library-head');
  bookmarksHead.appendChild(el('span', '', '书签'));
  const bookmarksList = el('div', 'dshd-library-list');
  bookmarksSection.appendChild(bookmarksHead);
  bookmarksSection.appendChild(bookmarksList);
  const historySection = el('div', 'dshd-library-section');
  const historyHead = el('div', 'dshd-library-head');
  historyHead.appendChild(el('span', '', '最近访问'));
  const clearHistory = toolButton('清除历史', '', '清除内置浏览器历史记录');
  historyHead.appendChild(clearHistory);
  const historyList = el('div', 'dshd-library-list');
  historySection.appendChild(historyHead);
  historySection.appendChild(historyList);
  libraryPanel.appendChild(bookmarksSection);
  libraryPanel.appendChild(historySection);
  const progress = el('div', 'dshd-browser-progress');
  progress.classList.add('dshd-browser-only');

  const editorPane = el('section', 'dshd-editor-pane');
  editorPane.hidden = true;
  const editorTabs = el('div', 'dshd-editor-tabs');
  editorTabs.setAttribute('role', 'tablist');
  const editorToolbar = el('div', 'dshd-editor-toolbar');
  const editorOpen = toolButton('打开', '', '打开工作区文本文件');
  const editorSave = toolButton('保存', '', '保存当前文件（Ctrl+S）');
  const editorReload = toolButton('重载', '', '从磁盘重新载入');
  const editorExternal = toolButton('外部打开', '', '使用系统关联的编辑器打开');
  const editorFind = el('input', 'dshd-editor-find');
  editorFind.type = 'text';
  editorFind.placeholder = '在文件中查找（Ctrl+F）';
  const editorFindPrevious = toolButton('↑', '', '上一个匹配项');
  const editorFindNext = toolButton('↓', '', '下一个匹配项');
  const editorWrap = toolButton('自动换行', '', '切换自动换行');
  editorToolbar.appendChild(editorOpen);
  editorToolbar.appendChild(editorSave);
  editorToolbar.appendChild(editorReload);
  editorToolbar.appendChild(editorExternal);
  editorToolbar.appendChild(editorFind);
  editorToolbar.appendChild(editorFindPrevious);
  editorToolbar.appendChild(editorFindNext);
  editorToolbar.appendChild(editorWrap);
  const editorCanvas = el('div', 'dshd-editor-canvas');
  const editorLines = el('pre', 'dshd-editor-lines');
  const editorText = el('textarea', 'dshd-editor-text');
  editorText.spellcheck = false;
  editorText.setAttribute('aria-label', '文件内容');
  const editorEmpty = el('div', 'dshd-editor-empty', '从聊天中点击文本文件即可在这里打开');
  editorCanvas.appendChild(editorLines);
  editorCanvas.appendChild(editorText);
  editorCanvas.appendChild(editorEmpty);
  const editorStatus = el('footer', 'dshd-editor-status');
  const editorPath = el('span', '', '没有打开文件');
  const editorPosition = el('span', '', 'Ln 1, Col 1');
  const editorEncoding = el('span', '', 'UTF-8');
  editorStatus.appendChild(editorPath);
  editorStatus.appendChild(editorPosition);
  editorStatus.appendChild(editorEncoding);
  editorPane.appendChild(editorTabs);
  editorPane.appendChild(editorToolbar);
  editorPane.appendChild(editorCanvas);
  editorPane.appendChild(editorStatus);

  shell.appendChild(head);
  shell.appendChild(tabs);
  shell.appendChild(chrome);
  shell.appendChild(findBar);
  shell.appendChild(errorBar);
  shell.appendChild(downloadsPanel);
  shell.appendChild(libraryPanel);
  shell.appendChild(progress);
  shell.appendChild(resizeRail);
  shell.appendChild(editorPane);
  document.body.appendChild(launcher);
  document.body.appendChild(shell);
  toolsLauncher = launcher;
  toolsShell = shell;
  loadToolsLauncherPosition();
  applyToolsLauncherPosition();

  let toolbarDragging = false;
  let toolbarPointerId = null;
  dragHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    toolbarDragging = true;
    toolbarPointerId = event.pointerId;
    launcher.classList.add('dragging');
    dragHandle.setPointerCapture?.(event.pointerId);
  });
  dragHandle.addEventListener('pointermove', (event) => {
    if (!toolbarDragging || event.pointerId !== toolbarPointerId) return;
    const limits = toolbarPositionLimits();
    toolsLauncherPosition = {
      side: event.clientX < window.innerWidth / 2 ? 'left' : 'right',
      top: Math.max(limits.min, Math.min(limits.max, event.clientY - launcher.offsetHeight / 2))
    };
    applyToolsLauncherPosition();
  });
  const finishToolbarDrag = (event) => {
    if (!toolbarDragging || (event && event.pointerId !== toolbarPointerId)) return;
    toolbarDragging = false;
    toolbarPointerId = null;
    launcher.classList.remove('dragging');
    applyToolsLauncherPosition();
    saveToolsLauncherPosition();
  };
  dragHandle.addEventListener('pointerup', finishToolbarDrag);
  dragHandle.addEventListener('pointercancel', finishToolbarDrag);

  const editorDocuments = [];
  let activeEditorPath = '';
  let editorWrapEnabled = localStorage.getItem('dsh-desktop-editor-wrap') === 'true';
  const editorKey = (file) => String(file || '').toLocaleLowerCase();
  const activeEditor = () => editorDocuments.find((item) => editorKey(item.path) === editorKey(activeEditorPath)) || null;
  const editorContent = (value) => String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const setEditorMessage = (message, error = false) => {
    editorStatus.classList.toggle('error', error);
    editorPath.textContent = message || (activeEditor() ? activeEditor().relativePath : '没有打开文件');
  };
  const syncEditorDirty = (document) => {
    const dirty = document.content !== document.savedContent;
    if (document.dirty === dirty) return;
    document.dirty = dirty;
    ipcRenderer.invoke('editor:dirty', document.path, dirty).catch(() => {});
  };
  const updateEditorLines = () => {
    const document = activeEditor();
    if (!document) {
      editorLines.textContent = '';
      return;
    }
    const lineCount = Math.max(1, (editorText.value.match(/\n/g) || []).length + 1);
    editorCanvas.classList.toggle('no-gutter', lineCount > 50000);
    if (lineCount > 50000) {
      editorLines.textContent = '';
      return;
    }
    editorLines.textContent = Array.from({ length: lineCount }, (_item, index) => index + 1).join('\n');
  };
  const updateEditorPosition = () => {
    const before = editorText.value.slice(0, editorText.selectionStart);
    const rows = before.split('\n');
    editorPosition.textContent = `Ln ${rows.length}, Col ${rows[rows.length - 1].length + 1}`;
  };
  const renderEditorTabs = () => {
    editorTabs.replaceChildren();
    for (const document of editorDocuments) {
      const tab = el('div', `dshd-editor-tab${editorKey(document.path) === editorKey(activeEditorPath) ? ' active' : ''}${document.dirty ? ' dirty' : ''}`);
      tab.setAttribute('role', 'tab');
      tab.title = document.path;
      tab.appendChild(el('span', 'dshd-editor-tab-name', document.name));
      const tabClose = toolButton('×', 'dshd-editor-tab-close', '关闭文件');
      tab.appendChild(tabClose);
      tab.addEventListener('click', () => {
        activeEditorPath = document.path;
        renderEditor();
      });
      tabClose.addEventListener('click', (event) => {
        event.stopPropagation();
        if (document.dirty && !window.confirm(`${document.name} 尚未保存，确定放弃修改并关闭吗？`)) return;
        ipcRenderer.invoke('editor:dirty', document.path, false).catch(() => {});
        const index = editorDocuments.indexOf(document);
        editorDocuments.splice(index, 1);
        if (editorKey(activeEditorPath) === editorKey(document.path)) {
          activeEditorPath = (editorDocuments[index] || editorDocuments[index - 1] || {}).path || '';
        }
        renderEditor();
      });
      editorTabs.appendChild(tab);
    }
  };
  const renderEditor = () => {
    const document = activeEditor();
    renderEditorTabs();
    const empty = !document;
    editorEmpty.hidden = !empty;
    editorLines.hidden = empty;
    editorText.hidden = empty;
    editorSave.disabled = empty || !document.dirty;
    editorReload.disabled = empty;
    editorExternal.disabled = empty;
    editorFind.disabled = empty;
    editorFindPrevious.disabled = empty;
    editorFindNext.disabled = empty;
    editorWrap.disabled = empty;
    if (empty) {
      editorText.value = '';
      editorPath.textContent = '没有打开文件';
      editorEncoding.textContent = 'UTF-8';
      editorPosition.textContent = 'Ln 1, Col 1';
      return;
    }
    editorText.value = document.content;
    editorText.classList.toggle('wrap', editorWrapEnabled);
    editorCanvas.classList.toggle('wrap-mode', editorWrapEnabled);
    editorWrap.textContent = editorWrapEnabled ? '取消换行' : '自动换行';
    editorStatus.classList.remove('error');
    editorPath.textContent = `${document.relativePath}${document.dirty ? ' · 未保存' : ''}`;
    editorPath.title = document.path;
    editorEncoding.textContent = `${String(document.encoding || 'utf8').toUpperCase()} · ${document.eol === 'crlf' ? 'CRLF' : 'LF'}`;
    updateEditorLines();
    updateEditorPosition();
    editorText.focus();
  };
  const showEditor = async (document) => {
    if (closePluginCenter) closePluginCenter();
    if (closeDiagnosticsCenter) closeDiagnosticsCenter();
    if (closeUpdateCenter) closeUpdateCenter();
    await ipcRenderer.invoke('browser:hide').catch(() => {});
    toolMode = 'editor';
    shell.classList.add('editor-mode');
    shell.classList.remove('find-open');
    editorPane.hidden = false;
    title.textContent = '文件编辑器';
    meta.textContent = document.relativePath;
    meta.title = document.path;
    shell.hidden = false;
    launcher.hidden = true;
    setToolsLayout();
    renderEditor();
  };
  openFileEditor = async (file) => {
    const existing = editorDocuments.find((item) => editorKey(item.path) === editorKey(file));
    if (existing && existing.dirty) {
      activeEditorPath = existing.path;
      await showEditor(existing);
      return { ok: true, existing: true };
    }
    const response = await ipcRenderer.invoke('editor:open', file);
    if (!response || !response.ok) {
      await showEditor({ relativePath: '文件无法内置打开', path: String(file || '') });
      meta.classList.add('error');
      meta.textContent = (response && response.message) || '文件打开失败';
      setEditorMessage(meta.textContent, true);
      if (window.confirm(`${meta.textContent}\n\n是否改用系统关联的编辑器打开？`)) {
        const externalResponse = await ipcRenderer.invoke('editor:open-external', file);
        if (!externalResponse || !externalResponse.ok) setEditorMessage((externalResponse && externalResponse.message) || '外部打开失败', true);
      }
      return response;
    }
    const document = existing || {};
    Object.assign(document, response, {
      content: editorContent(response.content),
      savedContent: editorContent(response.content),
      dirty: false
    });
    if (!existing) editorDocuments.push(document);
    activeEditorPath = document.path;
    await showEditor(document);
    return response;
  };
  const showEmptyEditor = async () => {
    const document = activeEditor() || { relativePath: '选择工作区内的文本或代码文件', path: '' };
    await showEditor(document);
  };
  const saveEditor = async (force = false) => {
    const document = activeEditor();
    if (!document) return;
    document.content = editorText.value;
    setEditorMessage('正在保存…');
    let response = await ipcRenderer.invoke('editor:save', { ...document, content: document.content, force });
    if (response && response.conflict) {
      const overwrite = window.confirm('文件已被其他程序修改。确定用当前编辑器内容覆盖磁盘文件吗？');
      if (overwrite) response = await ipcRenderer.invoke('editor:save', { ...document, content: document.content, force: true });
    }
    if (!response || !response.ok) {
      setEditorMessage((response && response.message) || '保存失败', true);
      return;
    }
    document.revision = response.revision;
    document.size = response.size;
    document.savedContent = document.content;
    syncEditorDirty(document);
    renderEditor();
    setEditorMessage(`${document.relativePath} · 已保存`);
  };
  const reloadEditor = async () => {
    const document = activeEditor();
    if (!document) return;
    if (document.dirty && !window.confirm('当前修改尚未保存，确定从磁盘重新载入吗？')) return;
    const response = await ipcRenderer.invoke('editor:open', document.path);
    if (!response || !response.ok) return setEditorMessage((response && response.message) || '重新载入失败', true);
    ipcRenderer.invoke('editor:dirty', document.path, false).catch(() => {});
    Object.assign(document, response, { content: editorContent(response.content), savedContent: editorContent(response.content), dirty: false });
    renderEditor();
    setEditorMessage(`${document.relativePath} · 已重新载入`);
  };
  const findEditorText = (forward = true) => {
    const query = editorFind.value;
    if (!query || !activeEditor()) return;
    const value = editorText.value.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let index = forward ? value.indexOf(needle, editorText.selectionEnd) : value.lastIndexOf(needle, Math.max(0, editorText.selectionStart - 1));
    if (index < 0) index = forward ? value.indexOf(needle) : value.lastIndexOf(needle);
    if (index < 0) return setEditorMessage(`没有找到“${query}”`, true);
    editorText.focus();
    editorText.setSelectionRange(index, index + query.length);
    updateEditorPosition();
    setEditorMessage(activeEditor().relativePath);
  };
  editorText.addEventListener('input', () => {
    const document = activeEditor();
    if (!document) return;
    document.content = editorText.value;
    syncEditorDirty(document);
    editorSave.disabled = !document.dirty;
    editorPath.textContent = `${document.relativePath}${document.dirty ? ' · 未保存' : ''}`;
    renderEditorTabs();
    updateEditorLines();
    updateEditorPosition();
  });
  editorText.addEventListener('scroll', () => { editorLines.scrollTop = editorText.scrollTop; });
  editorText.addEventListener('click', updateEditorPosition);
  editorText.addEventListener('keyup', updateEditorPosition);
  editorText.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLocaleLowerCase() === 's') { event.preventDefault(); saveEditor(); }
    else if (event.ctrlKey && event.key.toLocaleLowerCase() === 'f') { event.preventDefault(); editorFind.focus(); editorFind.select(); }
    else if (event.key === 'Tab') {
      event.preventDefault();
      const start = editorText.selectionStart;
      editorText.setRangeText('  ', start, editorText.selectionEnd, 'end');
      editorText.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  editorOpen.addEventListener('click', async () => {
    const response = await ipcRenderer.invoke('editor:pick');
    if (!response || !response.ok) {
      if (!response || !response.cancelled) setEditorMessage((response && response.message) || '文件打开失败', true);
      return;
    }
    const existing = editorDocuments.find((item) => editorKey(item.path) === editorKey(response.path));
    if (existing && existing.dirty) {
      activeEditorPath = existing.path;
      renderEditor();
      return;
    }
    const document = existing || {};
    Object.assign(document, response, { content: editorContent(response.content), savedContent: editorContent(response.content), dirty: false });
    if (!existing) editorDocuments.push(document);
    activeEditorPath = document.path;
    renderEditor();
  });
  editorSave.addEventListener('click', () => saveEditor());
  editorReload.addEventListener('click', reloadEditor);
  editorExternal.addEventListener('click', async () => {
    const document = activeEditor();
    if (!document) return;
    const response = await ipcRenderer.invoke('editor:open-external', document.path);
    if (!response || !response.ok) setEditorMessage((response && response.message) || '外部打开失败', true);
  });
  editorFind.addEventListener('keydown', (event) => { if (event.key === 'Enter') findEditorText(!event.shiftKey); });
  editorFindPrevious.addEventListener('click', () => findEditorText(false));
  editorFindNext.addEventListener('click', () => findEditorText(true));
  editorWrap.addEventListener('click', () => {
    editorWrapEnabled = !editorWrapEnabled;
    localStorage.setItem('dsh-desktop-editor-wrap', String(editorWrapEnabled));
    renderEditor();
  });

  const renderTabs = () => {
    tabList.replaceChildren();
    for (const tab of browserState.tabs || []) {
      const item = el('div', `dshd-browser-tab${tab.id === browserState.activeTabId ? ' active' : ''}${tab.loading ? ' loading' : ''}`);
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab.id === browserState.activeTabId));
      item.title = tab.title || tab.url || '新标签';
      let icon;
      if (tab.favicon) {
        icon = document.createElement('img');
        icon.src = tab.favicon;
        icon.alt = '';
        icon.className = 'dshd-tab-icon';
      } else {
        icon = el('span', 'dshd-tab-icon', tab.loading ? '◌' : '◫');
      }
      const tabTitle = el('span', 'dshd-tab-title', tab.title || '新标签');
      const tabClose = toolButton('×', 'dshd-tab-close', '关闭标签页');
      item.appendChild(icon);
      item.appendChild(tabTitle);
      item.appendChild(tabClose);
      item.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:tab-switch', tab.id)));
      tabClose.addEventListener('click', async (event) => {
        event.stopPropagation();
        updateBrowserState(await ipcRenderer.invoke('browser:tab-close', tab.id));
      });
      tabList.appendChild(item);
    }
    const active = tabList.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const formatBytes = (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const renderDownloads = () => {
    const downloads = [...(browserState.downloads || [])].reverse();
    downloadButton.classList.toggle('has-items', downloads.some((item) => item.state === 'progressing'));
    downloadList.replaceChildren();
    if (downloads.length === 0) {
      downloadList.appendChild(el('div', 'dshd-download-empty', '还没有下载记录'));
      return;
    }
    for (const item of downloads) {
      const row = el('article', 'dshd-download-item');
      row.appendChild(el('div', 'dshd-download-name', item.filename || '下载文件'));
      const received = formatBytes(item.receivedBytes);
      const total = item.totalBytes ? formatBytes(item.totalBytes) : '';
      const labels = { progressing: '下载中', completed: '已完成', cancelled: '已取消', interrupted: '下载失败' };
      row.appendChild(el('div', 'dshd-download-meta', `${labels[item.state] || item.state} · ${received}${total ? ` / ${total}` : ''}`));
      const actions = el('div', 'dshd-download-actions');
      if (item.state === 'completed') {
        const openFile = toolButton('打开', '', '打开下载文件');
        const showFile = toolButton('位置', '', '在文件夹中显示');
        openFile.addEventListener('click', () => ipcRenderer.invoke('browser:download-open', item.id));
        showFile.addEventListener('click', () => ipcRenderer.invoke('browser:download-show', item.id));
        actions.appendChild(openFile);
        actions.appendChild(showFile);
      } else if (['cancelled', 'interrupted'].includes(item.state)) {
        const retry = toolButton('重试', '', '重新下载');
        retry.addEventListener('click', () => ipcRenderer.invoke('browser:download-retry', item.id));
        actions.appendChild(retry);
      }
      row.appendChild(actions);
      if (item.state === 'progressing') {
        const track = el('div', 'dshd-download-track');
        const bar = el('span', '');
        bar.style.width = `${item.totalBytes ? Math.min(100, item.receivedBytes / item.totalBytes * 100) : 8}%`;
        track.appendChild(bar);
        row.appendChild(track);
      }
      downloadList.appendChild(row);
    }
  };

  const renderLibrary = (library) => {
    if (!library || library.ok === false) return;
    bookmarksList.replaceChildren();
    historyList.replaceChildren();
    const renderEntry = (item, removable) => {
      const row = el('article', 'dshd-library-item');
      const link = el('button', 'dshd-library-link');
      link.appendChild(el('strong', '', item.title || item.url));
      link.appendChild(el('small', '', item.url));
      link.title = item.url;
      link.addEventListener('click', async () => {
        libraryPanel.classList.remove('visible');
        await setMode('browser', item.url);
      });
      row.appendChild(link);
      if (removable) {
        const remove = toolButton('×', 'dshd-library-remove', '移除书签');
        remove.addEventListener('click', async () => renderLibrary(await ipcRenderer.invoke('browser:bookmark-remove', item.url)));
        row.appendChild(remove);
      } else {
        const time = item.visitedAt ? new Date(item.visitedAt).toLocaleString() : '';
        if (time) row.appendChild(el('small', 'dshd-download-meta', time));
      }
      return row;
    };
    const bookmarks = library.bookmarks || [];
    const history = library.history || [];
    if (!bookmarks.length) bookmarksList.appendChild(el('div', 'dshd-download-empty', '还没有书签'));
    else for (const item of bookmarks) bookmarksList.appendChild(renderEntry(item, true));
    if (!history.length) historyList.appendChild(el('div', 'dshd-download-empty', '还没有访问记录'));
    else for (const item of history.slice(0, 50)) historyList.appendChild(renderEntry(item, false));
  };

  const loadLibrary = async () => {
    const response = await ipcRenderer.invoke('browser:library');
    renderLibrary(response);
    return response;
  };

  const updateBrowserState = (nextState) => {
    if (nextState && nextState.ok === false) return;
    browserState = nextState || { open: false, tabs: [] };
    if (browserState.home || !browserState.open) {
      browserUrl = '';
      address.value = '';
    } else if (browserState.url && /^https?:/i.test(browserState.url)) {
      browserUrl = browserState.url;
      address.value = browserUrl;
    }
    back.disabled = !browserState.canGoBack;
    forward.disabled = !browserState.canGoForward;
    external.disabled = Boolean(browserState.home) || !/^https?:/i.test(browserState.url || '');
    bookmark.disabled = Boolean(browserState.home) || !/^https?:/i.test(browserState.url || '');
    bookmark.textContent = browserState.bookmarked ? '★' : '☆';
    bookmark.title = browserState.bookmarked ? '移除当前网页书签' : '添加当前网页到书签';
    const loading = Boolean(browserState.loading);
    progress.classList.toggle('loading', loading);
    meta.classList.toggle('loading', loading);
    meta.classList.toggle('error', Boolean(browserState.error));
    meta.textContent = browserState.error || (loading ? '正在加载…' : (browserState.title || '隔离网页内容'));
    meta.title = browserState.url || '';
    errorBar.classList.toggle('visible', Boolean(browserState.error));
    errorText.textContent = browserState.error || '';
    localBadge.classList.toggle('visible', /^http:\/\/127\.0\.0\.1:\d+\/.+\.html?(?:[?#]|$)/i.test(browserState.url || ''));
    zoom.textContent = `${Math.round((browserState.zoomFactor || 1) * 100)}%`;
    const result = browserState.findResult;
    findCount.textContent = result && result.matches ? `${result.activeMatchOrdinal || 0}/${result.matches}` : '0/0';
    renderTabs();
    renderDownloads();
    requestAnimationFrame(setToolsLayout);
  };

  const setMode = async (mode, nextUrl, options = {}) => {
    if (mode !== 'browser') return;
    toolMode = 'browser';
    shell.classList.remove('editor-mode');
    editorPane.hidden = true;
    title.textContent = '浏览器';
    meta.classList.remove('error');
    if (options.home) browserUrl = '';
    if (nextUrl) browserUrl = nextUrl;
    address.value = browserUrl;
    shell.hidden = false;
    launcher.hidden = true;
    setToolsLayout();
    let result;
    if (nextUrl || options.home) result = await ipcRenderer.invoke(options.newTab ? 'browser:tab-new' : 'browser:open', options.home ? null : browserUrl);
    else if (browserState.open) result = await ipcRenderer.invoke('browser:show');
    else result = await ipcRenderer.invoke('browser:open', browserUrl);
    setToolsLayout();
    if (!result || !result.ok) {
      meta.classList.remove('loading');
      meta.textContent = (result && result.message) || '浏览器打开失败';
      return result;
    }
    updateBrowserState(result);
    return result;
  };

  openBrowserPanel = (nextUrl, options = {}) => {
    if (closePluginCenter) closePluginCenter();
    if (closeDiagnosticsCenter) closeDiagnosticsCenter();
    if (closeUpdateCenter) closeUpdateCenter();
    return setMode('browser', nextUrl, options);
  };

  const closeTools = async () => {
    toolMode = 'closed';
    shell.hidden = true;
    launcher.hidden = false;
    await ipcRenderer.invoke('browser:hide').catch(() => {});
  };
  closeBrowserPanel = closeTools;
  let dragStartX = 0;
  let dragStartWidth = 0;
  const finishResize = () => {
    if (!resizeRail.classList.contains('dragging')) return;
    resizeRail.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('dsh-desktop-browser-width', String(browserPanelWidth));
  };
  resizeRail.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragStartX = event.clientX;
    dragStartWidth = browserPanelWidth || clampBrowserWidth(Math.round(window.innerWidth * TOOLS_RATIO));
    resizeRail.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    resizeRail.setPointerCapture?.(event.pointerId);
  });
  resizeRail.addEventListener('pointermove', (event) => {
    if (!resizeRail.classList.contains('dragging')) return;
    browserPanelWidth = clampBrowserWidth(dragStartWidth - (event.clientX - dragStartX));
    setToolsLayout();
  });
  resizeRail.addEventListener('pointerup', finishResize);
  resizeRail.addEventListener('pointercancel', finishResize);
  expand.addEventListener('click', () => {
    const limits = browserWidthLimits();
    const normal = clampBrowserWidth(Math.round(window.innerWidth * TOOLS_RATIO));
    browserPanelWidth = browserPanelWidth < limits.max - 20 ? limits.max : normal;
    localStorage.setItem('dsh-desktop-browser-width', String(browserPanelWidth));
    setToolsLayout();
  });
  launchPlugins.addEventListener('click', () => { if (openPluginCenter) openPluginCenter(); });
  launchDiagnostics.addEventListener('click', () => { if (openDiagnosticsCenter) openDiagnosticsCenter(); });
  launchUpdates.addEventListener('click', () => { if (openUpdateCenter) openUpdateCenter(); });

  const navigate = () => {
    const value = address.value.trim();
    return setMode('browser', value, { home: !value });
  };
  const runFind = (forward = true, findNextMatch = false) => {
    ipcRenderer.invoke('browser:find', findInput.value, { forward, findNext: findNextMatch }).then(updateBrowserState);
  };
  const showFind = () => {
    shell.classList.add('find-open');
    setToolsLayout();
    findInput.focus();
    findInput.select();
  };
  const hideFind = async () => {
    shell.classList.remove('find-open');
    setToolsLayout();
    updateBrowserState(await ipcRenderer.invoke('browser:find-stop', 'clearSelection'));
  };
  const composer = () => document.querySelector('[data-composer-card] textarea:not(:disabled)');
  const pasteIntoComposer = (dataTransfer) => {
    const target = composer();
    if (!target) throw new Error('当前聊天输入框不可用，请先打开一个可编辑会话');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    if (!target.dispatchEvent(event)) return;
    throw new Error('DSH 没有接收这次粘贴内容');
  };
  const showActionResult = (message, error = false) => {
    meta.classList.toggle('error', error);
    meta.textContent = message;
    setTimeout(() => updateBrowserState(browserState), 1800);
  };
  const quoteToChat = async () => {
    const result = await ipcRenderer.invoke('browser:selection');
    if (!result || !result.ok) return showActionResult((result && result.message) || '读取网页选文失败', true);
    const quote = String(result.text || '').split(/\r?\n/).map((line) => `> ${line}`).join('\n');
    const transfer = new DataTransfer();
    transfer.setData('text/plain', `网页引用：${result.title || '未命名网页'}\n${result.url}\n\n${quote}\n\n`);
    try {
      pasteIntoComposer(transfer);
      showActionResult('已将网页引用加入当前聊天草稿');
    } catch (error) { showActionResult(error.message || String(error), true); }
  };
  const screenshotToChat = async () => {
    showActionResult('正在截取网页…');
    const result = await ipcRenderer.invoke('browser:screenshot');
    if (!result || !result.ok) return showActionResult((result && result.message) || '网页截图失败', true);
    try {
      const binary = atob(result.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const file = new File([bytes], result.filename || 'webpage.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      pasteIntoComposer(transfer);
      showActionResult(`已将网页截图加入聊天草稿（${result.width}×${result.height}）`);
    } catch (error) { showActionResult(error.message || String(error), true); }
  };

  launchBrowser.addEventListener('click', () => {
    if (toolMode === 'browser' && !shell.hidden) closeTools();
    else openBrowserPanel();
  });
  launchEditor.addEventListener('click', () => {
    if (toolMode === 'editor' && !shell.hidden) closeTools();
    else showEmptyEditor();
  });
  close.addEventListener('click', closeTools);
  address.addEventListener('keydown', (event) => { if (event.key === 'Enter') navigate(); });
  back.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:back')));
  forward.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:forward')));
  reload.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:reload')));
  retryError.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:reload')));
  newTab.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:tab-new', null)));
  findButton.addEventListener('click', showFind);
  findInput.addEventListener('input', () => runFind(true, false));
  findInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runFind(!event.shiftKey, true);
    if (event.key === 'Escape') hideFind();
  });
  findPrevious.addEventListener('click', () => runFind(false, true));
  findNext.addEventListener('click', () => runFind(true, true));
  closeFind.addEventListener('click', hideFind);
  zoom.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:zoom', 0)));
  external.addEventListener('click', () => ipcRenderer.invoke('browser:open-external'));
  bookmark.addEventListener('click', async () => {
    const response = await ipcRenderer.invoke('browser:bookmark-toggle');
    if (!response || !response.ok) return showActionResult((response && response.message) || '书签操作失败', true);
    browserState.bookmarked = Boolean(response.bookmarked);
    bookmark.textContent = response.bookmarked ? '★' : '☆';
    bookmark.title = response.bookmarked ? '移除当前网页书签' : '添加当前网页到书签';
    if (libraryPanel.classList.contains('visible')) renderLibrary(response);
    showActionResult(response.bookmarked ? '已添加书签' : '已移除书签');
  });
  quoteSelection.addEventListener('click', quoteToChat);
  capture.addEventListener('click', screenshotToChat);
  downloadButton.addEventListener('click', () => {
    downloadsPanel.classList.toggle('visible');
    libraryPanel.classList.remove('visible');
    requestAnimationFrame(setToolsLayout);
  });
  libraryButton.addEventListener('click', async () => {
    const showing = !libraryPanel.classList.contains('visible');
    libraryPanel.classList.toggle('visible', showing);
    downloadsPanel.classList.remove('visible');
    if (showing) await loadLibrary();
    requestAnimationFrame(setToolsLayout);
  });
  clearDownloads.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:downloads-clear')));
  clearHistory.addEventListener('click', async () => renderLibrary(await ipcRenderer.invoke('browser:history-clear')));
  window.addEventListener('resize', () => {
    applyToolsLauncherPosition();
    setToolsLayout();
  });
  ipcRenderer.on('browser:state', (_event, nextState) => updateBrowserState(nextState));
  ipcRenderer.on('browser:request-open', (_event, url) => {
    if (/^https?:\/\//i.test(String(url || ''))) openBrowserPanel(url, { newTab: Boolean(browserState.open) }).catch(() => {});
  });
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== window.location.origin || !data || data.type !== 'dsh-desktop-file-path-v1') return;
    if (typeof data.path !== 'string') return;
    if (/\.html?$/i.test(data.path.trim())) {
      const preview = await ipcRenderer.invoke('preview:open', data.path);
      if (preview && preview.ok) openBrowserPanel(preview.url, { newTab: Boolean(browserState.open) }).catch(() => {});
      return;
    }
    if (openFileEditor) openFileEditor(data.path).catch(() => {});
  });
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      if (toolMode === 'browser' && !shell.hidden) closeTools();
      else openBrowserPanel();
      return;
    }
    if (shell.hidden || !event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'f') { event.preventDefault(); showFind(); }
    else if (key === 'l') { event.preventDefault(); address.focus(); address.select(); }
    else if (key === 't') { event.preventDefault(); newTab.click(); }
    else if (key === 'w' && browserState.activeTabId) {
      event.preventDefault();
      ipcRenderer.invoke('browser:tab-close', browserState.activeTabId).then(updateBrowserState);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      ipcRenderer.invoke('browser:zoom', 0.1).then(updateBrowserState);
    } else if (event.key === '-') {
      event.preventDefault();
      ipcRenderer.invoke('browser:zoom', -0.1).then(updateBrowserState);
    } else if (event.key === '0') {
      event.preventDefault();
      ipcRenderer.invoke('browser:zoom', 0).then(updateBrowserState);
    }
  });
  ipcRenderer.invoke('browser:state').then(updateBrowserState).catch(() => {});
  setToolsLayout();
}

function bootTools() {
  if (document.getElementById(TOOLS_SHELL_ID)) return;
  const style = document.createElement('style');
  style.id = 'dshd-tools-css';
  style.textContent = TOOLS_CSS;
  (document.head || document.documentElement).appendChild(style);
  makeToolShell();
  bootPluginCenter();
  bootDiagnosticsCenter();
  bootUpdateCenter();

  const markExternalLinks = (root = document) => {
    const anchors = [];
    if (root && root.matches && root.matches('a[href]')) anchors.push(root);
    if (root && root.querySelectorAll) anchors.push(...root.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      if (anchor.closest(`#${TOOLS_LAUNCHER_ID}, #${TOOLS_SHELL_ID}, [data-dsh-plugin-settings], #${ROW_ID}, #dshd-update-center`)) continue;
      try {
        const url = new URL(anchor.href, window.location.href);
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== window.location.origin) {
          anchor.setAttribute('data-dsh-browser-link', '');
          if (!anchor.title) anchor.title = '在内置浏览器中打开';
        }
      } catch { /* ignore malformed links */ }
    }
  };
  markExternalLinks();
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) markExternalLinks(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // External links in chat stay inside the desktop workspace. Settings and
  // the browser chrome keep their normal link behaviour.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor || !document.documentElement.contains(anchor)) return;
    if (anchor.closest(`#${TOOLS_LAUNCHER_ID}, #${TOOLS_SHELL_ID}, [data-dsh-plugin-settings], #${ROW_ID}, #dshd-update-center`)) return;
    let url;
    try { url = new URL(anchor.href, window.location.href); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === window.location.origin) return;
    event.preventDefault();
    event.stopPropagation();
    if (openBrowserPanel) openBrowserPanel(url.href).catch(() => {});
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootTools, { once: true });
else bootTools();
