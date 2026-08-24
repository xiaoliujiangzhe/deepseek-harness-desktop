'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { resolveDshBin, resolveDshVersion, resolveNodeExecutable } = require('./server');

const DSH_MARKET_REGISTRY_URL = process.env.DSHM_REGISTRY_URL || 'https://awesome-dsh-plugin.com/plugins.json';
const PROFILE_NAME = 'web';
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'deepseek-harness-desktop',
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 240)}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(12000, () => request.destroy(new Error('GitHub 请求超时')));
    request.on('error', reject);
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function profileDir(home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  return path.join(home, 'profiles', PROFILE_NAME);
}

function validatePackageName(name) {
  return typeof name === 'string' && PACKAGE_NAME.test(name) && !name.includes('..');
}

function isBundleManifest(manifest) {
  return Boolean(manifest && manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch !== undefined);
}

function compatibilityOf(manifest, harnessVersion) {
  const declared = manifest && manifest.peerDependencies && manifest.peerDependencies['@deepseek-ai/dsh'];
  if (typeof declared !== 'string' || !declared.trim()) return { status: 'unknown', declared: null };
  if (declared === harnessVersion || declared === `=${harnessVersion}` || declared === '*') {
    return { status: 'compatible', declared };
  }
  return { status: 'declared', declared };
}

async function searchMarketplace(query = '') {
  const clean = String(query).trim().slice(0, 80);
  const result = await requestJson(DSH_MARKET_REGISTRY_URL, { accept: 'application/json' });
  const terms = clean.toLowerCase().split(/\s+/).filter(Boolean);
  const entries = Array.isArray(result.plugins) ? result.plugins : [];
  const rows = entries.map((entry) => {
    const owner = typeof entry.owner === 'string' ? entry.owner.trim() : '';
    const repositoryUrl = typeof entry.url === 'string' ? entry.url : '';
    const npmName = typeof entry.npm === 'string' && validatePackageName(entry.npm) ? entry.npm : '';
    const githubSpec = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/i.exec(repositoryUrl);
    const installSpec = npmName || (githubSpec ? `github:${githubSpec[1]}` : '');
    if (!installSpec) return null;
    const descriptions = entry.description && typeof entry.description === 'object'
      ? Object.values(entry.description).filter((value) => typeof value === 'string').join(' ')
      : String(entry.description || '');
    const haystack = [entry.name, owner, repositoryUrl, entry.category, descriptions]
      .filter(Boolean).join(' ').toLowerCase();
    if (terms.length && !terms.every((term) => haystack.includes(term))) return null;
    return {
      id: `${owner}/${entry.name || installSpec}`,
      name: typeof entry.name === 'string' ? entry.name : installSpec,
      version: null,
      description: descriptions,
      repositoryUrl,
      installSpec,
      source: npmName ? 'npm' : 'github',
      category: typeof entry.category === 'string' ? entry.category : null,
      stars: Number(entry.stars) || 0,
      downloads: Number(entry.downloads) || 0,
      updatedAt: typeof entry.updated === 'string' ? entry.updated : (typeof entry.added === 'string' ? entry.added : null),
      compatibility: { status: 'unknown', declared: null },
      curated: true
    };
  }).filter(Boolean);
  rows.sort((a, b) => (b.stars - a.stars) || a.name.localeCompare(b.name));
  return rows.slice(0, 80);
}

function listInstalled(home) {
  const dir = profileDir(home);
  const manifestFile = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestFile)) return [];
  const profile = readJson(manifestFile);
  const bundleSet = new Set((profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles) || []);
  return Object.entries(profile.dependencies || {}).map(([name, requested]) => {
    let installed = null;
    try { installed = readJson(path.join(dir, 'node_modules', ...name.split('/'), 'package.json')); } catch { /* unresolved */ }
    return {
      name,
      requested,
      version: installed && typeof installed.version === 'string' ? installed.version : null,
      description: installed && typeof installed.description === 'string' ? installed.description : '',
      activeBundle: bundleSet.has(name),
      compatibility: compatibilityOf(installed, resolveDshVersion())
    };
  });
}

