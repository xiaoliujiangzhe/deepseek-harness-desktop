'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, net } = require('electron');
const { installMarketplacePlugin, listInstalled } = require('../src/plugin-manager');

async function requestBuffer(url, headers = {}, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 45000);
  try {
    const response = await net.fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > (Number(options.maxBytes) || 5 * 1024 * 1024)) throw new Error('response exceeds configured size limit');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson(url, headers, options) {
  return JSON.parse((await requestBuffer(url, headers, options)).toString('utf8'));
}

app.whenReady().then(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-electron-e2e-'));
  try {
    const result = await installMarketplacePlugin({
      name: 'DeepSeek-Balance-Whale-Widget',
      source: 'github',
      installSpec: 'github:MeteorNOX/DeepSeek-Balance-Whale-Widget',
      repositoryUrl: 'https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget'
    }, { home, requestBuffer, requestJson });
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      packageName: result.packageName,
      version: result.version,
      commit: result.commit,
      installed: listInstalled(home)
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    app.quit();
  }
}).catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  app.exit(1);
});
