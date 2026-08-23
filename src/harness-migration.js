'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DSH_BASE = '@deepseek-ai/dsh-base';

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || ''));
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    pre: match[4] ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)) : []
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (a.pre.length === 0 || b.pre.length === 0) {
    if (a.pre.length === b.pre.length) return 0;
    return a.pre.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function installedBaseVersion(modulesDir) {
  const pkg = readJson(path.join(modulesDir, '@deepseek-ai', 'dsh-base', 'package.json'));
  return typeof pkg?.version === 'string' ? pkg.version : null;
}

function declaredWebVersion(webDir) {
  const pkg = readJson(path.join(webDir, 'package.json'));
  const value = pkg?.dependencies?.[DSH_BASE];
  return typeof value === 'string' && parseVersion(value) ? value : null;
}

function safeSegment(value) {
  return String(value || 'unknown').replace(/[^0-9A-Za-z._-]+/g, '_');
}

function timestampSegment(now) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Back up stale, generated profile dependencies before a Harness upgrade.
 * Sessions, attachments, settings, credentials, and cordis.patch.yml are
 * deliberately outside this migration.
 */
function migrateHarnessHome(options) {
  const home = path.resolve(options.home);
  const targetVersion = options.targetVersion;
  const profilesDir = path.join(home, 'profiles');
  const sharedModules = path.join(profilesDir, 'node_modules');
  const webDir = path.join(profilesDir, 'web');
  const sharedVersion = installedBaseVersion(sharedModules);
  const webVersion = installedBaseVersion(path.join(webDir, 'node_modules'));
  const declaredVersion = declaredWebVersion(webDir);

  const sharedStale = sharedVersion !== null && compareVersions(targetVersion, sharedVersion) === 1;
  const webReference = webVersion ?? declaredVersion;
  const webStale = webReference !== null && compareVersions(targetVersion, webReference) === 1;
  if (!sharedStale && !webStale) {
    return { migrated: false, targetVersion, sharedVersion, webVersion, declaredVersion, backupDir: null };
  }

  const from = [sharedVersion, webReference].filter(Boolean).join('+') || 'unknown';
  const backupDir = path.join(
    profilesDir,
    '.desktop-migration',
    `${timestampSegment(options.now ?? new Date())}-from-${safeSegment(from)}-to-${safeSegment(targetVersion)}`
  );
  if (fs.existsSync(backupDir)) throw new Error(`Harness 迁移备份目录已存在：${backupDir}`);

  const moves = [];
  const move = (source, relativeDestination) => {
    if (!fs.existsSync(source)) return;
    const destination = path.join(backupDir, relativeDestination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
    moves.push({ source, destination });
  };

  try {
    if (sharedStale) move(sharedModules, 'profiles-node_modules');
    if (webStale) {
      move(path.join(webDir, 'node_modules'), path.join('web', 'node_modules'));
      move(path.join(webDir, 'package.json'), path.join('web', 'package.json'));
      move(path.join(webDir, 'pnpm-lock.yaml'), path.join('web', 'pnpm-lock.yaml'));
      move(path.join(webDir, 'pnpm-workspace.yaml'), path.join('web', 'pnpm-workspace.yaml'));
    }
  } catch (error) {
    for (const item of moves.reverse()) {
      try {
        fs.mkdirSync(path.dirname(item.source), { recursive: true });
        fs.renameSync(item.destination, item.source);
      } catch {
        /* Keep the original error; the backup path is included below. */
      }
    }
    throw new Error(`Harness 运行目录迁移失败；可恢复备份位于 ${backupDir}: ${error.message}`, { cause: error });
  }

  return { migrated: true, targetVersion, sharedVersion, webVersion, declaredVersion, backupDir };
}

module.exports = { compareVersions, migrateHarnessHome };
