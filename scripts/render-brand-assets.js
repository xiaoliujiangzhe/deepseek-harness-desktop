'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setPath('userData', path.join(__dirname, '..', 'design-demos', '.icon-electron-user-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = 6 + directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry);
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2);
    directory.writeUInt8(0, entry + 3);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map(({ png }) => png)]);
}

app.whenReady().then(async () => {
  const assets = path.join(__dirname, '..', 'assets');
  const sourcePath = path.join(assets, 'whale.svg');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const renderFile = path.join(__dirname, '..', 'design-demos', '.icon-render.html');
  fs.writeFileSync(renderFile, `<!doctype html><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{display:grid;place-items:center}svg{width:460px;height:460px}</style>${source}`);
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadURL(pathToFileURL(renderFile).href);
  const captured = await window.webContents.capturePage();
  window.destroy();
  if (captured.isEmpty()) {
    fs.rmSync(renderFile, { force: true });
    const existing = ['icon.png', 'tray-icon.png', 'icon.ico'].map((name) => path.join(assets, name));
    if (existing.every((file) => fs.existsSync(file) && fs.statSync(file).size > 0)) {
      console.warn(`Chromium could not rasterize ${sourcePath}; reusing the checked-in brand assets`);
      app.quit();
      return;
    }
    throw new Error(`Chromium could not rasterize ${sourcePath} and no checked-in brand assets are available`);
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => ({
    size,
    png: captured.resize({ width: size, height: size, quality: 'best' }).toPNG()
  }));
  fs.writeFileSync(path.join(assets, 'icon.png'), images.at(-1).png);
  fs.writeFileSync(path.join(assets, 'tray-icon.png'), images.find(({ size }) => size === 32).png);
  fs.writeFileSync(path.join(assets, 'icon.ico'), encodeIco(images));
  fs.rmSync(renderFile, { force: true });
  console.log('rendered official whale assets: icon.png, tray-icon.png, icon.ico');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
