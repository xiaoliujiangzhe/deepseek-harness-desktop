'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, Tray, Menu, nativeImage, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startService, resolveDshBin, resolveDshVersion, resolveNodeExecutable } = require('./server');
const { checkLatest } = require('./update');
const { autoUpdater } = require('electron-updater');
const { DesktopUpdateService, normalizeUpdatePreferences, readPortableNodeVersion } = require('./desktop-updater');
const { migrateHarnessHome } = require('./harness-migration');
const { EmbeddedBrowser, normalizeBrowserUrl } = require('./embedded-browser');
const { LocalPreviewServer } = require('./local-preview-server');
const { isSupportedTextFile, readWorkspaceTextFile, resolveWorkspaceTextFile, writeWorkspaceTextFile } = require('./text-file-editor');
const { installMarketplacePlugin, listInstalled, resetMarketplaceCache, runPluginCommand, runtimePnpmPath, searchMarketplace, setPluginEnabled, updateInstalledPlugin } = require('./plugin-manager');
const { backupConfiguration, buildDiagnosticReport, clearMarketplaceCache, redactSecrets, repairCredentialsVersion } = require('./diagnostics');
const { ensureGeneralChatWorkspace, selectGeneralChatSession } = require('./general-chat');

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
let embeddedBrowser = null;
let pluginOperation = null;
let diagnosticOperation = null;
let localPreview = null;
let desktopUpdater = null;
const dirtyEditorFiles = new Set();

