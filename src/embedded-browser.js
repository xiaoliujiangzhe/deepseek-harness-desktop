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
    this.view = null;
    this.visible = false;
    this.attached = false;
    this.left = 0;
    this.top = 96;
    this.width = 0;
    this.error = null;
    this.handleResize = () => this.layout();
    hostWindow.on('resize', this.handleResize);
  }

  ensureView() {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
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
    this.view = view;
    view.setBackgroundColor('#ffffff');
    this.attach();
    view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    view.webContents.setWindowOpenHandler(({ url }) => {
      try { view.webContents.loadURL(normalizeBrowserUrl(url)); } catch { /* denied */ }
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (event, url) => {
      try { normalizeBrowserUrl(url); } catch { event.preventDefault(); }
    });
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'page-title-updated']) {
      view.webContents.on(event, () => {
        this.error = null;
        this.emitState();
      });
    }
    view.webContents.on('did-start-loading', () => this.emitState());
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      this.error = `${errorDescription || '网页加载失败'} (${errorCode})`;
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
    this.layout();
    return view;
  }

  attach() {
    if (this.attached || !this.view || this.view.webContents.isDestroyed()) return;
    this.hostWindow.contentView.addChildView(this.view);
    this.attached = true;
  }

  layout(options = {}) {
    if (typeof options === 'number') options = { top: options };
    if (options.left !== undefined) this.left = Math.max(0, Number(options.left) || 0);
    if (options.top !== undefined) this.top = Math.max(0, Number(options.top) || 0);
    if (options.width !== undefined) this.width = Math.max(0, Number(options.width) || 0);
    if (!this.view || this.view.webContents.isDestroyed()) return;
    const [width, height] = this.hostWindow.getContentSize();
    const left = this.left || Math.max(0, width - this.width);
    const panelWidth = this.width || Math.max(1, width - left);
    this.view.setBounds({
      x: Math.round(left),
      y: Math.round(this.top),
      width: Math.max(1, Math.round(panelWidth)),
      height: Math.max(1, height - this.top)
    });
  }

  async open(input) {
    const url = normalizeBrowserUrl(input);
    const view = this.ensureView();
    this.error = null;
    this.visible = true;
    this.attach();
    this.layout();
    await view.webContents.loadURL(url);
    this.emitState();
    return this.state();
  }

  state() {
    if (!this.view || this.view.webContents.isDestroyed()) return { open: false };
    return {
      open: true,
      visible: this.visible,
      url: this.view.webContents.getURL(),
      title: this.view.webContents.getTitle(),
      loading: this.view.webContents.isLoading(),
      error: this.error,
      canGoBack: this.view.webContents.canGoBack(),
      canGoForward: this.view.webContents.canGoForward()
    };
  }

  emitState() { this.onState(this.state()); }

  back() {
    if (this.view && this.view.webContents.canGoBack()) this.view.webContents.goBack();
    return this.state();
  }

  forward() {
    if (this.view && this.view.webContents.canGoForward()) this.view.webContents.goForward();
    return this.state();
  }

  reload() {
    if (this.view) this.view.webContents.reload();
    return this.state();
  }

  close() {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
    this.attached = false;
    this.emitState();
    return { open: false };
  }

  hide() {
    this.visible = false;
    if (this.attached && this.view) {
      this.hostWindow.contentView.removeChildView(this.view);
      this.attached = false;
    }
    this.emitState();
    return { open: Boolean(this.view), visible: false };
  }

  destroy() {
    this.hostWindow.removeListener('resize', this.handleResize);
    this.close();
  }
}

module.exports = { EmbeddedBrowser, normalizeBrowserUrl };
