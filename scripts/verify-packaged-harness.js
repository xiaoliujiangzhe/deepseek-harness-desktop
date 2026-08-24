'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktopPackage = require(path.join(root, 'package.json'));
const unpackedRoot = path.join(root, 'release', 'win-unpacked');
const resources = path.join(unpackedRoot, 'resources');
const dshBin = path.join(
  resources,
  'app.asar.unpacked',
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'lib',
  'bin.js'
);
const portableNode = path.join(resources, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const portableManifest = path.join(resources, 'runtime', 'node', 'runtime.json');
const portablePnpm = path.join(resources, 'runtime', 'pnpm', process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
const portablePnpmEntry = path.join(resources, 'runtime', 'pnpm', 'package', 'bin', 'pnpm.cjs');

assert.ok(fs.existsSync(dshBin), `打包后的 DSH CLI 不存在：${dshBin}`);
assert.ok(fs.existsSync(portableNode), `打包后的便携 Node 不存在：${portableNode}`);
assert.ok(fs.existsSync(portableManifest), `打包后的便携 Node 清单不存在：${portableManifest}`);
assert.ok(fs.existsSync(portablePnpm), `打包后的便携 pnpm 不存在：${portablePnpm}`);
assert.ok(fs.existsSync(portablePnpmEntry), `打包后的便携 pnpm 入口不存在：${portablePnpmEntry}`);

const runtimeInfo = JSON.parse(fs.readFileSync(portableManifest, 'utf8'));
const portableVersion = execFileSync(portableNode, ['--version'], {
  cwd: unpackedRoot,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 10_000
}).trim();
assert.equal(portableVersion, runtimeInfo.version, `打包后的便携 Node 版本不一致：清单 ${runtimeInfo.version}，实际 ${portableVersion}`);

const portablePnpmVersion = execFileSync(portableNode, [portablePnpmEntry, '--version'], {
  cwd: unpackedRoot,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30_000
}).trim();
assert.equal(portablePnpmVersion, desktopPackage.devDependencies.pnpm, `打包后的便携 pnpm 版本不一致：期望 ${desktopPackage.devDependencies.pnpm}，实际 ${portablePnpmVersion}`);

let actualVersion;
try {
  actualVersion = execFileSync(process.execPath, [dshBin, '--version'], {
    cwd: unpackedRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000
  }).trim();
} catch (error) {
  const stdout = error && error.stdout ? String(error.stdout) : '';
  const stderr = error && error.stderr ? String(error.stderr) : '';
  throw new Error(
    `打包后的 DSH CLI 无法启动。安装包不可发布。\n${stdout}${stderr}`,
    { cause: error }
  );
}

const expectedVersion = desktopPackage.dependencies['@deepseek-ai/dsh'];
assert.equal(
  actualVersion,
  expectedVersion,
  `打包后的 Harness 版本不一致：期望 ${expectedVersion}，实际 ${actualVersion}`
);

console.log(`打包产物校验通过：Harness ${actualVersion}`);
console.log(`打包产物校验通过：便携 Node ${portableVersion}`);
console.log(`打包产物校验通过：便携 pnpm ${portablePnpmVersion}`);
