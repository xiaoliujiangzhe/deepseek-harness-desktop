'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LocalPreviewServer, resolveWorkspaceFile } = require('../src/local-preview-server');

test('resolves HTML only inside the workspace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>game</h1>');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'no');
  assert.equal(resolveWorkspaceFile(root, 'index.html'), path.join(root, 'index.html'));
  assert.throws(() => resolveWorkspaceFile(root, '../outside.html'), /当前工作区/);
  assert.throws(() => resolveWorkspaceFile(root, 'notes.txt'), /HTML/);
});

test('serves workspace assets and injects live reload', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-server-'));
  const server = new LocalPreviewServer(root);
  t.after(async () => { await server.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'game'));
  fs.writeFileSync(path.join(root, 'game', 'index.html'), '<body><script src="app.js"></script></body>');
  fs.writeFileSync(path.join(root, 'game', 'app.js'), 'window.ready = true');
  const url = await server.previewUrl('game/index.html');
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/game\/index\.html$/);
  const html = await (await fetch(url)).text();
  const script = await (await fetch(new URL('app.js', url))).text();
  assert.match(html, /data-dsh-live-preview/);
  assert.equal(script, 'window.ready = true');
  fs.writeFileSync(path.join(root, 'private.txt'), 'not a web asset');
  assert.equal((await fetch(new URL('../private.txt', url))).status, 403);
});
