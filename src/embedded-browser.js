'use strict';

const path = require('node:path');

function normalizeBrowserUrl(input) {
  let value = String(input || '').trim();
  if (!value) return 'https://www.deepseek.com/';
  if (value.length > 2048) throw new Error('网址过长');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许打开 http/https 网页');
  if (url.username || url.password) throw new Error('网址中不能包含账号或密码');
  return url.href;
}

class EmbeddedBrowser {
  constructor({ WebContentsView, dialog, hostWindow, onState }) {
    this.WebContentsView = WebContentsView;
    this.dialog = dialog;
    this.hostWindow = hostWindow;
    this.onState = onState || (() => {});
    this.tabs = new Map();
    this.activeTabId = null;
    this.nextTabId = 1;
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
    return view;
  }

  createTab() {
    const id = `tab-${this.nextTabId++}`;
    const view = this.createView();
    const tab = { id, view, error: null, favicon: null, findResult: null };
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
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'page-title-updated']) {
      view.webContents.on(event, () => {
        tab.error = null;
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
    view.webContents.session.on('will-download', (event, item, webContents) => {
      if (webContents !== view.webContents) return;
      const savePath = this.dialog.showSaveDialogSync(this.hostWindow, {
        title: '保存下载文件',
        defaultPath: path.basename(item.getFilename())
      });
      if (!savePath) event.preventDefault();
      else item.setSavePath(savePath);
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
    const url = normalizeBrowserUrl(input);
    let tab = options.newTab ? null : this.activeTab();
    if (!tab) tab = this.createTab();
    tab.error = null;
    this.activeTabId = tab.id;
    this.visible = true;
    this.attachActiveView();
    this.layout();
    await tab.view.webContents.loadURL(url);
    this.emitState();
    return this.state();
  }

  switchTab(id) {
    if (!this.tabs.has(id)) throw new Error('浏览器标签不存在');
    this.activeTabId = id;
    this.attachActiveView();
    this.emitState();
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
    return this.state();
  }

  tabState(tab) {
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return { id: tab.id, title: '已关闭', url: '', loading: false, error: tab.error };
    const url = contents.getURL();
    return {
      id: tab.id,
      title: contents.getTitle() || (url ? new URL(url).hostname : '新标签'),
      url,
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
    if (!tab) return { open: false, visible: this.visible, activeTabId: null, tabs };
    return { open: true, visible: this.visible, activeTabId: tab.id, tabs, ...this.tabState(tab) };
  }

  emitState() { this.onState(this.state()); }

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
    return { open: false, visible: false, activeTabId: null, tabs: [] };
  }

  destroy() {
    this.hostWindow.removeListener('resize', this.handleResize);
    this.close();
  }
}

module.exports = { EmbeddedBrowser, normalizeBrowserUrl };
