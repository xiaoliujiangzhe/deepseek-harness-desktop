'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { EmbeddedBrowser, normalizeBrowserUrl, resolveBrowserInput } = require('../src/embedded-browser');

test('normalizes plain hostnames to HTTPS', () => {
  assert.equal(normalizeBrowserUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserUrl('http://127.0.0.1:3000/a'), 'http://127.0.0.1:3000/a');
});

test('treats ordinary address-bar text as a search query', () => {
  assert.equal(resolveBrowserInput('deepseek.com/docs'), 'https://deepseek.com/docs');
  assert.equal(resolveBrowserInput('localhost:5173/demo'), 'http://localhost:5173/demo');
  assert.equal(resolveBrowserInput('DeepSeek 多模态教程'), 'https://www.bing.com/search?q=DeepSeek%20%E5%A4%9A%E6%A8%A1%E6%80%81%E6%95%99%E7%A8%8B');
});

test('blocks privileged and credential-bearing URLs', () => {
  assert.throws(() => normalizeBrowserUrl(''), /请输入网址/);
  assert.throws(() => normalizeBrowserUrl('file:///C:/Windows/System32'), /http\/https/);
  assert.throws(() => normalizeBrowserUrl('javascript:alert(1)'), /http\/https/);
  assert.throws(() => normalizeBrowserUrl('https://user:secret@example.com'), /账号或密码/);
});

class FakeSession extends EventEmitter {
  setPermissionRequestHandler(handler) { this.permissionHandler = handler; }
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.session = new FakeSession();
    this.url = '';
    this.title = '';
    this.destroyed = false;
    this.zoom = 1;
    this.navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {}
    };
  }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  async loadURL(url) {
    this.url = url;
    this.title = new URL(url).hostname;
    this.emit('did-navigate');
    this.emit('did-stop-loading');
  }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  isLoading() { return false; }
  isDestroyed() { return this.destroyed; }
  close() { this.destroyed = true; }
  reload() {}
  findInPage() { return 1; }
  stopFindInPage() {}
  getZoomFactor() { return this.zoom; }
  setZoomFactor(value) { this.zoom = value; }
  async executeJavaScript() { return 'selected page text'; }
  async capturePage() {
    return {
      isEmpty: () => false,
      getSize: () => ({ width: 640, height: 480 }),
      toPNG: () => Buffer.from('png')
    };
  }
}

class FakeView {
  constructor() { this.webContents = new FakeWebContents(); }
  setBackgroundColor() {}
  setBounds(bounds) { this.bounds = bounds; }
}

class FakeHostWindow extends EventEmitter {
  constructor() {
    super();
    this.children = [];
    this.contentView = {
      addChildView: (view) => this.children.push(view),
      removeChildView: (view) => { this.children = this.children.filter((item) => item !== view); }
    };
  }
  getContentSize() { return [1200, 800]; }
}

function browserFixture(savePath = null) {
  const snapshots = [];
  const browser = new EmbeddedBrowser({
    WebContentsView: FakeView,
    dialog: { showSaveDialogSync: () => savePath },
    hostWindow: new FakeHostWindow(),
    onPersist: (snapshot) => snapshots.push(snapshot)
  });
  return { browser, snapshots };
}

test('manages multiple tabs and persists the active tab', async () => {
  const { browser, snapshots } = browserFixture();
  await browser.open('https://example.com/one');
  await browser.open('https://deepseek.com/two', { newTab: true });
  const firstId = browser.state().tabs[0].id;
  browser.switchTab(firstId);
  assert.equal(browser.state().tabs.length, 2);
  assert.equal(browser.state().url, 'https://example.com/one');
  assert.deepEqual(snapshots.at(-1), {
    version: 3,
    tabs: [
      { url: 'https://example.com/one', zoomFactor: 1 },
      { url: 'https://deepseek.com/two', zoomFactor: 1 }
    ],
    activeIndex: 0,
    bookmarks: [],
    history: [
      { url: 'https://deepseek.com/two', title: 'deepseek.com', visitedAt: snapshots.at(-1).history[0].visitedAt },
      { url: 'https://example.com/one', title: 'example.com', visitedAt: snapshots.at(-1).history[1].visitedAt }
    ]
  });
  browser.closeTab(firstId);
  assert.equal(browser.state().tabs.length, 1);
  browser.destroy();
});

