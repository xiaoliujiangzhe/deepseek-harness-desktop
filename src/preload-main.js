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

function backgroundCss(a) {
  const blur = Number(a.backgroundBlur) || 0;
  const dim = Math.max(0, Math.min(1, Number(a.backgroundDim) || 0));
  let css = `
html, body { background: transparent !important; }
body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image: url("${a.background}");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  filter: blur(${blur}px);
  transform: scale(1.05);
}
`;
  if (dim > 0) {
    css += `
body::after {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  background: rgba(0, 0, 0, ${dim});
}
`;
  }
  // Make the main surfaces translucent so the image shows through (best-effort).
  css += `
:root {
  --dsw-alias-bg-base: rgba(255, 255, 255, 0.88) !important;
  --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.72) !important;
  --dsw-alias-bg-layer-2: rgba(255, 255, 255, 0.6) !important;
  --dsw-alias-bg-layer-3: rgba(255, 255, 255, 0.7) !important;
  --dsw-specific-sidebar-fill: rgba(255, 255, 255, 0.72) !important;
}
body[data-ds-dark-theme] {
  --dsw-alias-bg-base: rgba(16, 18, 27, 0.86) !important;
  --dsw-alias-bg-layer-1: rgba(25, 28, 40, 0.72) !important;
  --dsw-alias-bg-layer-2: rgba(32, 35, 50, 0.6) !important;
  --dsw-alias-bg-layer-3: rgba(34, 37, 52, 0.7) !important;
  --dsw-specific-sidebar-fill: rgba(22, 25, 36, 0.72) !important;
}
`;
  return css;
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
  if (a.background) css += backgroundCss(a);
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

function injectControlsCss() {
  if (document.getElementById('dsh-desktop-controls-css')) return;
  const s = document.createElement('style');
  s.id = 'dsh-desktop-controls-css';
  s.textContent = CONTROLS_CSS;
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
