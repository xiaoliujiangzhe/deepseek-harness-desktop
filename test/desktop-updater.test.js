'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DesktopUpdateService,
  errorMessage,
  normalizeReleaseNotes,
  normalizeUpdatePreferences
} = require('../src/desktop-updater');

function fakeUpdater() {
  const listeners = new Map();
  return {
    autoDownload: null,
    autoInstallOnAppQuit: null,
    allowDowngrade: null,
    allowPrerelease: null,
    on(name, fn) { listeners.set(name, fn); },
    async checkForUpdates() { listeners.get('update-available')?.({ version: '0.4.1', releaseNotes: '修复启动问题' }); },
    async downloadUpdate() { listeners.get('download-progress')?.({ percent: 42, transferred: 10, total: 20, bytesPerSecond: 100 }); listeners.get('update-downloaded')?.({ version: '0.4.1' }); },
    quitAndInstall() { this.installed = true; }
  };
}

test('normalizes update preferences conservatively', () => {
  assert.deepEqual(normalizeUpdatePreferences({ mode: 'wat', channel: 'preview', skippedVersion: 42 }), {
    mode: 'default', channel: 'preview', skippedVersion: ''
  });
});

test('normalizes release notes from electron-updater variants', () => {
  assert.equal(normalizeReleaseNotes([{ note: 'A' }, { note: 'B' }]), 'A\n\nB');
  assert.equal(normalizeReleaseNotes('  A  '), 'A');
});

test('checks, downloads, skips and installs a desktop update', async () => {
  const updater = fakeUpdater();
  const states = [];
  let prefs = { mode: 'manual', channel: 'stable', skippedVersion: '' };
  const service = new DesktopUpdateService({
    app: { getVersion: () => '0.4.0', isPackaged: true },
    autoUpdater: updater,
    getPreferences: () => prefs,
    savePreferences: (next) => { prefs = next; },
    components: { harness: '0.1.1-rc.2', node: 'v24.18.0', pnpm: '11.21.0' },
    onState: (state) => states.push(state)
  });
  service.initialize();
  assert.equal(updater.autoDownload, false);
  await service.check(true);
  assert.equal(service.snapshot().status, 'available');
  await service.download();
  assert.equal(service.snapshot().status, 'ready');
  assert.equal(service.quitAndInstall(), true);
  assert.equal(updater.installed, true);
  service.skipAvailableVersion();
  assert.equal(prefs.skippedVersion, '0.4.1');
  assert.ok(states.some((state) => state.status === 'downloading'));
});

test('returns a clear message for rate limits', () => {
  assert.match(errorMessage(new Error('HTTP 429 rate limit exceeded')), /过于频繁/);
});
