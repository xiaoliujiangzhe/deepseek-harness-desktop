'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultHarnessHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function credentialFile(home = defaultHarnessHome()) {
  return path.join(home, '.credentials.yaml');
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 200000);
}

function commandVersion(executable, args = ['--version']) {
  if (!executable || !fs.existsSync(executable)) return null;
  try {
    return String(execFileSync(executable, args, { encoding: 'utf8', timeout: 8000, windowsHide: true, shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable) })).trim().split(/\r?\n/)[0] || null;
  } catch { return null; }
}

function credentialsVersionState(file = credentialFile()) {
  if (!fs.existsSync(file)) return { exists: false, valid: true, value: null };
  let text;
  try { text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch (error) { return { exists: true, valid: false, value: null, error: error.message }; }
  const match = text.match(/^version\s*:\s*([^#\r\n]+?)\s*(?:#.*)?$/m);
  if (!match) return { exists: true, valid: false, value: null, error: '缺少 version 字段' };
  const raw = match[1].trim();
  if (raw === '1') return { exists: true, valid: true, repairable: false, value: raw };
  const repairable = raw === '"1"' || raw === "'1'";
  return {
    exists: true,
    valid: false,
    repairable,
    value: raw,
    error: repairable
      ? 'version 使用了旧版字符串格式，需要迁移为数字 1'
      : 'version 必须是数字 1；当前值无法安全自动修复'
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupConfiguration(options = {}) {
  const home = options.home || defaultHarnessHome();
  const destination = options.destination || path.join(home, 'desktop-repair-backups', timestamp());
  fs.mkdirSync(destination, { recursive: true });
  const files = [
    '.credentials.yaml',
    'settings.yaml',
    path.join('profiles', 'web', 'package.json'),
    path.join('profiles', 'web', 'pnpm-lock.yaml'),
    path.join('profiles', 'web', 'pnpm-workspace.yaml'),
    path.join('profiles', 'web', 'cordis.patch.yml'),
    path.join('profiles', 'web', 'cordis.yml')
  ];
  const copied = [];
  for (const relative of files) {
    const source = path.join(home, relative);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied.push(relative.replace(/\\/g, '/'));
  }
  fs.writeFileSync(path.join(destination, 'backup.json'), `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: copied }, null, 2)}\n`, 'utf8');
  return { destination, copied };
}

function repairCredentialsVersion(options = {}) {
  const home = options.home || defaultHarnessHome();
  const file = credentialFile(home);
  const state = credentialsVersionState(file);
  if (!state.exists) throw new Error('没有找到 .credentials.yaml');
  if (state.valid) return { changed: false, file, message: 'credentials version 已与当前 Harness 兼容' };
  if (!state.repairable) {
    throw new Error(state.error || '无法安全修复 credentials version');
  }
  const backup = `${file}.desktop-backup-${timestamp()}`;
  fs.copyFileSync(file, backup);
  const original = fs.readFileSync(file, 'utf8');
  const updated = original.replace(/^(\uFEFF?version\s*:\s*)(["']1["'])(\s*(?:#.*)?)$/m, (_whole, prefix, _legacy, suffix) => `${prefix}1${suffix}`);
  if (updated === original) throw new Error('无法安全定位顶层 credentials version 字段');
  fs.writeFileSync(file, updated, 'utf8');
  return { changed: true, file, backup, message: '已备份凭据配置，并将 version 迁移为当前 Harness 使用的数字格式' };
}

function clearMarketplaceCache(options = {}) {
  const home = options.home || defaultHarnessHome();
  const directory = path.join(home, 'desktop-marketplace-cache');
  if (!fs.existsSync(directory)) return { changed: false, directory };
  fs.rmSync(directory, { recursive: true, force: true });
  return { changed: true, directory };
}

async function buildDiagnosticReport(options = {}) {
  const home = options.home || defaultHarnessHome();
  const workspace = options.workspace || os.homedir();
  const nodePath = options.nodePath || null;
  const dshBin = options.dshBin || null;
  const pnpmPath = options.pnpmPath || null;
  const checks = [];
  const add = (id, label, status, summary, extra = {}) => checks.push({ id, label, status, summary, ...extra });

  const nodeVersion = commandVersion(nodePath);
  add('node', 'Node.js 运行时', nodeVersion ? 'ok' : 'error', nodeVersion ? `${nodeVersion} · ${nodePath}` : '未找到可用 Node.js');
  add('harness', 'Harness CLI', dshBin && fs.existsSync(dshBin) ? 'ok' : 'error', options.harnessVersion ? `${options.harnessVersion} · ${dshBin}` : '未找到 Harness CLI');
  const pnpmVersion = commandVersion(pnpmPath);
  add('pnpm', 'pnpm 运行时', pnpmVersion ? 'ok' : 'error', pnpmVersion ? `${pnpmVersion} · ${pnpmPath}` : '未找到可用 pnpm');

  let workspaceWritable = false;
  try { fs.accessSync(workspace, fs.constants.R_OK | fs.constants.W_OK); workspaceWritable = true; } catch {}
  add('workspace', '工作区', workspaceWritable ? 'ok' : 'error', workspaceWritable ? workspace : `无法读写：${workspace}`);
  add('home', 'DSH 数据目录', fs.existsSync(home) ? 'ok' : 'warn', fs.existsSync(home) ? home : `尚未创建：${home}`);

  const credentialState = credentialsVersionState(credentialFile(home));
  if (!credentialState.exists) add('credentials-version', '凭据配置', 'warn', '尚未创建 .credentials.yaml');
  else if (credentialState.valid) add('credentials-version', '凭据配置', 'ok', 'version 字段类型正确');
  else add('credentials-version', '凭据配置', 'error', credentialState.error || 'version 必须是数字 1', credentialState.repairable ? { repair: 'credentials-version' } : {});

  const profileManifest = path.join(home, 'profiles', 'web', 'package.json');
  try {
    const profile = JSON.parse(fs.readFileSync(profileManifest, 'utf8'));
    const bundles = profile && profile.dsh && profile.dsh.profile && profile.dsh.profile.bundles;
    add('web-profile', 'Web profile', Array.isArray(bundles) ? 'ok' : 'error', Array.isArray(bundles) ? `${bundles.length} 个 bundle` : '缺少 dsh.profile.bundles');
  } catch (error) {
    add('web-profile', 'Web profile', fs.existsSync(profileManifest) ? 'error' : 'warn', fs.existsSync(profileManifest) ? `package.json 无法解析：${error.message}` : '尚未初始化');
  }

  if (Array.isArray(options.networkChecks)) {
    for (const item of options.networkChecks) add(item.id, item.label, item.ok ? 'ok' : 'warn', item.summary);
  }
  add('service', '本地 Harness 服务', options.serviceReady ? 'ok' : 'warn', options.serviceReady ? (options.serviceUrl || '运行中') : '当前未就绪');
  add('proxy', '网络代理', options.proxyEnabled ? 'ok' : 'warn', options.proxyEnabled ? '已检测到代理环境变量' : '未设置代理环境变量');

  const counts = checks.reduce((value, check) => { value[check.status] += 1; return value; }, { ok: 0, warn: 0, error: 0 });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    appVersion: options.appVersion || null,
    platform: `${process.platform} ${process.arch}`,
    checks,
    summary: counts
  };
}

module.exports = {
  backupConfiguration,
  buildDiagnosticReport,
  clearMarketplaceCache,
  commandVersion,
  credentialFile,
  credentialsVersionState,
  redactSecrets,
  repairCredentialsVersion
};
