'use strict';

/**
 * Harness updater, used by the Electron main process.
 *
 * The official repo (deepseek-ai/deepseek-harness) does not publish GitHub
 * "releases"; its default branch (`master`) is the moving "latest". So:
 *   - checkLatest()      compare the vendored harness version against the
 *                        default branch's package.json version.
 *   - applyUpdate(emit)  download the default branch, re-apply the vendor
 *                        patches, and rebuild the vendored harness.
 *
 * Patch re-application is driven by `vendor-patches/manifest.json`:
 *   kind "dir" / "new"    copied in; they do not exist upstream, so they never
 *                         conflict.
 *   kind "overwrite"      replace an upstream file. These are reported back in
 *                         `overwritten` because the new upstream may have
 *                         changed that same file, so a human should review
 *                         whether the patch dropped a fresh upstream change.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_ROOT = path.join(__dirname, '..');
const VENDOR_DIR = path.join(APP_ROOT, 'vendor', 'deepseek-harness');
const PATCHES_DIR = path.join(APP_ROOT, 'vendor-patches');
const MANIFEST_PATH = path.join(PATCHES_DIR, 'manifest.json');

const GH_HEADERS = { 'user-agent': 'dsh-desktop', accept: 'application/vnd.github+json' };

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
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

/** Fetch the upstream default branch name and its package.json version. */
async function latestInfo() {
  const repo = readManifest().repo;
  const infoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: GH_HEADERS });
  if (!infoRes.ok) throw new Error(`GitHub API responded ${infoRes.status}`);
  const info = await infoRes.json();
  const branch = info.default_branch || 'master';

  const pkgRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`,
    { headers: { 'user-agent': 'dsh-desktop', accept: 'application/vnd.github.raw+json' } },
  );
  if (!pkgRes.ok) throw new Error(`读取官方 package.json 失败：HTTP ${pkgRes.status}`);
  const pkg = JSON.parse(await pkgRes.text());
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error('官方 package.json 没有 version 字段');
  }
  return { branch, version: pkg.version };
}

/** Check whether the upstream default branch is newer than the vendored copy. */
async function checkLatest() {
  const { branch, version } = await latestInfo();
  const current = currentVersion();
  return { latest: version, current, hasUpdate: current !== version };
}

/** Spawn a command and stream its output to `emit`. Resolves with the full log
 *  on success, rejects with the tail of the log on a non-zero exit. */
function runCommand(cmd, args, cwd, emit) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true, env: { ...process.env } });
    let log = '';
    const onChunk = (chunk) => {
      const text = chunk.toString();
      log += text;
      if (emit) emit(text);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(log);
      else reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}\n${log.slice(-2000)}`));
    });
  });
}

async function downloadZip(url, dest, emit) {
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-desktop' } });
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (reader) {
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      if (emit && total > 0) emit(`下载中 ${Math.round((received / total) * 100)}%…\n`);
    }
    fs.writeFileSync(dest, Buffer.concat(chunks));
  } else {
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

/** Extract a ZIP archive using the system PowerShell (Windows). */
async function extractZip(zip, dest, emit) {
  fs.mkdirSync(dest, { recursive: true });
  const q = (p) => `'${p.replace(/'/g, "''")}'`;
  await runCommand('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path ${q(zip)} -DestinationPath ${q(dest)} -Force`,
  ], undefined, emit);
}

/** Copy one manifest entry (a file or a whole directory) into `root`. */
function copyEntry(root, entry) {
  const from = path.join(PATCHES_DIR, entry.src);
  const to = path.join(root, entry.dst);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: entry.kind === 'dir' });
}

/** Find the single top-level directory inside a freshly extracted codeload
 *  archive (named `<repo>-<ref>/`). */
function findExtractedRoot(extractDir) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  if (entries.length === 0) throw new Error('压缩包里没有找到源码目录');
  return path.join(extractDir, entries[0].name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rename with a short retry: on Windows the OS may briefly hold a directory
 *  lock right after the service tree is killed. */
async function renameRetry(from, to, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (i === attempts - 1) throw error;
      await sleep(500 * (i + 1));
    }
  }
}

/**
 * Download the latest upstream source, re-apply the vendor patches, swap it
 * into `vendor/deepseek-harness`, and rebuild. Returns the new version and the
 * list of upstream files the patches overwrote (the ones to review).
 * @param emit - optional `(text: string) => void` progress sink.
 */
async function applyUpdate(emit) {
  const manifest = readManifest();
  const { branch, version } = await latestInfo();
  const stage = path.join(os.tmpdir(), `dsh-update-${Date.now()}`);

  emit && emit(`开始更新到 ${version}（${branch} 分支）…\n`);
  fs.mkdirSync(stage, { recursive: true });

  const zip = path.join(stage, 'source.zip');
  const extractDir = path.join(stage, 'extracted');
  emit && emit('下载官方源码 …\n');
  await downloadZip(`https://codeload.github.com/${manifest.repo}/zip/${encodeURIComponent(branch)}`, zip, emit);
  emit && emit('解压 …\n');
  await extractZip(zip, extractDir, emit);

  const root = findExtractedRoot(extractDir);
  const overwritten = [];
  emit && emit('重放补丁 …\n');
  for (const entry of manifest.entries) {
    copyEntry(root, entry);
    if (entry.kind === 'overwrite') overwritten.push(entry.dst);
  }

  // Swap: keep the old tree as a backup until the build succeeds.
  const backup = `${VENDOR_DIR}.bak-${Date.now()}`;
  const hadOld = fs.existsSync(VENDOR_DIR);
  if (hadOld) await renameRetry(VENDOR_DIR, backup);
  fs.mkdirSync(path.dirname(VENDOR_DIR), { recursive: true });
  await renameRetry(root, VENDOR_DIR);

  emit && emit('安装依赖 + 重建（需要几分钟）…\n');
  try {
    await runCommand('pnpm', ['install'], VENDOR_DIR, emit);
    await runCommand('pnpm', ['run', 'gen-persistence-catalog'], VENDOR_DIR, emit);
    await runCommand('pnpm', ['run', 'build'], VENDOR_DIR, emit);
  } catch (error) {
    // Restore the previous tree so the app keeps working.
    if (fs.existsSync(VENDOR_DIR)) fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
    if (hadOld && fs.existsSync(backup)) fs.renameSync(backup, VENDOR_DIR);
    throw error;
  }
  if (hadOld && fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });

  return { version, overwritten };
}

module.exports = { checkLatest, applyUpdate, currentVersion };
