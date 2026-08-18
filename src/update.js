'use strict';

/**
 * Harness version check, used by the Electron main process.
 *
 * The official repo (deepseek-ai/deepseek-harness) does not publish GitHub
 * "releases"; its default branch (`master`) is the moving "latest". So
 * `checkLatest()` compares the vendored harness version against the default
 * branch's package.json version.
 *
 * IMPORTANT: this desktop build ships a *forked* harness (`vendor/` plus the
 * patches in `vendor-patches/`). "A newer upstream version exists" only means
 * the official repo moved on; actually adopting it requires re-applying the
 * patches and rebuilding (run `setup-harness.cmd`, or have a maintainer merge
 * the patches). That step is deliberately NOT automated in-app — it is a
 * maintainer task, not a one-click user action, because patches can conflict
 * with upstream changes.
 */

const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(APP_ROOT, 'vendor', 'deepseek-harness');
const MANIFEST_PATH = path.join(APP_ROOT, 'vendor-patches', 'manifest.json');

const GH_HEADERS = { 'user-agent': 'dsh-desktop', accept: 'application/vnd.github+json' };

/** Upstream repo, from the patch manifest (fallback to the official repo). */
function manifestRepo() {
  try {
    const repo = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).repo;
    if (typeof repo === 'string' && repo.length > 0) return repo;
  } catch {
    /* fall through */
  }
  return 'deepseek-ai/deepseek-harness';
}

/** Vendored harness version, or null while the vendored tree is absent
 *  (the app then falls back to the npm `@deepseek-ai/dsh` package). */
function currentVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

/** Latest upstream version = the default branch's package.json version. */
async function latestVersion() {
  const repo = manifestRepo();
  const infoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: GH_HEADERS });
  if (!infoRes.ok) throw new Error(`GitHub API responded ${infoRes.status}`);
  const branch = (await infoRes.json()).default_branch || 'master';

  const pkgRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`,
    { headers: { 'user-agent': 'dsh-desktop', accept: 'application/vnd.github.raw+json' } },
  );
  if (!pkgRes.ok) throw new Error(`读取官方 package.json 失败：HTTP ${pkgRes.status}`);
  const version = JSON.parse(await pkgRes.text()).version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('官方 package.json 没有 version 字段');
  }
  return version;
}

/** Compare the vendored harness version against the latest upstream version. */
async function checkLatest() {
  const latest = await latestVersion();
  const current = currentVersion();
  return { latest, current, hasUpdate: current !== latest };
}

module.exports = { checkLatest, currentVersion };