test('opens an internal new-tab home without persisting it as a remote tab', async () => {
  const { browser, snapshots } = browserFixture();
  await browser.open();
  assert.equal(browser.state().open, true);
  assert.equal(browser.state().home, true);
  assert.equal(browser.state().title, '新标签');
  assert.equal(browser.state().url, '');
  assert.deepEqual(snapshots.at(-1), { version: 3, tabs: [], activeIndex: 0, bookmarks: [], history: [] });
  browser.destroy();
});

test('drops the old seeded vision documentation tab during settings migration', async () => {
  const { browser } = browserFixture();
  await browser.restore({
    activeIndex: 0,
    tabs: [{ url: 'https://api-docs.deepseek.com/zh-cn/guides/vision/', zoomFactor: 1 }]
  });
  assert.equal(browser.state().open, false);
  assert.equal(browser.state().tabs.length, 0);
  browser.destroy();
});

test('restores safe remote tabs but skips stale localhost previews', async () => {
  const { browser } = browserFixture();
  await browser.restore({
    activeIndex: 1,
    tabs: [
      { url: 'http://127.0.0.1:54321/game/index.html', zoomFactor: 1 },
      { url: 'https://example.com/docs', zoomFactor: 1.3 }
    ]
  });
  assert.equal(browser.state().tabs.length, 1);
  assert.equal(browser.state().url, 'https://example.com/docs');
  assert.equal(browser.state().zoomFactor, 1.3);
  browser.destroy();
});

test('persists bookmarks and recent unique history entries', async () => {
  const { browser } = browserFixture();
  await browser.open('https://example.com/article');
  const library = browser.toggleBookmark();
  assert.equal(library.bookmarked, true);
  assert.equal(library.bookmarks[0].url, 'https://example.com/article');
  await browser.open('https://example.com/article');
  assert.equal(browser.libraryState().history.length, 1);
  assert.equal(browser.removeBookmark('https://example.com/article').bookmarks.length, 0);
  assert.equal(browser.clearHistory().history.length, 0);
  browser.destroy();
});

test('captures selection and screenshot metadata from the active tab', async () => {
  const { browser } = browserFixture();
  await browser.open('https://example.com/article');
  assert.deepEqual(await browser.selection(), {
    text: 'selected page text',
    title: 'example.com',
    url: 'https://example.com/article'
  });
  const screenshot = await browser.screenshot();
  assert.equal(screenshot.base64, Buffer.from('png').toString('base64'));
  assert.equal(screenshot.width, 640);
  assert.equal(screenshot.height, 480);
  browser.destroy();
});

test('tracks download progress and completion in browser state', async () => {
  const { browser } = browserFixture('C:\\Temp\\archive.zip');
  await browser.open('https://example.com/downloads');
  const item = new EventEmitter();
  let received = 12;
  item.getFilename = () => 'archive.zip';
  item.getURL = () => 'https://example.com/archive.zip';
  item.getTotalBytes = () => 100;
  item.getReceivedBytes = () => received;
  item.setSavePath = (value) => { item.savePath = value; };
  const tab = browser.activeTab();
  tab.view.webContents.session.emit('will-download', { preventDefault() {} }, item, tab.view.webContents);
  assert.equal(browser.state().downloads[0].state, 'progressing');
  assert.equal(browser.state().downloads[0].receivedBytes, 0);
  received = 100;
  item.emit('updated');
  item.emit('done', {}, 'completed');
  assert.equal(browser.state().downloads[0].state, 'completed');
  assert.equal(browser.state().downloads[0].receivedBytes, 100);
  assert.equal(item.savePath, 'C:\\Temp\\archive.zip');
  browser.destroy();
});
