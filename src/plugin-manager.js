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
const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const MARKETPLACE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MARKETPLACE_MAX_BYTES = 5 * 1024 * 1024;
const GITHUB_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack'];

let marketplaceMemory = null;
let marketplaceRefresh = null;

function requestBuffer(url, headers = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const maxBytes = Number(options.maxBytes) || MARKETPLACE_MAX_BYTES;
  const maxRedirects = options.maxRedirects === undefined ? 4 : Number(options.maxRedirects);
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      if (request) request.destroy(new Error(`网络请求超过 ${Math.ceil(timeoutMs / 1000)} 秒`));
    }, timeoutMs);
    request = https.get(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'deepseek-harness-desktop',
        ...headers
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (maxRedirects <= 0) return finish(new Error('网络请求重定向次数过多'));
        const redirected = new URL(response.headers.location, url).toString();
        requestBuffer(redirected, headers, { timeoutMs, maxBytes, maxRedirects: maxRedirects - 1 })
          .then((value) => finish(null, value), finish);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => finish(new Error(`HTTP ${response.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 240)}`)));
        return;
      }
      const declared = Number(response.headers['content-length']) || 0;
      if (declared > maxBytes) {
        response.destroy();
        finish(new Error(`下载内容超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          finish(new Error(`下载内容超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, Buffer.concat(chunks)));
      response.on('error', finish);
    });
    request.on('error', finish);
  });
}

async function requestJson(url, headers = {}, options = {}) {
  const body = await requestBuffer(url, headers, options);
  return JSON.parse(body.toString('utf8'));
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function defaultHome() { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); }
function profileDir(home = defaultHome()) { return path.join(home, 'profiles', PROFILE_NAME); }
function marketplaceCacheFile(home = defaultHome()) { return path.join(home, 'desktop-marketplace-cache', 'plugins.json'); }
function sourceRecordsFile(home = defaultHome()) { return path.join(home, 'desktop-plugin-sources', 'installed-sources.json'); }
function repositoryKey(value) { return String(value || '').replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase(); }

function validatePackageName(name) {
  return typeof name === 'string' && PACKAGE_NAME.test(name) && !name.includes('..');
}

function isBundleManifest(manifest) {
  return Boolean(manifest && manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch !== undefined);
}

function compatibilityOf(manifest, harnessVersion) {
  const declared = manifest && manifest.peerDependencies && manifest.peerDependencies['@deepseek-ai/dsh'];
  if (typeof declared !== 'string' || !declared.trim()) return { status: 'unknown', declared: null };
  if (declared === harnessVersion || declared === `=${harnessVersion}` || declared === '*') return { status: 'compatible', declared };
  return { status: 'declared', declared };
}

