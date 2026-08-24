'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const demos = [
  'direction-a-signal-white',
  'direction-b-blue-depth',
  'direction-c-builder-notebook'
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');
app.setPath('userData', path.join(__dirname, '..', 'design-demos', '.electron-user-data'));

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..', 'design-demos');
  const win = new BrowserWindow({
    width: 480,
    height: 340,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, sandbox: false, nodeIntegration: false, contextIsolation: true }
  });

  for (const name of demos) {
    await win.loadURL(pathToFileURL(path.join(root, `${name}.html`)).href);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(root, `${name}.png`), image.toPNG());
  }

  win.destroy();
  app.quit();
});
