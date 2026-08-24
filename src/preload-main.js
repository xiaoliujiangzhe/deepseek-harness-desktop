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
#dshd-plugin-center {
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
#dshd-plugin-center[hidden] { display: none !important; }
.dshd-plugin-center-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid #dfe3e9;
}
.dshd-plugin-center-head strong { font-size: 15px; }
.dshd-plugin-center-head span { flex: 1; color: #6e7686; font-size: 12px; }
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

// ---------- update row ----------

const UPDATE_ROW_ID = 'dsh-desktop-update-row';

function buildUpdateRow() {
  const row = el('div', '');
  row.id = UPDATE_ROW_ID;
  row.setAttribute('data-slot', 'settings.general.item');
  row.appendChild(el('div', 'dshd-title', 'Harness 更新'));

  const status = el('div', 'dshd-hint', '正在读取当前版本…');
  const checkBtn = el('button', 'dshd-btn', '检查更新');
  const hint = el('div', 'dshd-hint', '');

  let current = null;
  let latest = null;

  const renderStatus = () => {
    const cur = current === null ? '未检测到' : current;
    if (latest === null) {
      status.textContent = `当前 ${cur}`;
      hint.textContent = '';
    } else if (current !== latest) {
      status.textContent = `当前 ${cur} → 官方最新 ${latest}`;
      hint.textContent = '官方已出新版。请安装维护者发布的新桌面版；应用不会在本机临时下载或重建 Harness。';
    } else {
      status.textContent = `已是最新（${cur}）`;
      hint.textContent = '';
    }
  };

  const doCheck = async () => {
    checkBtn.disabled = true;
    status.textContent = '正在检查官方最新版本…';
    const r = await ipcRenderer.invoke('update:check');
    checkBtn.disabled = false;
    if (!r || !r.ok) {
      status.textContent = '检查失败：' + ((r && r.message) || '未知错误');
      hint.textContent = '';
      return;
    }
    current = r.current;
    latest = r.latest;
    renderStatus();
  };

  checkBtn.addEventListener('click', doCheck);

  row.appendChild(status);
  row.appendChild(checkBtn);
  row.appendChild(hint);

  // Prime the status line once, quietly.
  ipcRenderer.invoke('update:check').then((r) => {
    if (r && r.ok) {
      current = r.current;
      latest = r.latest;
      renderStatus();
    }
  }).catch(() => { /* leave the placeholder text */ });

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
  copy.appendChild(el('div', 'dshd-hint', '目录来自 dsh-market 使用的 curated 插件索引。安装前会备份 web profile，插件变更后需要重启桌面端。'));
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
    restart.title = '安装或卸载完成后重新加载 Harness 插件树';
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
      text: activeBundle === false ? `${text} · 未声明为 bundle` : text
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
      if (item.source) meta.appendChild(el('span', 'dsh-plugin-card-source', item.source === 'npm' ? 'npm tarball' : 'GitHub source'));
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
      const existing = installedByName.get(item.installSpec) || installedByName.get(item.name);
      const install = el('button', 'dshd-btn', existing ? '已安装' : '安装');
      install.disabled = Boolean(existing);
      const cardStatus = el('div', 'dshd-plugin-card-status');
      install.addEventListener('click', async () => {
        install.disabled = true;
        install.textContent = '安装中…';
        setStatus(`正在安装 ${item.name}，请勿关闭桌面端。`);
        setCardStatus(card, cardStatus, 'working', `正在从 ${item.source === 'npm' ? 'npm' : 'GitHub'} 获取插件并备份 web profile…`);
        const response = await ipcRenderer.invoke('plugins:install', item.installSpec);
        if (!response || !response.ok) {
          const message = (response && response.message) || '安装失败，请稍后重试。';
          setStatus('安装未完成，请查看对应插件的提示。', true);
          setCardStatus(card, cardStatus, 'error', message);
          install.disabled = false;
          install.textContent = '重试安装';
          return;
        }
        install.textContent = '已安装';
        setStatus(`已安装 ${item.name}。需要重启桌面端。`);
        setCardStatus(card, cardStatus, 'success', '安装完成。重启桌面端后会加载这个插件。');
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
    setStatus('正在读取 dsh-market curated 插件目录…');
    renderEmpty(marketplaceList, '正在搜索…');
    const response = await ipcRenderer.invoke('plugins:search', search.value);
    searchButton.disabled = false;
    if (!response || !response.ok) {
      renderEmpty(marketplaceList, '仓库索引读取失败。');
      setStatus((response && response.message) || '仓库索引读取失败', true);
      return;
    }
    renderMarketplace(response.items || []);
    setStatus(`搜索完成，找到 ${(response.items || []).length} 个插件。`);
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
    injectRow(UPDATE_ROW_ID, buildUpdateRow);
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
const DEFAULT_BROWSER_URL = 'https://api-docs.deepseek.com/zh-cn/guides/vision/';

const TOOLS_CSS = `
#${TOOLS_LAUNCHER_ID} {
  position: fixed;
  z-index: 2147483640;
  right: 12px;
  bottom: 48px;
  display: flex;
  padding: 3px;
  border: 1px solid rgba(215, 219, 227, .94);
  border-radius: 6px;
  background: rgba(255, 255, 255, .96);
  box-shadow: 0 4px 14px rgba(29, 36, 53, .18);
}
#${TOOLS_LAUNCHER_ID} { flex-direction: column; gap: 2px; }
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
  grid-template-rows: 48px 48px minmax(0, 1fr);
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
.dshd-tool-expand { width: 30px; height: 30px; border: 1px solid #dfe3e9; border-radius: 4px; color: #596172; background: #fff; cursor: pointer; font-size: 16px; }
.dshd-tool-expand:hover { color: #4d6bfe; background: #edf0ff; border-color: #bdc6ff; }
.dshd-browser-resize-rail {
  position: absolute;
  z-index: 2;
  left: 0;
  top: 96px;
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
.dshd-browser-chrome {
  display: grid;
  grid-template-columns: 34px 34px 34px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  background: #fafbfc;
  border-bottom: 1px solid #dfe3e9;
}
.dshd-browser-chrome button { height: 34px; min-width: 34px; border: 1px solid #dfe3e9; border-radius: 4px; color: #4e5665; background: #fff; cursor: pointer; font-size: 17px; }
.dshd-browser-chrome button:last-child { padding: 0 12px; color: #fff; background: #4d6bfe; border-color: #4d6bfe; font-size: 12px; font-weight: 650; }
.dshd-browser-chrome button:disabled { opacity: .38; cursor: default; }
.dshd-browser-url { min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #d7dbe3; border-radius: 4px; color: #404755; background: #fff; font-size: 12px; }
a[data-dsh-browser-link] { cursor: pointer; text-decoration: underline; text-decoration-color: currentColor; text-underline-offset: 3px; }
`;

let toolsShell = null;
let toolsLauncher = null;
let toolMode = 'closed';
let browserUrl = DEFAULT_BROWSER_URL;
let browserState = { open: false };
let openBrowserPanel = null;
let openPluginCenter = null;
let closeBrowserPanel = null;
let browserPanelWidth = 0;

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
  close.addEventListener('click', closePanel);
  openPluginCenter = () => {
    if (closeBrowserPanel) closeBrowserPanel();
    panel.hidden = false;
    if (toolsLauncher) toolsLauncher.hidden = false;
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
  ipcRenderer.invoke('browser:layout', {
    left: panelLeft + TOOLS_RESIZE_RAIL_WIDTH,
    top: 96,
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
  const launchBrowser = toolButton('◫', '', '显示/隐藏侧边面板（Ctrl+Alt+B）');
  launchBrowser.setAttribute('aria-label', '显示/隐藏侧边面板');
  launcher.appendChild(launchBrowser);
  const launchPlugins = toolButton('🧩', '', '打开插件中心');
  launchPlugins.setAttribute('aria-label', '打开插件中心');
  launcher.appendChild(launchPlugins);

  const shell = el('aside', '');
  shell.id = TOOLS_SHELL_ID;
  shell.hidden = true;
  const head = el('header', 'dshd-tool-head');
  const title = el('strong', '', '浏览器');
  const meta = el('span', 'dshd-tool-meta dshd-browser-state', '准备就绪');
  const expand = toolButton('⇱', 'dshd-tool-expand', '展开 / 恢复浏览器宽度');
  const close = toolButton('×', 'dshd-tool-close', '关闭内置浏览器');
  head.appendChild(title);
  head.appendChild(meta);
  head.appendChild(expand);
  head.appendChild(close);

  const chrome = el('div', 'dshd-browser-chrome');
  const resizeRail = el('div', 'dshd-browser-resize-rail');
  resizeRail.setAttribute('aria-label', '拖动调整浏览器宽度');
  const back = toolButton('‹', '', '后退');
  const forward = toolButton('›', '', '前进');
  const reload = toolButton('↻', '', '刷新');
  const address = el('input', 'dshd-browser-url');
  address.type = 'text';
  address.value = browserUrl;
  address.setAttribute('aria-label', '网址');
  const open = toolButton('打开', '');
  chrome.appendChild(back);
  chrome.appendChild(forward);
  chrome.appendChild(reload);
  chrome.appendChild(address);
  chrome.appendChild(open);

  shell.appendChild(head);
  shell.appendChild(chrome);
  shell.appendChild(resizeRail);
  document.body.appendChild(launcher);
  document.body.appendChild(shell);
  toolsLauncher = launcher;
  toolsShell = shell;

  const updateBrowserState = (nextState) => {
    browserState = nextState || { open: false };
    if (browserState.url && /^https?:/i.test(browserState.url)) {
      browserUrl = browserState.url;
      address.value = browserUrl;
    }
    back.disabled = !browserState.canGoBack;
    forward.disabled = !browserState.canGoForward;
    const loading = Boolean(browserState.loading);
    meta.classList.toggle('loading', loading);
    meta.classList.toggle('error', Boolean(browserState.error));
    meta.textContent = browserState.error || (loading ? '正在加载…' : (browserState.title || '隔离网页内容'));
    meta.title = browserState.url || '';
  };

  const setMode = async (mode, nextUrl) => {
    if (mode !== 'browser') return;
    toolMode = 'browser';
    if (nextUrl) browserUrl = nextUrl;
    address.value = browserUrl;
    shell.hidden = false;
    launcher.hidden = true;
    setToolsLayout();
    const result = await ipcRenderer.invoke('browser:open', browserUrl);
    setToolsLayout();
    if (!result || !result.ok) {
      meta.classList.remove('loading');
      meta.textContent = (result && result.message) || '浏览器打开失败';
      return result;
    }
    updateBrowserState(result);
    return result;
  };

  openBrowserPanel = (nextUrl) => {
    const pluginPanel = document.getElementById('dshd-plugin-center');
    if (pluginPanel) pluginPanel.hidden = true;
    return setMode('browser', nextUrl);
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

  const navigate = () => setMode('browser', address.value.trim() || DEFAULT_BROWSER_URL);

  launchBrowser.addEventListener('click', () => {
    if (toolMode === 'browser' && !shell.hidden) closeTools();
    else openBrowserPanel(browserUrl);
  });
  close.addEventListener('click', closeTools);
  open.addEventListener('click', navigate);
  address.addEventListener('keydown', (event) => { if (event.key === 'Enter') navigate(); });
  back.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:back')));
  forward.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:forward')));
  reload.addEventListener('click', async () => updateBrowserState(await ipcRenderer.invoke('browser:reload')));
  window.addEventListener('resize', setToolsLayout);
  ipcRenderer.on('browser:state', (_event, nextState) => updateBrowserState(nextState));
  ipcRenderer.on('browser:request-open', (_event, url) => {
    if (/^https?:\/\//i.test(String(url || ''))) openBrowserPanel(url).catch(() => {});
  });
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      if (toolMode === 'browser' && !shell.hidden) closeTools();
      else openBrowserPanel(browserUrl);
    }
  });
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

  const markExternalLinks = (root = document) => {
    const anchors = [];
    if (root && root.matches && root.matches('a[href]')) anchors.push(root);
    if (root && root.querySelectorAll) anchors.push(...root.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      if (anchor.closest(`#${TOOLS_LAUNCHER_ID}, #${TOOLS_SHELL_ID}, [data-dsh-plugin-settings], #${ROW_ID}, #${UPDATE_ROW_ID}`)) continue;
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
    if (anchor.closest(`#${TOOLS_LAUNCHER_ID}, #${TOOLS_SHELL_ID}, [data-dsh-plugin-settings], #${ROW_ID}, #${UPDATE_ROW_ID}`)) return;
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
