'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startService } = require('./server');

const APP_NAME = 'DeepSeek Harness';
const LOADING_WINDOW_SIZE = { width: 480, height: 340 };
const MAIN_WINDOW_DEFAULT_SIZE = { width: 1360, height: 860 };

let loadingWindow = null;
let mainWindow = null;
let tray = null;
let service = null;
let quitting = false;
let cleanedUp = false;
let currentWorkspace = null;

// Required on Windows for correct tray-icon / taskbar grouping.
app.setAppUserModelId('com.dsh.desktop');

/** Load user settings from the per-user data directory. */
function loadSettings() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  const defaults = {
    workspace: os.homedir(),
    port: 0 // 0 = let the OS pick a free port
  };
  try {
    if (fs.existsSync(file)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  } catch {
    /* fall through to defaults */
  }
  return defaults;
}

function ensureWorkspaceDir(workspace) {
  try {
    if (workspace && fs.existsSync(workspace)) return workspace;
  } catch {
    /* ignore */
  }
  return os.homedir();
}

function sendToLoading(channel, payload) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send(channel, payload);
  }
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: LOADING_WINDOW_SIZE.width,
    height: LOADING_WINDOW_SIZE.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    center: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  loadingWindow.loadFile(path.join(__dirname, 'loading.html'));
  loadingWindow.once('ready-to-show', () => loadingWindow && loadingWindow.show());

  // Clicking an external link opens in the default browser instead of the splash.
  loadingWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  loadingWindow.on('closed', () => {
    loadingWindow = null;
  });
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.show();
  }
}

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(APP_NAME);

  const menu = Menu.buildFromTemplate([
    { label: '显示 DeepSeek Harness', click: () => showMainWindow() },
    {
      label: '打开工作目录',
      click: () => {
        if (currentWorkspace) shell.openPath(currentWorkspace);
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);

  // Left-click toggles show/hide; double-click also shows.
  tray.on('click', () => toggleMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_DEFAULT_SIZE.width,
    height: MAIN_WINDOW_DEFAULT_SIZE.height,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // The dsh web UI opens links/new windows; keep them inside the shell when they
  // are same-origin, and hand external ones to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const current = mainWindow.webContents.getURL();
    try {
      if (new URL(targetUrl).origin !== new URL(current).origin) {
        event.preventDefault();
        shell.openExternal(targetUrl);
      }
    } catch {
      /* ignore malformed URLs */
    }
  });

  // Lock the window title. The dsh web UI rewrites `document.title` to
  // "<session title> — DeepSeek Harness"; keep our clean app title instead.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
    if (mainWindow) mainWindow.show();
    if (mainWindow) mainWindow.focus();
  });

  // Close-to-tray: closing the window hides it (service keeps running);
  // the app only exits via the tray "退出" item.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

function showStartupError(error) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    sendToLoading('startup:error', {
      message: error.message || '启动失败',
      detail: error.detail || ''
    });
    return;
  }
  dialog.showErrorBox('DeepSeek Harness 启动失败', error.message || '未知错误');
}

function launchService() {
  const settings = loadSettings();
  const workspace = ensureWorkspaceDir(settings.workspace);
  const port = Number.isFinite(Number(settings.port)) ? Number(settings.port) : 0;
  currentWorkspace = workspace;

  sendToLoading('startup:progress', { pct: 3, label: '正在解析运行环境…' });

  service = startService({
    port,
    cwd: workspace,
    env: {},
    onProgress: (s) => sendToLoading('startup:progress', s),
    onReady: (url) => createMainWindow(url),
    onError: (err) => showStartupError(err),
    onExit: (code, signal) => {
      // If the service died after the window was shown (e.g. the user killed
      // it), close the app rather than leaving a dead window behind.
      if (!quitting) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showErrorBox(APP_NAME, `本地服务已退出（code ${code ?? '?'}${signal ? `, ${signal}` : ''}）。`);
        }
        app.quit();
      }
    }
  });
}

/** Ask the user to pick a workspace folder (used by the error screen action). */
function chooseWorkspace() {
  const chosen = dialog.showOpenDialogSync({
    title: '选择 DeepSeek Harness 工作目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (chosen && chosen[0]) {
    const settings = loadSettings();
    settings.workspace = chosen[0];
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2));
    if (service) service.stop().then(() => {});
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.webContents.send('startup:reset');
    }
    setTimeout(launchService, 300);
  }
}

// --- IPC from the loading renderer ---
ipcMain.handle('startup:choose-workspace', () => chooseWorkspace());
ipcMain.handle('startup:retry', () => {
  const relaunch = () => {
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.webContents.send('startup:reset');
    }
    setTimeout(launchService, 250);
  };
  if (service) {
    service.stop().then(relaunch);
  } else {
    relaunch();
  }
});
ipcMain.handle('startup:get-state', () => ({
  appName: APP_NAME
}));

// --- App lifecycle ---

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    createTray();
    createLoadingWindow();
    launchService();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', (event) => {
    if (service && !cleanedUp) {
      event.preventDefault();
      cleanedUp = true;
      service.stop().then(() => app.quit());
    }
  });

  app.on('activate', () => {
    if (mainWindow || loadingWindow) {
      showMainWindow();
    } else {
      createLoadingWindow();
      launchService();
    }
  });
}