function backupProfile(home) {
  const dir = profileDir(home);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'desktop-plugin-backups', stamp);
  fs.mkdirSync(backup, { recursive: true });
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
    const source = path.join(dir, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backup, name));
  }
  return backup;
}

function restoreProfile(backup, home) {
  const dir = profileDir(home);
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
    const source = path.join(backup, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, name));
  }
}

function runtimePnpmPath() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'runtime', 'pnpm'),
    path.join(__dirname, '..', 'runtime', 'pnpm')
  ];
  const bundled = candidates.find((candidate) => candidate && fs.existsSync(path.join(candidate, 'pnpm.cmd')));
  if (bundled) return bundled;
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = require('node:child_process');
      const found = execFileSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' })
        .split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      return found ? path.dirname(found) : null;
    } catch { return null; }
  }
  return null;
}

function runPluginCommand(action, spec, options = {}) {
  const home = options.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const node = resolveNodeExecutable();
  const bin = resolveDshBin();
  if (!node || !bin) return Promise.reject(new Error('找不到桌面 Node 或 DSH CLI'));
  if (!['add', 'remove'].includes(action)) return Promise.reject(new Error('不支持的插件操作'));
  if (action === 'remove' && !validatePackageName(spec)) return Promise.reject(new Error('插件包名不合法'));
  if (action === 'add' && !(validatePackageName(spec) || /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spec))) {
    return Promise.reject(new Error('插件来源不合法'));
  }

  const backup = backupProfile(home);
  const args = [bin, 'plugin', '--profile', PROFILE_NAME, action];
  if (action === 'add') args.push('--ignore-scripts');
  args.push(spec);
  const pnpmDir = runtimePnpmPath();
  if (!pnpmDir) return Promise.reject(new Error('找不到 pnpm。插件安装需要 pnpm 运行时；请安装 pnpm 后重试。'));
  const env = { ...process.env, DSH_HOME: home };
  if (pnpmDir) env.PATH = `${pnpmDir}${path.delimiter}${env.PATH || ''}`;

  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: options.cwd || os.homedir(), env, shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      restoreProfile(backup, home);
      reject(error);
    });
    child.on('exit', (code) => {
      const detail = Buffer.concat([...stdout, ...stderr]).toString('utf8').slice(-8000);
      if (code === 0) resolve({ ok: true, restartRequired: true, backup, detail });
      else {
        restoreProfile(backup, home);
        reject(new Error(formatPluginFailure(action, code, detail)));
      }
    });
  });
}

function formatPluginFailure(action, code, detail) {
  const verb = action === 'add' ? '安装' : '卸载';
  const raw = String(detail || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (/allowBuilds|git-hosted plugins|prepare script/i.test(raw)) {
    return `插件${verb}未完成：源码包需要运行第三方构建脚本，桌面端为安全起见没有自动放行。请使用该插件已发布的 npm 版本。`;
  }
  if (/ERR_PNPM_FETCH_404|404 Not Found|is not in the npm registry/i.test(raw)) {
    return `插件${verb}未完成：该仓库声明的包尚未发布到 npm，暂时不能安全安装。`;
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|fetch failed|ERR_PNPM_META_FETCH_FAIL/i.test(raw)) {
    return `插件${verb}未完成：无法连接插件源。请检查网络或代理后重试。`;
  }
  if (/pnpm not found|找不到 pnpm/i.test(raw)) {
    return `插件${verb}未完成：找不到 pnpm 运行时。`;
  }
  const readable = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes('\ufffd'))
    .slice(-3)
    .join(' ')
    .slice(0, 360);
  return `插件${verb}失败（退出码 ${code}）${readable ? `：${readable}` : '。请稍后重试。'}`;
}

module.exports = {
  compatibilityOf,
  DSH_MARKET_REGISTRY_URL,
  formatPluginFailure,
  isBundleManifest,
  listInstalled,
  profileDir,
  runPluginCommand,
  searchMarketplace,
  validatePackageName
};
