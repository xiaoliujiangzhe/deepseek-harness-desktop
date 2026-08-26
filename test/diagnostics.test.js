'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  backupConfiguration,
  buildDiagnosticReport,
  credentialsVersionState,
  redactSecrets,
  repairCredentialsVersion
} = require('../src/diagnostics');

test('redacts common API key and authorization formats', () => {
  const value = redactSecrets('api_key=sk-example123456789 Authorization: Bearer abc.def.ghi');
  assert.doesNotMatch(value, /sk-example|abc\.def/);
  assert.match(value, /REDACTED/);
});

test('detects and repairs the legacy string credentials version with a backup', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diagnostics-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.credentials.yaml');
  const original = 'version: "1" # legacy\ncredentials:\n  api_key: TEST_VALUE_MUST_NOT_CHANGE\n';
  fs.writeFileSync(file, original);
  assert.equal(credentialsVersionState(file).valid, false);
  const result = repairCredentialsVersion({ home });
  assert.equal(result.changed, true);
  assert.equal(credentialsVersionState(file).valid, true);
  assert.equal(fs.existsSync(result.backup), true);
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original);
  assert.equal(fs.readFileSync(file, 'utf8'), 'version: 1 # legacy\ncredentials:\n  api_key: TEST_VALUE_MUST_NOT_CHANGE\n');
});

test('leaves the current numeric credentials version unchanged', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diagnostics-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.credentials.yaml');
  const original = 'version: 1\ncredentials: {}\n';
  fs.writeFileSync(file, original);
  const result = repairCredentialsVersion({ home });
  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(home), ['.credentials.yaml']);
});

test('refuses to rewrite an unknown credentials version', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diagnostics-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.credentials.yaml');
  fs.writeFileSync(file, 'version: "2"\ncredentials: {}\n');
  assert.throws(() => repairCredentialsVersion({ home }), /无法安全自动修复/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'version: "2"\ncredentials: {}\n');
});

test('backs up only known configuration files', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diagnostics-backup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true });
  fs.writeFileSync(path.join(home, 'settings.yaml'), 'version: "1"\n');
  fs.writeFileSync(path.join(home, 'profiles', 'web', 'package.json'), '{}');
  fs.writeFileSync(path.join(home, 'secret-not-in-list.txt'), 'do not copy');
  const result = backupConfiguration({ home });
  assert.deepEqual(result.copied.sort(), ['profiles/web/package.json', 'settings.yaml']);
  assert.equal(fs.existsSync(path.join(result.destination, 'secret-not-in-list.txt')), false);
});

test('builds a structured report without reading credential values', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-diagnostics-report-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'version: 1\ncredentials: {}\n');
  const report = await buildDiagnosticReport({ home, workspace: home, networkChecks: [], serviceReady: false });
  assert.equal(report.version, 1);
  assert.equal(report.checks.find((item) => item.id === 'credentials-version').status, 'ok');
  assert.equal(report.summary.error >= 2, true);
});