async function fetchDesktopBuffer(url, headers = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const maxBytes = Number(options.maxBytes) || 5 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      headers: { 'user-agent': 'deepseek-harness-desktop', ...headers },
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    const declared = Number(response.headers.get('content-length')) || 0;
    if (declared > maxBytes) throw new Error(`下载内容超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`);
    if (!response.body) return Buffer.from(await response.arrayBuffer());
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        throw new Error(`下载内容超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (controller.signal.aborted && error && error.name === 'AbortError') {
      throw new Error(`网络请求超过 ${Math.ceil(timeoutMs / 1000)} 秒`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function desktopRequestBuffer(url, headers = {}, options = {}) {
  const attempts = Number(options.attempts) || 3;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchDesktopBuffer(url, headers, options);
    } catch (error) {
      lastError = error;
      const message = error && error.message ? error.message : String(error);
      const retryable = /429|ECONNRESET|ETIMEDOUT|fetch failed|network|网络请求超过/i.test(message);
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function desktopRequestJson(url, headers = {}, options = {}) {
  const body = await desktopRequestBuffer(url, headers, options);
  return JSON.parse(body.toString('utf8'));
}

// Required on Windows for correct tray-icon / taskbar grouping.
app.setAppUserModelId('com.dsh.desktop');

/** Load user settings from the per-user data directory. */
function loadSettings() {
  const file = path.join(app.getPath('userData'), 'settings.json');
  const defaults = {
    workspace: os.homedir(),
    port: 0, // 0 = let the OS pick a free port
    appearance: {
      accent: '',
      customCss: '',
      background: '',
      backgroundBlur: 0,
      backgroundDim: 0,
      opacity: 0.7,
      fontFamily: '',
      fontSize: '',
      density: ''
    },
    browser: { version: 3, tabs: [], activeIndex: 0, bookmarks: [], history: [] },
    update: { mode: 'default', channel: 'stable', skippedVersion: '' }
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

/** Persist settings to the per-user data directory. */
function writeSettings(settings) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(settings, null, 2));
}

function updatePreferences() {
  return normalizeUpdatePreferences(loadSettings().update);
}

function saveUpdatePreferences(preferences) {
  const settings = loadSettings();
  settings.update = normalizeUpdatePreferences(preferences);
  writeSettings(settings);
}

function currentDesktopComponents() {
  const nodePath = resolveNodeExecutable();
  const pnpmDir = runtimePnpmPath();
  return {
    harness: resolveDshVersion(),
    node: readPortableNodeVersion(nodePath),
    pnpm: pnpmDir ? (() => {
      try {
        const candidates = [path.join(pnpmDir, 'package.json'), path.join(pnpmDir, 'package', 'package.json')];
        for (const file of candidates) {
          if (!fs.existsSync(file)) continue;
          const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
          if (typeof version === 'string') return version;
        }
      } catch { /* ignore unreadable runtime metadata */ }
      return null;
    })() : null
  };
}

function setupDesktopUpdater() {
  if (desktopUpdater) return desktopUpdater;
  desktopUpdater = new DesktopUpdateService({
    app,
    autoUpdater,
    getPreferences: updatePreferences,
    savePreferences: saveUpdatePreferences,
    components: currentDesktopComponents(),
    onState: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-update:state', state);
    }
  });
  desktopUpdater.initialize();
  return desktopUpdater;
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
    {
      label: '开发者工具',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
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
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const requestEmbeddedBrowser = (targetUrl) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:request-open', targetUrl);
    }
  };

  // Same-origin routes stay in Harness. External pages are opened by the
  // isolated WebContentsView after the preload reveals its browser panel.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    requestEmbeddedBrowser(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const current = mainWindow.webContents.getURL();
    try {
      if (new URL(targetUrl).origin !== new URL(current).origin) {
        event.preventDefault();
        requestEmbeddedBrowser(targetUrl);
      }
    } catch {
      /* ignore malformed URLs */
    }
  });

  // Harness resolves file references to absolute paths immediately before it
  // calls host.openPath. Capture supported previews in the page's main world
  // so the desktop shell receives the exact file instead of guessing a cwd.
  const installFilePreviewBridge = () => {
    const script = `(() => {
      if (window.__dshDesktopFilePreviewBridge) return;
      window.__dshDesktopFilePreviewBridge = true;
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        try {
          const requestUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
          const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          if (method === 'POST' && requestUrl.origin === location.origin && requestUrl.pathname === '/api/host.openPath') {
            const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
            const file = body && body.method === 'host.openPath' && body.payload && body.payload.path;
            const supported = typeof file === 'string' && (/\\.html?$/i.test(file.trim()) || /(?:^|[\\\\/])(?:Dockerfile|Makefile|README|LICENSE)$/i.test(file.trim()) || /\\.(?:bat|c|cc|cfg|cjs|cmd|conf|cpp|cs|css|csv|dockerignore|editorconfig|env|gitattributes|gitignore|go|graphql|gql|h|hpp|ini|java|js|json|jsonc|jsx|less|log|lua|md|markdown|mjs|npmrc|php|properties|ps1|py|rb|rs|scss|sh|sql|svelte|toml|ts|tsx|txt|vue|xml|yaml|yml)$/i.test(file.trim()));
            if (supported) {
              window.postMessage({ type: 'dsh-desktop-file-path-v1', path: file }, location.origin);
              return new Response(JSON.stringify({
                type: 'server-response',
                rpcId: body.rpcId,
                result: { ok: true, value: { opened: true } }
              }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
          }
        } catch {}
        return nativeFetch(input, init);
      };
    })()`;
    mainWindow.webContents.executeJavaScript(script).catch(() => {});
  };
  mainWindow.webContents.on('did-finish-load', installFilePreviewBridge);

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
    if (embeddedBrowser) embeddedBrowser.destroy();
    embeddedBrowser = null;
    mainWindow = null;
  });

  embeddedBrowser = new EmbeddedBrowser({
    WebContentsView,
    dialog,
    hostWindow: mainWindow,
    onState: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('browser:state', state);
    },
    onPersist: (browser) => {
      const settings = loadSettings();
      settings.browser = browser;
      writeSettings(settings);
    }
  });

  embeddedBrowser.restore(loadSettings().browser).catch(() => {});

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

  const harnessVersion = resolveDshVersion();
  if (harnessVersion) {
    try {
      const migration = migrateHarnessHome({
        home: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
        targetVersion: harnessVersion
      });
      if (migration.migrated) {
        sendToLoading('startup:progress', {
          pct: 6,
          label: `已备份旧版 Harness 运行目录，正在升级到 ${harnessVersion}…`
        });
      }
    } catch (error) {
      showStartupError({
        message: 'Harness 升级迁移失败',
        detail: `${error.message}\n\n请先退出所有 dsh / DeepSeek Harness 进程后重试。`
      });
      return;
    }
  }

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

// The Web UI still requires every session to belong to a Workspace. The
// desktop shell keeps that implementation detail behind a dedicated private
// directory so users can start a general conversation without choosing a
// project folder.
ipcMain.handle('general-chat:workspace', () => ensureGeneralChatWorkspace(app.getPath('userData')));
ipcMain.handle('general-chat:select-session', (_event, summaries, workspaceSessionIds, preferredSessionId) => (
  selectGeneralChatSession(summaries, workspaceSessionIds, preferredSessionId)
));

// --- IPC for the appearance feature ---
ipcMain.handle('appearance:get', () => loadSettings().appearance);
ipcMain.handle('appearance:save', (_event, appearance) => {
  const settings = loadSettings();
  settings.appearance = {
    accent: (appearance && appearance.accent) || '',
    customCss: (appearance && appearance.customCss) || '',
    background: (appearance && appearance.background) || '',
    backgroundBlur: Number(appearance && appearance.backgroundBlur) || 0,
    backgroundDim: Number(appearance && appearance.backgroundDim) || 0,
    opacity: appearance && appearance.opacity !== undefined ? Number(appearance.opacity) : 0.7,
    fontFamily: (appearance && appearance.fontFamily) || '',
    fontSize: (appearance && appearance.fontSize) || '',
    density: (appearance && appearance.density) || ''
  };
  writeSettings(settings);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('appearance:update', settings.appearance);
  }
  return settings.appearance;
});

// --- IPC for the harness version check ---
ipcMain.handle('update:check', async () => {
  try {
    return { ok: true, ...(await checkLatest()) };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : String(error) };
  }
});
ipcMain.handle('desktop-update:state', () => setupDesktopUpdater().snapshot());
ipcMain.handle('desktop-update:check', () => setupDesktopUpdater().check(true));
ipcMain.handle('desktop-update:download', () => setupDesktopUpdater().download());
ipcMain.handle('desktop-update:skip', () => setupDesktopUpdater().skipAvailableVersion());
ipcMain.handle('desktop-update:unskip', () => setupDesktopUpdater().clearSkippedVersion());
ipcMain.handle('desktop-update:install', () => ({ ok: setupDesktopUpdater().quitAndInstall() }));
ipcMain.handle('desktop-update:preferences', (_event, preferences) => setupDesktopUpdater().applyPreferences(preferences));

// --- IPC for desktop plugin management ---
ipcMain.handle('plugins:list', () => ({ ok: true, items: listInstalled() }));
ipcMain.handle('plugins:search', async (_event, query) => {
  try {
    const result = await searchMarketplace(query, { requestJson: desktopRequestJson });
    return { ok: true, ...result };
  }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});

async function mutatePlugin(action, spec) {
  if (pluginOperation) return { ok: false, message: '另一个插件操作正在进行' };
  pluginOperation = runPluginCommand(action, String(spec || ''));
  try { return { ok: true, ...(await pluginOperation) }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
  finally { pluginOperation = null; }
}

ipcMain.handle('plugins:install', async (_event, item) => {
  if (pluginOperation) return { ok: false, message: '另一个插件操作正在进行' };
  pluginOperation = installMarketplacePlugin(item, {
    requestJson: desktopRequestJson,
    requestBuffer: desktopRequestBuffer
  });
  try { return { ok: true, ...(await pluginOperation) }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
  finally { pluginOperation = null; }
});
ipcMain.handle('plugins:remove', (_event, name) => mutatePlugin('remove', name));
ipcMain.handle('plugins:toggle', (_event, name, enabled) => {
  if (pluginOperation) return { ok: false, message: '另一个插件操作正在进行' };
  try { return { ok: true, ...setPluginEnabled(String(name || ''), Boolean(enabled)) }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('plugins:update', async (_event, name) => {
  if (pluginOperation) return { ok: false, message: '另一个插件操作正在进行' };
  pluginOperation = updateInstalledPlugin(String(name || ''), {
    requestJson: desktopRequestJson,
    requestBuffer: desktopRequestBuffer
  });
  try { return { ok: true, ...(await pluginOperation) }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
  finally { pluginOperation = null; }
});

async function diagnosticNetworkCheck(id, label, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await net.fetch(url, { method: 'HEAD', signal: controller.signal });
    return { id, label, ok: response.ok, summary: response.ok ? `可访问 · HTTP ${response.status}` : `HTTP ${response.status}` };
  } catch (error) {
    return { id, label, ok: false, summary: error && error.name === 'AbortError' ? '连接超时' : '无法连接' };
  } finally { clearTimeout(timer); }
}

async function runDesktopDiagnostics() {
  const settings = loadSettings();
  const pnpmDir = runtimePnpmPath();
  const networkChecks = await Promise.all([
    diagnosticNetworkCheck('network-deepseek', 'DeepSeek API 文档', 'https://api-docs.deepseek.com/'),
    diagnosticNetworkCheck('network-github', 'GitHub', 'https://github.com/'),
    diagnosticNetworkCheck('network-plugin-market', '插件目录', 'https://awesome-dsh-plugin.com/plugins.json')
  ]);
  return buildDiagnosticReport({
    appVersion: app.getVersion(),
    home: process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    workspace: ensureWorkspaceDir(settings.workspace),
    nodePath: resolveNodeExecutable(),
    dshBin: resolveDshBin(),
    harnessVersion: resolveDshVersion(),
    pnpmPath: pnpmDir && path.join(pnpmDir, 'pnpm.cmd'),
    networkChecks,
    serviceReady: Boolean(service && service.ready),
    serviceUrl: service && service.url,
    proxyEnabled: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY)
  });
}

ipcMain.handle('diagnostics:run', async () => {
  if (diagnosticOperation) return diagnosticOperation;
  diagnosticOperation = runDesktopDiagnostics().then((report) => ({ ok: true, report }), (error) => ({ ok: false, message: error && error.message ? error.message : String(error) })).finally(() => { diagnosticOperation = null; });
  return diagnosticOperation;
});
ipcMain.handle('diagnostics:repair', (_event, action) => {
  try {
    if (action === 'credentials-version') return { ok: true, ...repairCredentialsVersion() };
    if (action === 'backup-config') return { ok: true, ...backupConfiguration() };
    if (action === 'clear-marketplace-cache') {
      const result = clearMarketplaceCache();
      resetMarketplaceCache();
      return { ok: true, ...result };
    }
    throw new Error('不支持的修复操作');
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('diagnostics:export', async (_event, report) => {
  try {
    const selected = dialog.showSaveDialogSync(mainWindow, {
      title: '导出脱敏诊断报告',
      defaultPath: `dsh-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!selected) return { ok: false, cancelled: true, message: '已取消导出' };
    const safe = redactSecrets(JSON.stringify(report && typeof report === 'object' ? report : {}, null, 2));
    fs.writeFileSync(selected, `${safe}\n`, 'utf8');
    return { ok: true, path: selected };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('desktop:restart', () => {
  app.relaunch();
  app.quit();
  return true;
});

// --- IPC for the isolated embedded browser ---
ipcMain.handle('browser:state', () => embeddedBrowser ? embeddedBrowser.state() : { open: false });
ipcMain.handle('browser:show', () => embeddedBrowser ? embeddedBrowser.show() : { open: false });
ipcMain.handle('browser:open', async (_event, url) => {
  try {
    if (!embeddedBrowser) throw new Error('桌面浏览器尚未初始化');
    return { ok: true, ...(await embeddedBrowser.open(url)) };
  }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:tab-new', async (_event, url) => {
  try {
    if (!embeddedBrowser) throw new Error('桌面浏览器尚未初始化');
    return { ok: true, ...(await embeddedBrowser.open(url, { newTab: true })) };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:tab-switch', (_event, id) => {
  try { return { ok: true, ...embeddedBrowser.switchTab(String(id || '')) }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:tab-close', (_event, id) => embeddedBrowser ? embeddedBrowser.closeTab(String(id || '')) : { open: false, tabs: [] });
ipcMain.handle('browser:layout', (_event, bounds) => {
  if (!embeddedBrowser) return { ok: false };
  embeddedBrowser.layout(bounds || {});
  return { ok: true };
});
ipcMain.handle('browser:back', () => embeddedBrowser ? embeddedBrowser.back() : { open: false });
ipcMain.handle('browser:forward', () => embeddedBrowser ? embeddedBrowser.forward() : { open: false });
ipcMain.handle('browser:reload', () => embeddedBrowser ? embeddedBrowser.reload() : { open: false });
ipcMain.handle('browser:find', (_event, query, options) => embeddedBrowser ? embeddedBrowser.find(query, options || {}) : { open: false });
ipcMain.handle('browser:find-stop', (_event, action) => embeddedBrowser ? embeddedBrowser.stopFind(action) : { open: false });
ipcMain.handle('browser:zoom', (_event, delta) => embeddedBrowser ? embeddedBrowser.zoom(Number(delta)) : { open: false });
ipcMain.handle('browser:selection', async () => {
  try {
    if (!embeddedBrowser) throw new Error('桌面浏览器尚未初始化');
    return { ok: true, ...(await embeddedBrowser.selection()) };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:screenshot', async () => {
  try {
    if (!embeddedBrowser) throw new Error('桌面浏览器尚未初始化');
    return { ok: true, ...(await embeddedBrowser.screenshot()) };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:download-open', async (_event, id) => {
  const item = embeddedBrowser ? embeddedBrowser.download(id) : null;
  if (!item || item.state !== 'completed' || !fs.existsSync(item.path)) return { ok: false, message: '下载文件不存在或尚未完成' };
  const message = await shell.openPath(item.path);
  return message ? { ok: false, message } : { ok: true };
});
ipcMain.handle('browser:download-show', (_event, id) => {
  const item = embeddedBrowser ? embeddedBrowser.download(id) : null;
  if (!item || !fs.existsSync(item.path)) return { ok: false, message: '下载文件不存在' };
  shell.showItemInFolder(item.path);
  return { ok: true };
});
ipcMain.handle('browser:download-retry', (_event, id) => {
  try {
    const item = embeddedBrowser ? embeddedBrowser.download(id) : null;
    const tab = embeddedBrowser && embeddedBrowser.activeTab();
    if (!item || !tab) throw new Error('找不到可重试的下载');
    tab.view.webContents.downloadURL(normalizeBrowserUrl(item.url));
    return { ok: true };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:downloads-clear', () => embeddedBrowser ? embeddedBrowser.clearDownloads() : { open: false });
ipcMain.handle('browser:library', () => embeddedBrowser ? { ok: true, ...embeddedBrowser.libraryState() } : { ok: false, message: '桌面浏览器尚未初始化' });
ipcMain.handle('browser:bookmark-toggle', () => {
  try { return embeddedBrowser ? { ok: true, ...embeddedBrowser.toggleBookmark() } : { ok: false, message: '桌面浏览器尚未初始化' }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:bookmark-remove', (_event, url) => {
  try { return embeddedBrowser ? { ok: true, ...embeddedBrowser.removeBookmark(url) } : { ok: false, message: '桌面浏览器尚未初始化' }; }
  catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:history-clear', () => embeddedBrowser ? { ok: true, ...embeddedBrowser.clearHistory() } : { ok: false, message: '桌面浏览器尚未初始化' });
ipcMain.handle('browser:open-external', async () => {
  const state = embeddedBrowser ? embeddedBrowser.state() : { url: '' };
  try {
    const url = normalizeBrowserUrl(state.url);
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('browser:hide', () => embeddedBrowser ? embeddedBrowser.hide() : { open: false });
ipcMain.handle('browser:close', () => embeddedBrowser ? embeddedBrowser.close() : { open: false });
ipcMain.handle('preview:open', async (_event, file) => {
  try {
    if (!currentWorkspace) throw new Error('当前工作区尚未初始化');
    if (!localPreview || localPreview.workspace !== path.resolve(currentWorkspace)) {
      if (localPreview) await localPreview.stop();
      localPreview = new LocalPreviewServer(currentWorkspace);
    }
    return { ok: true, url: await localPreview.previewUrl(file), file: String(file || '') };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('editor:open', (_event, file) => {
  try {
    if (!isSupportedTextFile(file)) throw new Error('该文件类型不支持内置编辑');
    return { ok: true, ...readWorkspaceTextFile(currentWorkspace, file) };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('editor:pick', async () => {
  try {
    if (!currentWorkspace) throw new Error('当前工作区尚未初始化');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开工作区文本文件',
      defaultPath: currentWorkspace,
      properties: ['openFile'],
      filters: [
        { name: '文本和代码文件', extensions: ['txt', 'md', 'json', 'jsonc', 'yaml', 'yml', 'js', 'jsx', 'ts', 'tsx', 'css', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'sh', 'ps1', 'bat', 'cmd', 'xml', 'toml', 'ini', 'cfg', 'conf', 'log', 'sql', 'vue', 'svelte'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
    return { ok: true, ...readWorkspaceTextFile(currentWorkspace, result.filePaths[0]) };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('editor:save', (_event, request) => {
  try {
    const result = writeWorkspaceTextFile(currentWorkspace, request || {});
    if (result.ok) dirtyEditorFiles.delete(path.resolve(String(request && request.path || '')));
    return result;
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});
ipcMain.handle('editor:dirty', (_event, file, dirty) => {
  try {
    const target = path.resolve(String(file || ''));
    if (dirty) dirtyEditorFiles.add(target);
    else dirtyEditorFiles.delete(target);
    return { ok: true, count: dirtyEditorFiles.size };
  } catch { return { ok: false, count: dirtyEditorFiles.size }; }
});
ipcMain.handle('editor:open-external', async (_event, file) => {
  try {
    const { target } = resolveWorkspaceTextFile(currentWorkspace, file, { enforceSize: false });
    const message = await shell.openPath(target);
    return message ? { ok: false, message } : { ok: true };
  } catch (error) { return { ok: false, message: error && error.message ? error.message : String(error) }; }
});

// --- App lifecycle ---

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    // Remove the default menu bar entirely, so pressing Alt shows nothing.
    Menu.setApplicationMenu(null);
    createTray();
    createLoadingWindow();
    setupDesktopUpdater();
    launchService();
  });

  app.on('before-quit', (event) => {
    if (!quitting && dirtyEditorFiles.size > 0) {
      const options = {
        type: 'warning',
        buttons: ['取消退出', '放弃修改并退出'],
        defaultId: 0,
        cancelId: 0,
        title: '存在未保存的文件',
        message: `还有 ${dirtyEditorFiles.size} 个文件未保存。`,
        detail: '退出后未保存的修改会丢失。'
      };
      const choice = mainWindow && !mainWindow.isDestroyed()
        ? dialog.showMessageBoxSync(mainWindow, options)
        : dialog.showMessageBoxSync(options);
      if (choice === 0) {
        event.preventDefault();
        showMainWindow();
        return;
      }
      dirtyEditorFiles.clear();
    }
    quitting = true;
  });

  app.on('will-quit', (event) => {
    if ((service || localPreview) && !cleanedUp) {
      event.preventDefault();
      cleanedUp = true;
      Promise.all([
        service ? service.stop() : Promise.resolve(),
        localPreview ? localPreview.stop() : Promise.resolve()
      ]).then(() => app.quit());
    }
  });

  app.on('quit', () => {
    if (desktopUpdater) desktopUpdater.dispose();
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
