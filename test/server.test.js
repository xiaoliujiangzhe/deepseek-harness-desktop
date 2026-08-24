'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveNodeExecutable, resolveDshVersion, buildDshArgs } = require('../src/server');

test('starts the web service without opening the system browser', () => {
  assert.deepEqual(buildDshArgs('dsh-bin.js', null), [
    'dsh-bin.js',
    'web',
    '--no-open'
  ]);
  assert.deepEqual(buildDshArgs('dsh-bin.js', 0), [
    'dsh-bin.js',
    'web',
    '--no-open',
    '--port',
    '0'
  ]);
  assert.deepEqual(buildDshArgs('dsh-bin.js', 55250), [
    'dsh-bin.js',
    'web',
    '--no-open',
    '--port',
    '55250'
  ]);
});

test('prefers the packaged portable Node runtime', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-node-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources');
  const runtimeNode = path.join(resources, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  fs.mkdirSync(path.dirname(runtimeNode), { recursive: true });
  fs.writeFileSync(runtimeNode, 'fixture');

  const previousOverride = process.env.DSH_DESKTOP_NODE;
  delete process.env.DSH_DESKTOP_NODE;
  t.after(() => {
    if (previousOverride === undefined) delete process.env.DSH_DESKTOP_NODE;
    else process.env.DSH_DESKTOP_NODE = previousOverride;
  });

  assert.equal(resolveNodeExecutable({ resourcesPath: resources, appRoot: root }), runtimeNode);
});

test('keeps an explicit Node override ahead of the portable runtime', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-node-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const override = path.join(root, process.platform === 'win32' ? 'custom-node.exe' : 'custom-node');
  fs.writeFileSync(override, 'fixture');
  const previousOverride = process.env.DSH_DESKTOP_NODE;
  process.env.DSH_DESKTOP_NODE = override;
  t.after(() => {
    if (previousOverride === undefined) delete process.env.DSH_DESKTOP_NODE;
    else process.env.DSH_DESKTOP_NODE = previousOverride;
  });

  assert.equal(resolveNodeExecutable({ resourcesPath: path.join(root, 'resources'), appRoot: root }), override);
});

test('resolves the version belonging to a selected dsh bin', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.1.1-rc.2'
  }));
  const bin = path.join(root, 'lib', 'bin.js');
  fs.writeFileSync(bin, '');
  assert.equal(resolveDshVersion(bin), '0.1.1-rc.2');
});

test('does not report a version for an unrelated package', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'not-dsh', version: '9.9.9' }));
  const bin = path.join(root, 'lib', 'bin.js');
  fs.writeFileSync(bin, '');
  assert.equal(resolveDshVersion(bin), null);
});
