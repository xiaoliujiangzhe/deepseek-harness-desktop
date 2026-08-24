'use strict';

const path = require('node:path');

const BROWSER_STATE_VERSION = 3;
const LEGACY_DEFAULT_BROWSER_URL = 'https://api-docs.deepseek.com/zh-cn/guides/vision/';
const BROWSER_HOME_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>新标签</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #303643; background: #f8f9fb; }
    main { width: min(560px, calc(100vw - 48px)); padding: 32px 0 64px; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 13px; color: #fff; background: linear-gradient(145deg, #253c74, #4d6bfe); font-weight: 800; font-size: 13px; letter-spacing: -.4px; box-shadow: 0 8px 22px rgba(77,107,254,.22); }
    h1 { margin: 0; font-size: 24px; letter-spacing: -.5px; }
    p { margin: 0 0 26px 54px; color: #747b89; font-size: 13px; }
    .hint { margin: 0 0 14px; color: #9298a4; font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
    .links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    a { min-width: 0; padding: 14px 15px; border: 1px solid #e1e4ea; border-radius: 11px; color: inherit; background: #fff; text-decoration: none; box-shadow: 0 2px 8px rgba(25,31,45,.035); }
    a:hover { border-color: #bdc6ff; background: #f6f7ff; transform: translateY(-1px); }
    strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    strong { font-size: 13px; }
    small { margin-top: 5px; color: #8a91a0; font-size: 11px; }
    @media (max-width: 520px) { .links { grid-template-columns: 1fr; } }
    @media (prefers-color-scheme: dark) {
      body { color: #e8eaf0; background: #17191e; }
      p, .hint, small { color: #8f95a3; }
      a { border-color: #30343d; background: #202329; box-shadow: none; }
      a:hover { border-color: #5368b9; background: #252a38; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand"><div class="mark">DSH</div><h1>开始浏览</h1></div>
    <p>在上方地址栏输入网址，或从常用入口开始。</p>
    <div class="hint">常用入口</div>
    <div class="links">
      <a href="https://api-docs.deepseek.com/zh-cn/"><strong>DeepSeek API 文档</strong><small>接口指南与更新</small></a>
      <a href="https://api-docs.deepseek.com/zh-cn/guides/vision/"><strong>图像理解</strong><small>多模态模型使用指南</small></a>
      <a href="https://github.com/xiaoliujiangzhe/deepseek-harness-desktop"><strong>桌面端项目</strong><small>GitHub 仓库</small></a>
      <a href="https://www.deepseek.com/"><strong>DeepSeek</strong><small>官方网站</small></a>
    </div>
  </main>
</body>
</html>`;
const BROWSER_HOME_URL = `data:text/html;charset=utf-8,${encodeURIComponent(BROWSER_HOME_HTML)}`;

function isBrowserHomeUrl(url) {
  return String(url || '') === BROWSER_HOME_URL;
}

function normalizeBrowserUrl(input) {
  let value = String(input || '').trim();
  if (!value) throw new Error('请输入网址');
  if (value.length > 2048) throw new Error('网址过长');
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}):\d+(?:[/?#]|$)/i.test(value)) value = `http://${value}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许打开 http/https 网页');
  if (url.username || url.password) throw new Error('网址中不能包含账号或密码');
  return url.href;
}

function resolveBrowserInput(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('请输入网址或搜索内容');
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  const hostLike = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#]|$)/i.test(value);
  if (!explicitScheme && !hostLike) return `https://www.bing.com/search?q=${encodeURIComponent(value.slice(0, 500))}`;
  return normalizeBrowserUrl(value);
}

function safeLibraryEntries(entries, limit) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.flatMap((entry) => {
    try {
      const url = normalizeBrowserUrl(entry && entry.url);
      if (seen.has(url)) return [];
      seen.add(url);
      return [{
        url,
        title: String(entry && entry.title || new URL(url).hostname).trim().slice(0, 240),
        visitedAt: Number(entry && entry.visitedAt) || Date.now()
      }];
    } catch { return []; }
  }).slice(0, limit);
}

class EmbeddedBrowser {
  constructor({ WebContentsView, dialog, hostWindow, onState, onPersist }) {
    this.WebContentsView = WebContentsView;
    this.dialog = dialog;
    this.hostWindow = hostWindow;
    this.onState = onState || (() => {});
    this.onPersist = onPersist || (() => {});
    this.tabs = new Map();
    this.activeTabId = null;
    this.nextTabId = 1;
    this.downloads = new Map();
    this.nextDownloadId = 1;
    this.boundSessions = new WeakSet();
    this.bookmarks = [];
    this.history = [];
    this.restoring = false;
    this.visible = false;
    this.attachedView = null;
    this.left = 0;
    this.top = 128;
    this.width = 0;
    this.handleResize = () => this.layout();
    hostWindow.on('resize', this.handleResize);
  }

  createView() {
    const view = new this.WebContentsView({
      webPreferences: {
        partition: 'persist:dsh-desktop-browser',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    view.setBackgroundColor('#ffffff');
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    this.wireSession(view.webContents.session);
    return view;
  }

  wireSession(session) {
    if (this.boundSessions.has(session)) return;
    this.boundSessions.add(session);
    session.on('will-download', (event, item, webContents) => {
      const tab = [...this.tabs.values()].find((candidate) => candidate.view.webContents === webContents);
      if (!tab) return;
      const filename = path.basename(item.getFilename());
      const savePath = this.dialog.showSaveDialogSync(this.hostWindow, {
        title: '保存下载文件',
        defaultPath: filename
      });
      if (!savePath) {
        event.preventDefault();
        return;
      }
      item.setSavePath(savePath);
      const id = `download-${this.nextDownloadId++}`;
      const download = {
        id,
        filename,
        path: savePath,
        url: item.getURL(),
        state: 'progressing',
        receivedBytes: 0,
        totalBytes: item.getTotalBytes(),
        startedAt: Date.now()
      };
      this.downloads.set(id, download);
      const update = () => {
        download.receivedBytes = item.getReceivedBytes();
        download.totalBytes = item.getTotalBytes();
        this.emitState();
      };
      item.on('updated', update);
      item.once('done', (_doneEvent, state) => {
        update();
        download.state = state;
        download.finishedAt = Date.now();
        this.emitState();
      });
      this.emitState();
    });
  }

  createTab() {
    const id = `tab-${this.nextTabId++}`;
    const view = this.createView();
    const tab = { id, view, error: null, favicon: null, findResult: null, home: false };
    this.tabs.set(id, tab);
    this.wireTab(tab);
    return tab;
  }

  wireTab(tab) {
    const { view } = tab;
    view.webContents.setWindowOpenHandler(({ url }) => {
      try { this.open(normalizeBrowserUrl(url), { newTab: true }).catch(() => {}); } catch {}
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, url) => {
      try { normalizeBrowserUrl(url); } catch { event.preventDefault(); }
    });
    for (const event of ['did-navigate', 'did-navigate-in-page']) {
      view.webContents.on(event, () => {
        tab.home = isBrowserHomeUrl(view.webContents.getURL());
        tab.error = null;
        this.recordHistory(tab);
        this.emitState();
        this.persist();
      });
    }
    for (const event of ['did-stop-loading', 'page-title-updated']) {
      view.webContents.on(event, () => {
        this.updateHistoryTitle(tab);
        this.emitState();
      });
    }
    view.webContents.on('did-start-loading', () => this.emitState());
    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      tab.favicon = Array.isArray(favicons) && favicons.length ? favicons[0] : null;
      this.emitState();
    });
    view.webContents.on('found-in-page', (_event, result) => {
      tab.findResult = result ? { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches } : null;
      this.emitState();
    });
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      tab.error = `${errorDescription || '网页加载失败'} (${errorCode})`;
      this.emitState();
    });
    view.webContents.on('render-process-gone', (_event, details) => {
      tab.error = `网页进程已退出：${details && details.reason ? details.reason : 'unknown'}`;
      this.emitState();
    });
  }

  activeTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
  }

  detachCurrentView() {
    if (!this.attachedView) return;
    try { this.hostWindow.contentView.removeChildView(this.attachedView); } catch {}
    this.attachedView = null;
  }

  attachActiveView() {
    const tab = this.activeTab();
    if (!this.visible || !tab || tab.view.webContents.isDestroyed()) return;
    if (this.attachedView === tab.view) return;
    this.detachCurrentView();
    this.hostWindow.contentView.addChildView(tab.view);
    this.attachedView = tab.view;
    this.layout();
  }

  layout(options = {}) {
    if (typeof options === 'number') options = { top: options };
    if (options.left !== undefined) this.left = Math.max(0, Number(options.left) || 0);
    if (options.top !== undefined) this.top = Math.max(0, Number(options.top) || 0);
    if (options.width !== undefined) this.width = Math.max(0, Number(options.width) || 0);
    const tab = this.activeTab();
    if (!tab || tab.view.webContents.isDestroyed()) return;
    const [width, height] = this.hostWindow.getContentSize();
    const left = this.left || Math.max(0, width - this.width);
    const panelWidth = this.width || Math.max(1, width - left);
    tab.view.setBounds({
      x: Math.round(left),
      y: Math.round(this.top),
      width: Math.max(1, Math.round(panelWidth)),
      height: Math.max(1, height - this.top)
    });
  }

  async open(input, options = {}) {
    const home = !String(input || '').trim();
    const url = home ? BROWSER_HOME_URL : resolveBrowserInput(input);
    let tab = options.newTab ? null : this.activeTab();
    if (!tab) tab = this.createTab();
    tab.error = null;
    tab.home = home;
    this.activeTabId = tab.id;
    this.visible = true;
    this.attachActiveView();
    this.layout();
    await tab.view.webContents.loadURL(url);
    this.emitState();
    this.persist();
    return this.state();
  }

  async restore(snapshot) {
    this.bookmarks = safeLibraryEntries(snapshot && snapshot.bookmarks, 100);
    this.history = safeLibraryEntries(snapshot && snapshot.history, 200);
    let entries = snapshot && Array.isArray(snapshot.tabs) ? snapshot.tabs.slice(0, 12) : [];
    // The first 0.4.0 preview seeded this documentation page as its only tab.
    // Drop that one legacy default once so upgraded users reach the new home.
    if ((!snapshot || !snapshot.version) && entries.length === 1) {
      try {
        if (normalizeBrowserUrl(entries[0] && entries[0].url) === LEGACY_DEFAULT_BROWSER_URL) entries = [];
      } catch { /* invalid legacy entries are filtered below */ }
    }
    const requestedActiveIndex = Math.max(0, Number(snapshot && snapshot.activeIndex) || 0);
    const safeEntries = entries.flatMap((entry, originalIndex) => {
      try {
        const url = normalizeBrowserUrl(entry && entry.url);
        const parsed = new URL(url);
        if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) return [];
        return [{ url, zoomFactor: Math.max(0.5, Math.min(2, Number(entry.zoomFactor) || 1)), originalIndex }];
      } catch {
        return [];
      }
    });
    if (safeEntries.length === 0) {
      this.persist();
      return this.state();
    }
    this.restoring = true;
    this.visible = false;
    const tabs = safeEntries.map(() => this.createTab());
    const exactActiveIndex = safeEntries.findIndex((entry) => entry.originalIndex === requestedActiveIndex);
    const activeIndex = exactActiveIndex >= 0 ? exactActiveIndex : Math.max(0, Math.min(tabs.length - 1, requestedActiveIndex));
    this.activeTabId = tabs[activeIndex].id;
    await Promise.all(tabs.map(async (tab, index) => {
      try {
        await tab.view.webContents.loadURL(safeEntries[index].url);
        tab.view.webContents.setZoomFactor(safeEntries[index].zoomFactor);
      } catch (error) {
        tab.error = error && error.message ? error.message : String(error);
      }
    }));
    this.restoring = false;
    this.emitState();
    this.persist();
    return this.state();
  }

  switchTab(id) {
    if (!this.tabs.has(id)) throw new Error('浏览器标签不存在');
    this.activeTabId = id;
    this.attachActiveView();
    this.emitState();
    this.persist();
    return this.state();
  }

  closeTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return this.state();
    const ids = [...this.tabs.keys()];
    const index = ids.indexOf(id);
    if (this.attachedView === tab.view) this.detachCurrentView();
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.tabs.delete(id);
    if (this.activeTabId === id) {
      const remaining = [...this.tabs.keys()];
      this.activeTabId = remaining[Math.min(index, remaining.length - 1)] || null;
    }
    if (this.activeTabId) this.attachActiveView();
    this.emitState();
    this.persist();
    return this.state();
  }

  tabState(tab) {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return { id: tab.id, title: '已关闭', url: '', loading: false, error: tab.error };
    const internalUrl = contents.getURL();
    const home = tab.home || isBrowserHomeUrl(internalUrl);
    const url = home ? '' : internalUrl;
    return {
      id: tab.id,
      title: home ? '新标签' : (contents.getTitle() || (url ? new URL(url).hostname : '新标签')),
      url,
      home,
      favicon: tab.favicon,
      loading: contents.isLoading(),
      error: tab.error,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
      zoomFactor: contents.getZoomFactor(),
      findResult: tab.findResult
    };
  }

  state() {
    const tab = this.activeTab();
    const tabs = [...this.tabs.values()].map((item) => this.tabState(item));
    const downloads = [...this.downloads.values()].map((item) => ({ ...item }));
    if (!tab) return { open: false, visible: this.visible, activeTabId: null, tabs, downloads, bookmarked: false };
    const state = this.tabState(tab);
    return { open: true, visible: this.visible, activeTabId: tab.id, tabs, downloads, bookmarked: Boolean(state.url && this.bookmarks.some((entry) => entry.url === state.url)), ...state };
  }

  emitState() { this.onState(this.state()); }

  persistenceState() {
    let activeIndex = 0;
    const tabs = [];
    for (const tab of this.tabs.values()) {
      const state = this.tabState(tab);
      if (!state.url) continue;
      try {
        const parsed = new URL(normalizeBrowserUrl(state.url));
        if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) continue;
      } catch {
        continue;
      }
      if (tab.id === this.activeTabId) activeIndex = tabs.length;
      tabs.push({ url: state.url, zoomFactor: state.zoomFactor });
    }
    return { version: BROWSER_STATE_VERSION, tabs, activeIndex, bookmarks: this.bookmarks, history: this.history };
  }

  persist() {
    if (!this.restoring) this.onPersist(this.persistenceState());
  }

  recordHistory(tab) {
    if (this.restoring) return;
    const state = this.tabState(tab);
    if (!state.url || !/^https?:/i.test(state.url)) return;
    const entry = { url: state.url, title: state.title, visitedAt: Date.now() };
    this.history = [entry, ...this.history.filter((item) => item.url !== entry.url)].slice(0, 200);
  }

  updateHistoryTitle(tab) {
    if (this.restoring) return;
    const state = this.tabState(tab);
    const item = state.url && this.history.find((entry) => entry.url === state.url);
    if (!item || !state.title || item.title === state.title) return;
    item.title = state.title;
    this.persist();
  }

  libraryState() {
    const active = this.activeTab();
    const state = active ? this.tabState(active) : { url: '' };
    return {
      bookmarks: this.bookmarks.map((item) => ({ ...item })),
      history: this.history.map((item) => ({ ...item })),
      activeUrl: state.url,
      bookmarked: Boolean(state.url && this.bookmarks.some((entry) => entry.url === state.url))
    };
  }

  toggleBookmark() {
    const tab = this.activeTab();
    if (!tab) throw new Error('当前没有打开的网页');
    const state = this.tabState(tab);
    if (!state.url || !/^https?:/i.test(state.url)) throw new Error('内部主页不能加入书签');
    const index = this.bookmarks.findIndex((entry) => entry.url === state.url);
    let bookmarked;
    if (index >= 0) {
      this.bookmarks.splice(index, 1);
      bookmarked = false;
    } else {
      this.bookmarks.unshift({ url: state.url, title: state.title, visitedAt: Date.now() });
      this.bookmarks = this.bookmarks.slice(0, 100);
      bookmarked = true;
    }
    this.persist();
    this.emitState();
    return { ...this.libraryState(), bookmarked };
  }

  removeBookmark(url) {
    const normalized = normalizeBrowserUrl(url);
    this.bookmarks = this.bookmarks.filter((entry) => entry.url !== normalized);
    this.persist();
    this.emitState();
    return this.libraryState();
  }

  clearHistory() {
    this.history = [];
    this.persist();
    return this.libraryState();
  }

  back() {
    const tab = this.activeTab();
    if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack();
    }
    return this.state();
  }

  forward() {
    const tab = this.activeTab();
    if (tab && tab.view.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward();
    }
    return this.state();
  }

  reload() {
    const tab = this.activeTab();
    if (tab) tab.view.webContents.reload();
    return this.state();
  }

  find(text, options = {}) {
    const tab = this.activeTab();
    const query = String(text || '').slice(0, 200);
    if (!tab || !query) return { ...this.state(), findRequestId: null };
    const findRequestId = tab.view.webContents.findInPage(query, {
      forward: options.forward !== false,
      findNext: Boolean(options.findNext)
    });
    return { ...this.state(), findRequestId };
  }

  stopFind(action = 'clearSelection') {
    const tab = this.activeTab();
    if (tab) {
      tab.view.webContents.stopFindInPage(action);
      tab.findResult = null;
    }
    return this.state();
  }

  zoom(delta) {
    const tab = this.activeTab();
    if (!tab) return this.state();
    const current = tab.view.webContents.getZoomFactor();
    const next = delta === 0 ? 1 : Math.max(0.5, Math.min(2, Math.round((current + Number(delta)) * 10) / 10));
    tab.view.webContents.setZoomFactor(next);
    this.emitState();
    this.persist();
    return this.state();
  }

  async selection() {
    const tab = this.activeTab();
    if (!tab) throw new Error('当前没有打开的网页');
    const text = await tab.view.webContents.executeJavaScript(`(() => {
      const selection = window.getSelection();
      return selection ? selection.toString().trim().slice(0, 12000) : '';
    })()`);
    if (!text) throw new Error('请先在网页中选择要引用的文字');
    const state = this.tabState(tab);
    return { text, title: state.title, url: state.url };
  }

  async screenshot() {
    const tab = this.activeTab();
    if (!tab) throw new Error('当前没有打开的网页');
    const image = await tab.view.webContents.capturePage();
    if (image.isEmpty()) throw new Error('网页截图为空');
    const size = image.getSize();
    const png = image.toPNG();
    if (png.length > 12 * 1024 * 1024) throw new Error('网页截图超过 12 MB，无法加入聊天');
    const state = this.tabState(tab);
    return {
      base64: png.toString('base64'),
      filename: `webpage-${Date.now()}.png`,
      width: size.width,
      height: size.height,
      title: state.title,
      url: state.url
    };
  }

  download(id) {
    const item = this.downloads.get(String(id || ''));
    return item ? { ...item } : null;
  }

  clearDownloads() {
    for (const [id, item] of this.downloads) {
      if (item.state !== 'progressing') this.downloads.delete(id);
    }
    this.emitState();
    return this.state();
  }

  hide() {
    this.visible = false;
    this.detachCurrentView();
    this.emitState();
    return this.state();
  }

  show() {
    if (!this.activeTab()) return this.state();
    this.visible = true;
    this.attachActiveView();
    this.layout();
    this.emitState();
    return this.state();
  }

  close() {
    this.visible = false;
    this.detachCurrentView();
    for (const tab of this.tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    this.tabs.clear();
    this.activeTabId = null;
    this.emitState();
    this.persist();
    return { open: false, visible: false, activeTabId: null, tabs: [], downloads: [...this.downloads.values()] };
  }

  destroy() {
    const snapshot = this.persistenceState();
    this.hostWindow.removeListener('resize', this.handleResize);
    this.restoring = true;
    this.close();
    this.onPersist(snapshot);
  }
}

module.exports = { EmbeddedBrowser, normalizeBrowserUrl, resolveBrowserInput };