function filterMarketplace(result, query = '') {
  const terms = String(query).trim().slice(0, 80).toLowerCase().split(/\s+/).filter(Boolean);
  const entries = Array.isArray(result && result.plugins) ? result.plugins : [];
  const rows = entries.map((entry) => {
    const owner = typeof entry.owner === 'string' ? entry.owner.trim() : '';
    const repositoryUrl = typeof entry.url === 'string' ? entry.url : '';
    const npmName = typeof entry.npm === 'string' && validatePackageName(entry.npm) ? entry.npm : '';
    const githubSpec = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(repositoryUrl);
    const installSpec = npmName || (githubSpec ? `github:${githubSpec[1]}` : '');
    if (!installSpec) return null;
    const descriptions = entry.description && typeof entry.description === 'object'
      ? Object.values(entry.description).filter((value) => typeof value === 'string').join(' ')
      : String(entry.description || '');
    const haystack = [entry.name, owner, repositoryUrl, entry.category, descriptions].filter(Boolean).join(' ').toLowerCase();
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

function readSourceRecords(home) {
  try {
    const value = readJson(sourceRecordsFile(home));
    return value && value.version === 1 && value.repositories && typeof value.repositories === 'object' ? value.repositories : {};
  } catch { return {}; }
}

function writeSourceRecords(home, repositories) {
  const file = sourceRecordsFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, repositories }, null, 2)}\n`, 'utf8');
}

function decorateInstalledSources(items, home) {
  const repositories = readSourceRecords(home);
  return items.map((item) => {
    const record = repositories[repositoryKey(item.repositoryUrl)];
    return record && validatePackageName(record.packageName) ? { ...item, installedPackageName: record.packageName } : item;
  });
}

function readMarketplaceDiskCache(home, registryUrl) {
  try {
    const envelope = readJson(marketplaceCacheFile(home));
    if (envelope.version !== 1 || envelope.registryUrl !== registryUrl || !Array.isArray(envelope.data && envelope.data.plugins)) return null;
    const cachedAt = Number(envelope.cachedAt);
    return Number.isFinite(cachedAt) && cachedAt > 0 ? { data: envelope.data, cachedAt } : null;
  } catch { return null; }
}

function writeMarketplaceDiskCache(home, registryUrl, data, cachedAt) {
  const file = marketplaceCacheFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify({ version: 1, registryUrl, cachedAt, data })}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function refreshMarketplace(options) {
  if (marketplaceRefresh) return marketplaceRefresh;
  const loadJson = options.requestJson || requestJson;
  marketplaceRefresh = Promise.resolve(loadJson(options.registryUrl, { accept: 'application/json' }, {
    timeoutMs: options.timeoutMs,
    maxBytes: MARKETPLACE_MAX_BYTES
  })).then((data) => {
    if (!Array.isArray(data && data.plugins)) throw new Error('插件目录格式不正确');
    const cachedAt = options.now();
    marketplaceMemory = { registryUrl: options.registryUrl, data, cachedAt };
    writeMarketplaceDiskCache(options.home, options.registryUrl, data, cachedAt);
    return marketplaceMemory;
  }).finally(() => { marketplaceRefresh = null; });
  return marketplaceRefresh;
}

async function searchMarketplace(query = '', options = {}) {
  const settings = {
    home: options.home || defaultHome(),
    registryUrl: options.registryUrl || DSH_MARKET_REGISTRY_URL,
    cacheTtlMs: options.cacheTtlMs === undefined ? MARKETPLACE_CACHE_TTL_MS : Number(options.cacheTtlMs),
    timeoutMs: Number(options.timeoutMs) || 15000,
    now: typeof options.now === 'function' ? options.now : Date.now,
    requestJson: options.requestJson
  };
  const now = settings.now();
  if (marketplaceMemory && marketplaceMemory.registryUrl === settings.registryUrl) {
    const fresh = now - marketplaceMemory.cachedAt < settings.cacheTtlMs;
    if (!fresh) refreshMarketplace(settings).catch(() => {});
    return { items: decorateInstalledSources(filterMarketplace(marketplaceMemory.data, query), settings.home), catalog: { source: fresh ? 'memory' : 'stale', cachedAt: marketplaceMemory.cachedAt, refreshing: !fresh } };
  }
  const disk = readMarketplaceDiskCache(settings.home, settings.registryUrl);
  if (disk) {
    marketplaceMemory = { registryUrl: settings.registryUrl, ...disk };
    const fresh = now - disk.cachedAt < settings.cacheTtlMs;
    if (!fresh) refreshMarketplace(settings).catch(() => {});
    return { items: decorateInstalledSources(filterMarketplace(disk.data, query), settings.home), catalog: { source: fresh ? 'disk' : 'stale', cachedAt: disk.cachedAt, refreshing: !fresh } };
  }
  const loaded = await refreshMarketplace(settings);
  return { items: decorateInstalledSources(filterMarketplace(loaded.data, query), settings.home), catalog: { source: 'network', cachedAt: loaded.cachedAt, refreshing: false } };
}

function resetMarketplaceCache() { marketplaceMemory = null; marketplaceRefresh = null; }

function listInstalled(home) {
  const dir = profileDir(home);
  const manifestFile = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestFile)) return [];
  const profile = readJson(manifestFile);
  const bundleSet = new Set((profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles) || []);
  const repositoryByPackage = new Map(Object.entries(readSourceRecords(home || defaultHome())).flatMap(([repositoryUrl, record]) => (
    record && validatePackageName(record.packageName) ? [[record.packageName, { repositoryUrl, ...record }]] : []
  )));
  return Object.entries(profile.dependencies || {}).map(([name, requested]) => {
    let installed = null;
    try { installed = readJson(path.join(dir, 'node_modules', ...name.split('/'), 'package.json')); } catch {}
    const sourceRecord = repositoryByPackage.get(name);
    return {
      name,
      requested,
      version: installed && typeof installed.version === 'string' ? installed.version : null,
      description: installed && typeof installed.description === 'string' ? installed.description : '',
      activeBundle: bundleSet.has(name),
      compatibility: compatibilityOf(installed, resolveDshVersion()),
      sourceKind: sourceRecord ? 'github' : 'npm',
      repositoryUrl: sourceRecord ? sourceRecord.repositoryUrl : null,
      installedCommit: sourceRecord && typeof sourceRecord.commit === 'string' ? sourceRecord.commit : null
    };
  });
}

function setPluginEnabled(name, enabled, options = {}) {
  if (!validatePackageName(name)) throw new Error('插件包名不合法');
  const home = options.home || defaultHome();
  const dir = profileDir(home);
  const manifestFile = path.join(dir, 'package.json');
  if (!fs.existsSync(manifestFile)) throw new Error('web profile 尚未初始化');
  const profile = readJson(manifestFile);
  if (!profile.dependencies || !Object.prototype.hasOwnProperty.call(profile.dependencies, name)) throw new Error('插件尚未安装');
  if (!profile.dsh || !profile.dsh.profile || !Array.isArray(profile.dsh.profile.bundles)) throw new Error('web profile 缺少 bundle 配置');
  const bundles = profile.dsh.profile.bundles;
  const active = bundles.includes(name);
  if (active === Boolean(enabled)) return { changed: false, enabled: active, restartRequired: false };
  const backup = backupProfile(home);
  profile.dsh.profile.bundles = enabled ? [...bundles, name] : bundles.filter((value) => value !== name);
  const temp = `${manifestFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, manifestFile);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch {}
    restoreProfile(backup, home);
    throw error;
  }
  return { changed: true, enabled: Boolean(enabled), restartRequired: true, backup };
}

