'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { compareVersions, migrateHarnessHome } = require('../src/harness-migration');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-migration-'));
}

test('compares release candidates by core and prerelease number', () => {
  assert.equal(compareVersions('0.1.1-rc.2', '0.1.0-rc.6'), 1);
  assert.equal(compareVersions('0.1.1-rc.2', '0.1.1-rc.1'), 1);
  assert.equal(compareVersions('0.1.1-rc.2', '0.1.1-rc.2'), 0);
  assert.equal(compareVersions('0.1.1', '0.1.1-rc.2'), 1);
  assert.equal(compareVersions('not-a-version', '0.1.0'), null);
});

test('backs up stale generated dependencies and preserves user data', (t) => {
  const home = fixture();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const profiles = path.join(home, 'profiles');
  const sharedPackage = path.join(profiles, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json');
  const web = path.join(profiles, 'web');
  writeJson(sharedPackage, { name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.6' });
  writeJson(path.join(web, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), {
    name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.6'
  });
  writeJson(path.join(web, 'package.json'), {
    dependencies: { '@deepseek-ai/dsh-base': '0.1.0-rc.6' }
  });
  fs.writeFileSync(path.join(web, 'pnpm-lock.yaml'), 'old lock');
  fs.writeFileSync(path.join(web, 'pnpm-workspace.yaml'), 'old workspace');
  fs.writeFileSync(path.join(web, 'cordis.patch.yml'), '[]');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 'keep.json'), '{}');

  const result = migrateHarnessHome({
    home,
    targetVersion: '0.1.1-rc.2',
    now: new Date('2026-08-23T12:00:00.000Z')
  });

  assert.equal(result.migrated, true);
  assert.equal(fs.existsSync(path.join(profiles, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(web, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(web, 'package.json')), false);
  assert.equal(fs.readFileSync(path.join(web, 'cordis.patch.yml'), 'utf8'), '[]');
  assert.equal(fs.readFileSync(path.join(home, 'sessions', 'keep.json'), 'utf8'), '{}');
  assert.equal(fs.existsSync(path.join(result.backupDir, 'profiles-node_modules')), true);
  assert.equal(fs.existsSync(path.join(result.backupDir, 'web', 'package.json')), true);
});

test('does nothing when generated dependencies already match', (t) => {
  const home = fixture();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  writeJson(path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), {
    version: '0.1.1-rc.2'
  });
  const result = migrateHarnessHome({ home, targetVersion: '0.1.1-rc.2' });
  assert.equal(result.migrated, false);
});
