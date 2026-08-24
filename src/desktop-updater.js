'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const UPDATE_MODES = new Set(['default', 'start', 'manual', 'none']);
const UPDATE_CHANNELS = new Set(['stable', 'preview']);
const AUTOMATIC_CHECK_DELAY_MS = 30 * 1000;
const AUTOMATIC_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

function normalizeUpdatePreferences(value = {}) {
  const mode = UPDATE_MODES.has(value.mode) ? value.mode : 'default';
  const channel = UPDATE_CHANNELS.has(value.channel) ? value.channel : 'stable';
  return {
    mode,
    channel,
    skippedVersion: typeof value.skippedVersion === 'string' ? value.skippedVersion.trim() : ''
  };
}

function safeVersion(executable) {
  if (!executable) return null;
  try {
    return execFileSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    }).trim() || null;
  } catch {
    return null;
  }
}

function readPortableNodeVersion(executable) {
  if (!executable) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(executable), 'runtime.json'), 'utf8'));
    if (typeof manifest.version === 'string' && manifest.version.trim()) return manifest.version.trim();
  } catch {
    /* fall back to executing the selected runtime */
  }
  return safeVersion(executable);
}

function normalizeReleaseNotes(notes) {
  if (typeof notes === 'string') return notes.trim();
  if (Array.isArray(notes)) {
    return notes.map((item) => typeof item === 'string' ? item : item && item.note).filter(Boolean).join('\n\n').trim();
  }
  return '';
}

function errorMessage(error) {
  const message = error && error.message ? error.message : String(error || '未知错误');
  if (/404|latest\.yml|no published versions/i.test(message)) return '没有找到可用的 GitHub Release 更新元数据';
  if (/429|rate limit/i.test(message)) return 'GitHub 请求过于频繁，请稍后重试';
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|ERR_NETWORK|fetch failed/i.test(message)) return '无法连接更新服务器，请检查网络或代理设置';
  return message;
}

class DesktopUpdateService {
  constructor(options) {
    this.app = options.app;
    this.autoUpdater = options.autoUpdater;
    this.onState = options.onState || (() => {});
    this.getPreferences = options.getPreferences || (() => ({}));
    this.savePreferences = options.savePreferences || (() => {});
    this.components = { ...(options.components || {}) };
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.setInterval = options.setInterval || setInterval;
    this.clearInterval = options.clearInterval || clearInterval;
    this.initialTimer = null;
    this.intervalTimer = null;
    this.initialized = false;
    this.manualCheck = false;
    this.state = {
      status: 'idle',
      appVersion: this.app.getVersion(),
      packaged: Boolean(this.app.isPackaged),
      availableVersion: null,
      releaseDate: null,
      releaseName: '',
      releaseNotes: '',
      progress: null,
      message: this.app.isPackaged ? '准备检查更新' : '开发预览模式不会下载安装包',
      lastCheckedAt: null,
      components: this.components,
      preferences: normalizeUpdatePreferences(this.getPreferences())
    };
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  emit(patch = {}) {
    this.state = { ...this.state, ...patch };
    this.onState(this.snapshot());
    return this.snapshot();
  }

  initialize() {
    if (this.initialized) return this.snapshot();
    this.initialized = true;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowDowngrade = false;
    this.applyPreferences(this.state.preferences, false);

    this.autoUpdater.on('checking-for-update', () => {
      this.emit({ status: 'checking', message: '正在连接更新服务器…', progress: null });
    });
    this.autoUpdater.on('update-available', (info = {}) => {
      const preferences = normalizeUpdatePreferences(this.getPreferences());
      const version = typeof info.version === 'string' ? info.version : null;
      const skipped = !this.manualCheck && version && preferences.skippedVersion === version;
      this.emit({
        status: skipped ? 'skipped' : 'available',
        availableVersion: version,
        releaseDate: info.releaseDate || null,
        releaseName: typeof info.releaseName === 'string' ? info.releaseName : '',
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        lastCheckedAt: new Date().toISOString(),
        message: skipped ? `已按设置跳过 ${version}` : `发现新版本 ${version || ''}`.trim(),
        preferences
      });
    });
    this.autoUpdater.on('update-not-available', () => {
      this.emit({
        status: 'not-available',
        availableVersion: null,
        progress: null,
        lastCheckedAt: new Date().toISOString(),
        message: '当前已经是最新版本'
      });
    });
    this.autoUpdater.on('download-progress', (progress = {}) => {
      this.emit({
        status: 'downloading',
        progress: {
          percent: Number(progress.percent) || 0,
          transferred: Number(progress.transferred) || 0,
          total: Number(progress.total) || 0,
          bytesPerSecond: Number(progress.bytesPerSecond) || 0
        },
        message: `正在下载 ${Math.max(0, Math.min(100, Number(progress.percent) || 0)).toFixed(1)}%`
      });
    });
    this.autoUpdater.on('update-downloaded', (info = {}) => {
      this.emit({
        status: 'ready',
        availableVersion: typeof info.version === 'string' ? info.version : this.state.availableVersion,
        releaseDate: info.releaseDate || this.state.releaseDate,
        releaseName: typeof info.releaseName === 'string' ? info.releaseName : this.state.releaseName,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes) || this.state.releaseNotes,
        progress: { ...(this.state.progress || {}), percent: 100 },
        message: '更新已下载，重启应用即可安装'
      });
    });
    this.autoUpdater.on('update-cancelled', () => {
      this.emit({ status: 'available', progress: null, message: '更新下载已取消' });
    });
    this.autoUpdater.on('error', (error) => {
      this.emit({ status: 'error', progress: null, message: errorMessage(error) });
    });

    this.scheduleAutomaticChecks();
    return this.snapshot();
  }