function backupProfile(home) {
  const dir = profileDir(home);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(home || defaultHome(), 'desktop-plugin-backups', stamp);
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
  const candidates = [process.resourcesPath && path.join(process.resourcesPath, 'runtime', 'pnpm'), path.join(__dirname, '..', 'runtime', 'pnpm')];
  const bundled = candidates.find((candidate) => candidate && fs.existsSync(path.join(candidate, 'pnpm.cmd')));
  if (bundled) return bundled;
  if (process.platform === 'win32') {
    try {
      const { execFileSync } = require('node:child_process');
      const found = execFileSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' }).split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      return found ? path.dirname(found) : null;
    } catch { return null; }
  }
  return null;
}

function runPluginCommand(action, spec, options = {}) {
  const home = options.home || defaultHome();
  const node = resolveNodeExecutable();
  const bin = resolveDshBin();
  if (!node || !bin) return Promise.reject(new Error('找不到桌面 Node 或 DSH CLI'));
  if (!['add', 'remove'].includes(action)) return Promise.reject(new Error('不支持的插件操作'));
  if (action === 'remove' && !validatePackageName(spec)) return Promise.reject(new Error('插件包名不合法'));
  const validLocal = typeof spec === 'string' && /^file:[A-Za-z]:[\\/]/i.test(spec);
  if (action === 'add' && !(validatePackageName(spec) || validLocal || /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spec))) return Promise.reject(new Error('插件来源不合法'));
  const backup = backupProfile(home);
  const args = [bin, 'plugin', '--profile', PROFILE_NAME, action];
  if (action === 'add') args.push('--ignore-scripts');
  args.push(spec);
  const pnpmDir = runtimePnpmPath();
  if (!pnpmDir) return Promise.reject(new Error('找不到 pnpm。插件安装需要 pnpm 运行时；请安装 pnpm 后重试。'));
  const env = { ...process.env, DSH_HOME: home, PATH: `${pnpmDir}${path.delimiter}${process.env.PATH || ''}` };
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { cwd: options.cwd || os.homedir(), env, shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => { restoreProfile(backup, home); reject(error); });
    child.on('exit', (code) => {
      const detail = Buffer.concat([...stdout, ...stderr]).toString('utf8').slice(-8000);
      if (code === 0) {
        if (action === 'remove') {
          const repositories = readSourceRecords(home);
          for (const [repositoryUrl, record] of Object.entries(repositories)) {
            if (record && record.packageName === spec) delete repositories[repositoryUrl];
          }
          writeSourceRecords(home, repositories);
        }
        resolve({ ok: true, restartRequired: true, backup, detail });
      }
      else { restoreProfile(backup, home); reject(new Error(formatPluginFailure(action, code, detail))); }
    });
  });
}

