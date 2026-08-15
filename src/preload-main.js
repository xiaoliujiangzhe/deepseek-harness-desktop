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
  if (inner) inner.style.backgroundImage = `url("${a.background}")`;
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
  opacity.value = String(state.opacity === undefined ? 0.5 : state.opacity);
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
  row.appendChild(field('界面透明度（越低越透）', opacity, '默认 0.5，调到 0.2 左右图片就很清楚'));
  row.appendChild(field('界面字体', fontFamily));
  row.appendChild(field('字号', fontSize));
  row.appendChild(field('布局密度', density));
  row.appendChild(field('强调色', accentRow));
  row.appendChild(field('自定义 CSS', cssArea, '改字体、背景、配色等；保存后实时生效'));

  return row;
}

// ---------- injection ----------

function tryInject() {
  try {
    if (document.getElementById(ROW_ID)) return;
    const anchors = document.querySelectorAll('[data-slot="settings.general.item"]');
    if (anchors.length === 0) return;
    const anchor = anchors[anchors.length - 1];
    const section = anchor.parentElement;
    if (!section) return;
    section.appendChild(buildRow());
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
