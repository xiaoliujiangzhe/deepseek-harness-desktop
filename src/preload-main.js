'use strict';

/**
 * Main-window preload: injects the user's appearance CSS (accent overrides +
 * custom CSS) into the DeepSeek Harness web UI, and keeps it in sync live.
 */
const { ipcRenderer } = require('electron');

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

/** amt < 0 darkens, amt > 0 lightens. */
function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

function buildCss(a) {
  a = a || {};
  let css = '';
  if (a.accent) {
    const c = a.accent;
    const hover = shade(c, -0.12);
    css += `
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
  if (a.customCss) {
    css += `\n/* --- DeepSeek Harness Desktop custom CSS --- */\n${a.customCss}\n`;
  }
  return css;
}

let styleEl = null;

function apply(a) {
  const css = buildCss(a);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dsh-desktop-appearance';
    (document.head || document.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = css;
}

ipcRenderer.invoke('appearance:get').then(apply).catch(() => {});
ipcRenderer.on('appearance:update', (_event, a) => apply(a));