function parseGitHubRepository(item) {
  const repositoryUrl = item && typeof item.repositoryUrl === 'string' ? item.repositoryUrl.trim() : '';
  const installSpec = item && typeof item.installSpec === 'string' ? item.installSpec.trim() : '';
  const urlMatch = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(repositoryUrl);
  const specMatch = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i.exec(installSpec);
  const match = urlMatch || specMatch;
  if (!match) throw new Error('GitHub 插件仓库地址不合法');
  return { owner: match[1], repo: match[2] };
}

function safeManifestPath(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 路径缺失`);
  const clean = value.trim().replace(/^\.\//, '');
  if (clean.includes('\\') || path.posix.isAbsolute(clean) || clean === '..' || clean.startsWith('../') || clean.includes('/../')) throw new Error(`${label} 路径不安全`);
  const normalized = path.posix.normalize(clean);
  if (!normalized || normalized === '.' || normalized.startsWith('../')) throw new Error(`${label} 路径不安全`);
  return normalized;
}

function collectExportPaths(value, output = []) {
  if (typeof value === 'string') { if (value.startsWith('./')) output.push(value); }
  else if (Array.isArray(value)) { for (const item of value) collectExportPaths(item, output); }
  else if (value && typeof value === 'object') { for (const item of Object.values(value)) collectExportPaths(item, output); }
  return output;
}

function validateGitHubManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('插件 package.json 格式不正确');
  if (!validatePackageName(manifest.name)) throw new Error('插件 package name 不合法');
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) throw new Error('插件 version 必须是字符串');
  if (!isBundleManifest(manifest)) throw new Error('插件没有声明 dsh.bundle.patch，不能作为 Harness bundle 安装');
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {};
  const blockedScripts = LIFECYCLE_SCRIPTS.filter((name) => typeof scripts[name] === 'string' && scripts[name].trim());
  if (blockedScripts.length) throw new Error(`插件包含安装构建脚本（${blockedScripts.join(', ')}），桌面端不会自动执行；请等待作者发布 npm 或 Release 成品包`);
  const patch = safeManifestPath(manifest.dsh.bundle.patch, 'bundle patch');
  const entries = [];
  if (typeof manifest.main === 'string') entries.push(manifest.main);
  if (typeof manifest.module === 'string') entries.push(manifest.module);
  collectExportPaths(manifest.exports, entries);
  const safeEntries = [...new Set(entries.map((value) => safeManifestPath(value, '插件入口')))];
  if (!safeEntries.length) throw new Error('插件没有可验证的 main/module/exports 成品入口');
  return { name: manifest.name, version: manifest.version.trim(), patch, entries: safeEntries };
}

async function resolveGitHubCandidate(item, options = {}) {
  const { owner, repo } = parseGitHubRepository(item);
  const loadJson = options.requestJson || requestJson;
  const loadBuffer = options.requestBuffer || requestBuffer;
  const commitInfo = await loadJson(`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`, { accept: 'application/vnd.github+json' }, { timeoutMs: 15000, maxBytes: 1024 * 1024 });
  const commit = commitInfo && commitInfo.sha;
  if (typeof commit !== 'string' || !COMMIT_SHA.test(commit)) throw new Error('GitHub 未返回可锁定的 40 位 commit SHA');
  const rawRoot = `https://raw.githubusercontent.com/${owner}/${repo}/${commit}`;
  const manifestBuffer = await loadBuffer(`${rawRoot}/package.json`, { accept: 'application/json' }, { timeoutMs: 15000, maxBytes: 1024 * 1024 });
  let manifest;
  try { manifest = JSON.parse(Buffer.from(manifestBuffer).toString('utf8')); } catch { throw new Error('插件 package.json 无法解析'); }
  const validated = validateGitHubManifest(manifest);
  await Promise.all([validated.patch, ...validated.entries].map(async (file) => {
    const body = await loadBuffer(`${rawRoot}/${file.split('/').map(encodeURIComponent).join('/')}`, { accept: '*/*' }, { timeoutMs: 15000, maxBytes: 8 * 1024 * 1024 });
    if (!body || body.length === 0) throw new Error(`插件文件为空：${file}`);
  }));
  return { owner, repo, commit, manifest, ...validated };
}

