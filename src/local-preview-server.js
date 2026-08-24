'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const RELOAD_SNIPPET = `<script data-dsh-live-preview>(function(){
  const source = new EventSource('/__dsh_preview_events');
  source.addEventListener('change', () => location.reload());
}());</script>`;

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspaceFile(workspace, input) {
  const root = path.resolve(workspace);
  const raw = String(input || '').trim().replace(/^file:\/\//i, '');
  if (!raw || raw.includes('\0')) throw new Error('文件路径不合法');
  const candidate = path.resolve(root, raw);
  if (!isInside(root, candidate)) throw new Error('只能预览当前工作区内的文件');
  if (!HTML_EXTENSIONS.has(path.extname(candidate).toLowerCase())) throw new Error('当前只支持预览 HTML 文件');
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`找不到预览文件：${raw}`);
  return candidate;
}

function requestPathToFile(workspace, requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); } catch { throw new Error('网址路径无法解析'); }
  const root = path.resolve(workspace);
  let target = path.resolve(root, `.${decoded.replace(/\\/g, '/')}`);
  if (!isInside(root, target)) throw new Error('请求路径超出工作区');
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!isInside(root, target)) throw new Error('请求路径超出工作区');
  return target;
}

function injectReload(html) {
  if (html.includes('data-dsh-live-preview')) return html;
  const bodyEnd = html.search(/<\/body\s*>/i);
  if (bodyEnd >= 0) return `${html.slice(0, bodyEnd)}${RELOAD_SNIPPET}${html.slice(bodyEnd)}`;
  return `${html}${RELOAD_SNIPPET}`;
}

class LocalPreviewServer {
  constructor(workspace) {
    this.workspace = path.resolve(workspace);
    this.server = null;
    this.port = 0;
    this.clients = new Set();
    this.allowedRoots = new Set();
    this.watchers = new Map();
    this.changeTimer = null;
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((request, response) => this.handleRequest(request, response));
    await new Promise((resolve, reject) => {
      const onError = (error) => { this.server.removeListener('listening', onListening); reject(error); };
      const onListening = () => { this.server.removeListener('error', onError); resolve(); };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(0, '127.0.0.1');
    });
    this.port = this.server.address().port;
    return this.port;
  }

  watchRoot(root) {
    if (this.watchers.has(root)) return;
    try {
      const watcher = fs.watch(root, { recursive: true }, () => this.scheduleReload());
      watcher.on('error', () => {});
      this.watchers.set(root, watcher);
    } catch {
      this.watchers.set(root, null);
    }
  }

  scheduleReload() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      for (const response of this.clients) response.write('event: change\ndata: reload\n\n');
    }, 120);
  }

  handleRequest(request, response) {
    const method = String(request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method)) {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const url = new URL(request.url || '/', `http://127.0.0.1:${this.port}`);
    if (url.pathname === '/__dsh_preview_events') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive'
      });
      response.write('event: ready\ndata: connected\n\n');
      this.clients.add(response);
      request.on('close', () => this.clients.delete(response));
      return;
    }
    let file;
    try { file = requestPathToFile(this.workspace, url.pathname); }
    catch {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    if (![...this.allowedRoots].some((root) => isInside(root, file))) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const extension = path.extname(file).toLowerCase();
    const headers = {
      'content-type': MIME_TYPES[extension] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    };
    if (method === 'HEAD') {
      response.writeHead(200, headers);
      response.end();
      return;
    }
    if (HTML_EXTENSIONS.has(extension)) {
      const html = injectReload(fs.readFileSync(file, 'utf8'));
      response.writeHead(200, { ...headers, 'content-length': Buffer.byteLength(html) });
      response.end(html);
      return;
    }
    response.writeHead(200, { ...headers, 'content-length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(response);
  }

  async previewUrl(input) {
    const file = resolveWorkspaceFile(this.workspace, input);
    const root = path.dirname(file);
    this.allowedRoots.add(root);
    this.watchRoot(root);
    await this.start();
    const relative = path.relative(this.workspace, file).split(path.sep).map(encodeURIComponent).join('/');
    return `http://127.0.0.1:${this.port}/${relative}`;
  }

  async stop() {
    clearTimeout(this.changeTimer);
    for (const watcher of this.watchers.values()) if (watcher) watcher.close();
    this.watchers.clear();
    this.allowedRoots.clear();
    for (const response of this.clients) response.end();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = {
  injectReload,
  LocalPreviewServer,
  requestPathToFile,
  resolveWorkspaceFile
};
