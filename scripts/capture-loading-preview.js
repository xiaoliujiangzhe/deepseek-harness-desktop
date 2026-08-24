'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.setPath('userData', path.join(__dirname, '..', 'design-demos', '.loading-preview-user-data'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 480,
    height: 340,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: true }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'loading.html'));
  await win.webContents.executeJavaScript(`
    document.getElementById('error').hidden = true;
    document.getElementById('startup').hidden = false;
    document.getElementById('stage').classList.remove('has-error');
    document.getElementById('mascot').classList.remove('is-error');
    document.getElementById('status').textContent = '鲸鱼娘正在偷吃你的白饭';
    document.getElementById('barLabel').textContent = 'PLUGIN TREE';
    document.getElementById('detail').textContent = '加载 Harness 配置与插件';
    document.getElementById('bootStep').textContent = '03 / 06';
    document.getElementById('barPct').textContent = '54%';
    document.getElementById('barFill').style.width = '54%';
    document.querySelectorAll('#ticks i').forEach((tick, index) => tick.classList.toggle('active', index < 6));
  `);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'design-demos', 'loading-whale-girl-preview.png'), image.toPNG());
  win.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