function sourceCacheDir(home, candidate) {
  const packagePart = candidate.name.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(home, 'desktop-plugin-sources', `${packagePart}-${candidate.commit.slice(0, 12)}`);
}

function validateExtractedTree(root, candidate) {
  let count = 0;
  let total = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      count += 1;
      if (count > 10000) throw new Error('插件源码文件数量超过安全限制');
      const file = path.join(dir, entry.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('插件源码包含符号链接，桌面端拒绝安装');
      if (stat.isDirectory()) walk(file);
      else { total += stat.size; if (total > 200 * 1024 * 1024) throw new Error('插件解压后体积超过 200 MB 安全限制'); }
    }
  };
  walk(root);
  const checked = validateGitHubManifest(readJson(path.join(root, 'package.json')));
  if (checked.name !== candidate.name || checked.version !== candidate.version) throw new Error('解压后的插件 manifest 与已验证版本不一致');
  for (const file of [checked.patch, ...checked.entries]) {
    const target = path.resolve(root, ...file.split('/'));
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`插件缺少已声明文件：${file}`);
  }
}

function findTarExecutable() {
  const systemTar = process.platform === 'win32' && process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : null;
  return systemTar && fs.existsSync(systemTar) ? systemTar : (process.platform === 'win32' ? 'tar.exe' : 'tar');
}

function spawnCollect(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, shell: false, windowsHide: true });
    const output = [];
    if (child.stdout) child.stdout.on('data', (chunk) => output.push(chunk));
    if (child.stderr) child.stderr.on('data', (chunk) => output.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      const detail = Buffer.concat(output).toString('utf8').slice(-4000);
      if (code === 0) resolve(detail); else reject(new Error(`插件源码解压失败（退出码 ${code}）${detail ? `：${detail}` : ''}`));
    });
  });
}

