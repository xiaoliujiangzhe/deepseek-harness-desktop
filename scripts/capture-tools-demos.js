'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const demos = [
  'tools-direction-a-sidebar-native',
  'tools-direction-b-workspace-tabs',
  'tools-direction-c-split-workbench'
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.setPath('userData', path.join(__dirname, '..', 'design-demos', '.electron-user-data'));

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..', 'design-demos');
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, sandbox: false, nodeIntegration: false, contextIsolation: true }
  });
  for (const name of demos) {
    await window.loadURL(pathToFileURL(path.join(root, `${name}.html`)).href);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(root, `${name}.png`), image.toPNG());
  }
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