  applyPreferences(value, persist = true) {
    const preferences = normalizeUpdatePreferences(value);
    this.state.preferences = preferences;
    this.autoUpdater.allowPrerelease = preferences.channel === 'preview';
    if (persist) this.savePreferences(preferences);
    if (this.initialized) this.scheduleAutomaticChecks();
    return this.emit({ preferences });
  }

  scheduleAutomaticChecks() {
    if (this.initialTimer) this.clearTimeout(this.initialTimer);
    if (this.intervalTimer) this.clearInterval(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
    if (!this.app.isPackaged) return;
    const { mode } = normalizeUpdatePreferences(this.getPreferences());
    if (mode !== 'default' && mode !== 'start') return;
    this.initialTimer = this.setTimeout(() => this.check(false).catch(() => {}), AUTOMATIC_CHECK_DELAY_MS);
    if (mode === 'default') {
      this.intervalTimer = this.setInterval(() => this.check(false).catch(() => {}), AUTOMATIC_CHECK_INTERVAL_MS);
    }
  }

  async check(manual = true) {
    const preferences = normalizeUpdatePreferences(this.getPreferences());
    if (preferences.mode === 'none') {
      return this.emit({ status: 'disabled', message: '更新检查已关闭', preferences });
    }
    if (!this.app.isPackaged) {
      return this.emit({
        status: 'unsupported',
        message: '当前是开发预览模式；只有安装打包后的正式版本才能检查和安装桌面更新',
        preferences
      });
    }
    if (['checking', 'downloading'].includes(this.state.status)) return this.snapshot();
    this.manualCheck = Boolean(manual);
    this.emit({ status: 'checking', message: '正在检查桌面应用更新…', progress: null, preferences });
    try {
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.emit({ status: 'error', message: errorMessage(error), progress: null });
    } finally {
      this.manualCheck = false;
    }
    return this.snapshot();
  }

  async download() {
    if (!this.app.isPackaged) return this.check(true);
    if (this.state.status !== 'available') return this.snapshot();
    this.emit({ status: 'downloading', message: '准备下载更新…', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    try {
      await this.autoUpdater.downloadUpdate();
    } catch (error) {
      this.emit({ status: 'error', message: errorMessage(error), progress: null });
    }
    return this.snapshot();
  }

  skipAvailableVersion() {
    if (!this.state.availableVersion) return this.snapshot();
    const preferences = normalizeUpdatePreferences({
      ...this.getPreferences(),
      skippedVersion: this.state.availableVersion
    });
    this.savePreferences(preferences);
    return this.emit({ status: 'skipped', message: `已跳过 ${this.state.availableVersion}`, preferences });
  }

  clearSkippedVersion() {
    const preferences = normalizeUpdatePreferences({ ...this.getPreferences(), skippedVersion: '' });
    this.savePreferences(preferences);
    return this.emit({ preferences, message: '已取消跳过版本' });
  }

  quitAndInstall() {
    if (this.state.status !== 'ready') return false;
    this.autoUpdater.quitAndInstall(false, true);
    return true;
  }

  dispose() {
    if (this.initialTimer) this.clearTimeout(this.initialTimer);
    if (this.intervalTimer) this.clearInterval(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
  }
}

module.exports = {
  AUTOMATIC_CHECK_DELAY_MS,
  AUTOMATIC_CHECK_INTERVAL_MS,
  DesktopUpdateService,
  errorMessage,
  normalizeReleaseNotes,
  normalizeUpdatePreferences,
  readPortableNodeVersion
};