async function prepareGitHubSource(candidate, options = {}) {
  const home = options.home || defaultHome();
  const finalDir = sourceCacheDir(home, candidate);
  if (fs.existsSync(finalDir)) { validateExtractedTree(finalDir, candidate); return finalDir; }
  const loadBuffer = options.requestBuffer || requestBuffer;
  const cacheRoot = path.dirname(finalDir);
  fs.mkdirSync(cacheRoot, { recursive: true });
  const temp = fs.mkdtempSync(path.join(cacheRoot, '.download-'));
  try {
    const archive = await loadBuffer(`https://codeload.github.com/${candidate.owner}/${candidate.repo}/tar.gz/${candidate.commit}`, { accept: 'application/gzip' }, { timeoutMs: 45000, maxBytes: GITHUB_ARCHIVE_MAX_BYTES });
    const archiveFile = path.join(temp, 'source.tar.gz');
    const extractDir = path.join(temp, 'extract');
    fs.writeFileSync(archiveFile, Buffer.from(archive));
    fs.mkdirSync(extractDir);
    await spawnCollect(findTarExecutable(), ['-xzf', archiveFile, '-C', extractDir]);
    const roots = fs.readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (roots.length !== 1) throw new Error('GitHub 源码包目录结构不正确');
    const extractedRoot = path.join(extractDir, roots[0].name);
    validateExtractedTree(extractedRoot, candidate);
    try { fs.renameSync(extractedRoot, finalDir); } catch (error) { if (!fs.existsSync(finalDir)) throw error; }
    validateExtractedTree(finalDir, candidate);
    return finalDir;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

async function installMarketplacePlugin(item, options = {}) {
  if (!item || typeof item !== 'object') throw new Error('插件安装信息不完整');
  if (item.source === 'npm') {
    if (!validatePackageName(item.installSpec)) throw new Error('npm 插件包名不合法');
    return runPluginCommand('add', item.installSpec, options);
  }
  if (item.source !== 'github') throw new Error('不支持的插件来源');
  const candidate = await resolveGitHubCandidate(item, options);
  const sourceDir = await prepareGitHubSource(candidate, options);
  const result = await runPluginCommand('add', `file:${sourceDir}`, options);
  const installed = listInstalled(options.home || defaultHome()).find((entry) => entry.name === candidate.name);
  if (!installed || !installed.activeBundle) {
    restoreProfile(result.backup, options.home || defaultHome());
    throw new Error('插件文件已下载，但没有成功加入 Harness bundle；已恢复安装前配置');
  }
  const home = options.home || defaultHome();
  const repositories = readSourceRecords(home);
  repositories[repositoryKey(`https://github.com/${candidate.owner}/${candidate.repo}`)] = {
    packageName: candidate.name,
    version: candidate.version,
    commit: candidate.commit,
    installedAt: new Date().toISOString()
  };
  writeSourceRecords(home, repositories);
  return { ...result, packageName: candidate.name, version: candidate.version, commit: candidate.commit, sourceKind: 'github-verified' };
}

async function updateInstalledPlugin(name, options = {}) {
  if (!validatePackageName(name)) throw new Error('插件包名不合法');
  const home = options.home || defaultHome();
  const installed = listInstalled(home).find((item) => item.name === name);
  if (!installed) throw new Error('插件尚未安装');
  const before = { version: installed.version, commit: installed.installedCommit };
  const installPlugin = options.installPlugin || installMarketplacePlugin;
  const runCommand = options.runCommand || runPluginCommand;
  let result;
  if (installed.sourceKind === 'github' && installed.repositoryUrl) {
    result = await installPlugin({
      name,
      source: 'github',
      installSpec: `github:${installed.repositoryUrl.replace(/^https?:\/\/github\.com\//i, '')}`,
      repositoryUrl: installed.repositoryUrl
    }, { ...options, home });
  } else {
    result = await runCommand('add', name, { ...options, home });
  }
  const current = listInstalled(home).find((item) => item.name === name);
  return {
    ...result,
    packageName: name,
    previousVersion: before.version,
    version: current && current.version,
    previousCommit: before.commit,
    commit: current && current.installedCommit,
    updated: Boolean(current && ((before.version && current.version !== before.version) || (before.commit && current.installedCommit !== before.commit)))
  };
}

function formatPluginFailure(action, code, detail) {
  const verb = action === 'add' ? '安装' : '卸载';
  const raw = String(detail || '').replace(/\x1b\[[0-9;]*m/g, '');
  if (/allowBuilds|git-hosted plugins|prepare script/i.test(raw)) return `插件${verb}未完成：源码包需要运行第三方构建脚本，桌面端为安全起见没有自动放行。请使用该插件已发布的 npm 或 Release 成品版本。`;
  if (/ERR_PNPM_FETCH_404|404 Not Found|is not in the npm registry/i.test(raw)) return `插件${verb}未完成：该仓库声明的包尚未发布到 npm。`;
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|fetch failed|ERR_PNPM_META_FETCH_FAIL/i.test(raw)) return `插件${verb}未完成：无法连接插件源。请检查网络或代理后重试。`;
  if (/pnpm not found|找不到 pnpm/i.test(raw)) return `插件${verb}未完成：找不到 pnpm 运行时。`;
  const readable = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.includes('\ufffd')).slice(-3).join(' ').slice(0, 360);
  return `插件${verb}失败（退出码 ${code}）${readable ? `：${readable}` : '。请稍后重试。'}`;
}

module.exports = {
  compatibilityOf,
  DSH_MARKET_REGISTRY_URL,
  filterMarketplace,
  formatPluginFailure,
  installMarketplacePlugin,
  isBundleManifest,
  listInstalled,
  marketplaceCacheFile,
  parseGitHubRepository,
  prepareGitHubSource,
  profileDir,
  requestBuffer,
  requestJson,
  resetMarketplaceCache,
  resolveGitHubCandidate,
  runPluginCommand,
  runtimePnpmPath,
  setPluginEnabled,
  safeManifestPath,
  searchMarketplace,
  validateGitHubManifest,
  updateInstalledPlugin,
  validatePackageName
};
