'use strict';

/**
 * Service manager for the DeepSeek Harness desktop shell.
 *
 * Locates a real Node.js executable (NOT Electron's embedded Node — the dsh
 * native modules such as node-pty/sharp are built for the system Node ABI),
 * resolves the bundled `@deepseek-ai/dsh` CLI entry, spawns `dsh web`, and
 * resolves readiness from the `dsh web: <url>` stdout line plus an HTTP probe.
 */

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const READY_LINE = /^dsh web:\s+(http\S+)/;
const POLL_INTERVAL_MS = 250;
const POLL_MAX_ATTEMPTS = 240; // ~60s worst case after the URL line is seen
const STDOUT_TAIL_LINES = 60;

/** Resolve the system Node executable, or null when only Electron's is available. */
function resolveNodeExecutable() {
  // 1. Explicit override (settings / environment).
  const override = process.env.DSH_DESKTOP_NODE;
  if (override && fs.existsSync(override)) return override;

  // 2. PATH lookup.
  try {
    const lookup = process.platform === 'win32'
      ? execFileSync('where.exe', ['node'], { encoding: 'utf8' })
      : execFileSync('which', ['node'], { encoding: 'utf8' });
    const first = lookup.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* fall through */
  }

  // 3. Common install locations.
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
      path.join(process.env.APPDATA || '', 'nvm', process.env.NVM_SYMLINK || 'current', 'node.exe')
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/** Resolve the bundled dsh CLI entry script. */
function resolveDshBin() {
  const candidates = [];

  // Explicit override (debugging / custom layouts).
  if (process.env.DSH_DESKTOP_BIN) candidates.push(process.env.DSH_DESKTOP_BIN);

  // Development / unpackaged: resolve through this app's node_modules.
  try {
    candidates.push(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
  } catch {
    try {
      const pkgDir = path.dirname(require.resolve('@deepseek-ai/dsh/package.json'));
      candidates.push(path.join(pkgDir, 'lib', 'bin.js'));
    } catch {
      /* ignore */
    }
  }

  // Packaged (electron-builder): production node_modules is unpacked to the
  // real filesystem so the separate Node process can read it.
  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      path.join(process.resourcesPath, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** A tiny HTTP GET that resolves as soon as any response arrives (server is listening). */
function probeUrl(url, timeoutMs) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start the dsh web service.
 *
 * @param {object} options
 * @param {number|null} options.port  Port to pass to `--port` (null/0 => OS-assigned).
 * @param {string} options.cwd       Working directory for the child process.
 * @param {object} options.env       Extra environment variables.
 * @param {(s: {pct:number, label:string}) => void} options.onProgress
 * @param {(url: string) => void} options.onReady
 * @param {(err: {message:string, detail:string}) => void} options.onError
 * @param {(code: number|null, signal: string|null) => void} options.onExit
 * @returns {{ stop: () => Promise<void>, child: import('node:child_process').ChildProcess }}
 */
function startService(options) {
  const node = resolveNodeExecutable();
  const bin = resolveDshBin();

  const progress = options.onProgress || (() => {});
  const stdoutTail = [];
  const stderrTail = [];

  if (!bin) {
    progress({ pct: 0, label: '找不到 @deepseek-ai/dsh，请先运行 npm install' });
    queueMicrotask(() => options.onError && options.onError({
      message: '找不到 @deepseek-ai/dsh 包',
      detail: '请在本项目目录运行 `npm install` 后重试。'
    }));
    return { stop: async () => {}, child: null };
  }

  let cmd;
  let args = [bin, 'web'];
  const env = { ...process.env, ...(options.env || {}) };
  if (node) {
    cmd = node;
  } else {
    // Last resort: run dsh under Electron's own Node runtime. Native addons
    // (node-pty/sharp) may fail to load due to ABI mismatch.
    cmd = process.execPath;
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  if (options.port) args.push('--port', String(options.port));

  progress({ pct: 8, label: node ? '已定位 Node 运行时' : '使用 Electron 内置运行时（提示：终端类工具可能受限）' });

  const child = spawn(cmd, args, {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  let ready = false;
  let stopped = false;
  let killStarted = false;
  let killPromise = null;
  let url = null;

  const pushTail = (bucket, chunk) => {
    const text = chunk.toString();
    bucket.push(text);
    if (bucket.length > STDOUT_TAIL_LINES) bucket.splice(0, bucket.length - STDOUT_TAIL_LINES);
  };

  const fail = (message, detail) => {
    if (ready || stopped) return;
    stopped = true;
    options.onError && options.onError({ message, detail });
  };

  child.stdout.on('data', (chunk) => {
    pushTail(stdoutTail, chunk);
    const text = chunk.toString();
    const match = text.match(READY_LINE);
    if (match && !url) {
      url = match[1].trim();
    }
  });

  child.stderr.on('data', (chunk) => pushTail(stderrTail, chunk));

  child.on('error', (err) => {
    fail('无法启动 DeepSeek Harness 服务', err && err.message ? err.message : String(err));
  });

  child.on('exit', (code, signal) => {
    if (ready) {
      options.onExit && options.onExit(code, signal);
    } else if (!stopped) {
      fail(
        '服务在就绪前退出',
        `退出码 ${code}${signal ? ` (${signal})` : ''}\n\n--- stderr ---\n${stderrTail.join('').slice(-4000)}`
      );
    }
  });

  // Readiness loop: wait for the URL line, then confirm with an HTTP probe.
  (async () => {
    // Wait for the URL line (also gives the Loader tree time to settle).
    for (let i = 0; i < 600 && !url && !stopped; i++) {
      await sleep(100);
      progress({ pct: Math.min(10 + i * 0.05, 30), label: '正在启动 DeepSeek Harness 服务…' });
    }
    if (!url) {
      if (!stopped) {
        fail(
          '等待服务就绪超时',
          `未捕获到 "dsh web:" 就绪行。\n\n--- stdout ---\n${stdoutTail.join('').slice(-4000)}\n\n--- stderr ---\n${stderrTail.join('').slice(-4000)}`
        );
      }
      return;
    }

    progress({ pct: 55, label: '服务已绑定端口，正在确认 HTTP 可访问…' });

    let ok = false;
    for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS && !stopped; attempt++) {
      ok = await probeUrl(url, 1500);
      if (ok) break;
      progress({
        pct: Math.min(55 + attempt * 1.2, 92),
        label: `等待服务响应…（第 ${attempt} 次探测）`
      });
      await sleep(POLL_INTERVAL_MS);
    }

    if (ok && !stopped) {
      ready = true;
      progress({ pct: 100, label: '服务已就绪，正在打开界面…' });
      options.onReady && options.onReady(url);
    } else if (!stopped) {
      fail('服务未响应', `HTTP 探测失败: ${url}\n\n--- stdout ---\n${stdoutTail.join('').slice(-4000)}\n\n--- stderr ---\n${stderrTail.join('').slice(-4000)}`);
    }
  })();

  const stop = () => {
    if (killStarted) return killPromise;
    killStarted = true;
    stopped = true; // halt the readiness loop and suppress late onError/onReady
    if (!child || child.exitCode !== null) {
      killPromise = Promise.resolve();
      return killPromise;
    }
    killPromise = new Promise((resolve) => {
      child.once('exit', () => resolve());
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 2000).unref();
        }
      } catch {
        /* ignore */
      }
      setTimeout(resolve, 3000).unref();
    });
    return killPromise;
  };

  return { stop, child, get url() { return url; }, get ready() { return ready; } };
}

module.exports = { startService, resolveNodeExecutable, resolveDshBin, READY_LINE };
