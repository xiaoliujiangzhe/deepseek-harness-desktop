'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  compatibilityOf,
  formatPluginFailure,
  isBundleManifest,
  listInstalled,
  marketplaceCacheFile,
  resetMarketplaceCache,
  resolveGitHubCandidate,
  searchMarketplace,
  validateGitHubManifest,
  validatePackageName
} = require('../src/plugin-manager');

test('accepts package names and rejects command-like plugin specs', () => {
  assert.equal(validatePackageName('@scope/dsh-plugin-demo'), true);
  assert.equal(validatePackageName('dsh-plugin-demo'), true);
  assert.equal(validatePackageName('x && calc.exe'), false);
  assert.equal(validatePackageName('../plugin'), false);
});

test('recognizes only manifests that export a DSH bundle patch', () => {
  assert.equal(isBundleManifest({ dsh: { bundle: { patch: './cordis.yml' } } }), true);
  assert.equal(isBundleManifest({ dsh: { bundle: {} } }), false);
  assert.equal(isBundleManifest({}), false);
});

test('reports compatibility declarations without guessing semver ranges', () => {
  assert.deepEqual(compatibilityOf({}, '0.1.1-rc.2'), { status: 'unknown', declared: null });
  assert.deepEqual(compatibilityOf({ peerDependencies: { '@deepseek-ai/dsh': '0.1.1-rc.2' } }, '0.1.1-rc.2'), {
    status: 'compatible', declared: '0.1.1-rc.2'
  });
  assert.deepEqual(compatibilityOf({ peerDependencies: { '@deepseek-ai/dsh': '^0.1.0' } }, '0.1.1-rc.2'), {
    status: 'declared', declared: '^0.1.0'
  });
});

test('turns plugin command failures into readable messages', () => {
  assert.match(formatPluginFailure('add', 1, 'git-hosted plugins build on install via their prepare script; add allowBuilds'), /第三方构建脚本/);
  assert.match(formatPluginFailure('add', 1, 'ERR_PNPM_FETCH_404 package is not in the npm registry'), /尚未发布到 npm/);
  assert.match(formatPluginFailure('remove', 1, 'request ETIMEDOUT'), /网络或代理/);
});

test('lists profile-managed plugin dependencies', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const profile = path.join(home, 'profiles', 'web');
  const plugin = path.join(profile, 'node_modules', '@demo', 'plugin');
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
    dependencies: { '@demo/plugin': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@demo/plugin'] } }
  }));
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({ name: '@demo/plugin', version: '1.0.0' }));

  assert.equal(listInstalled(home)[0].activeBundle, true);
  assert.equal(listInstalled(home)[0].version, '1.0.0');
});

test('downloads the marketplace once and filters later searches from memory', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  resetMarketplaceCache();
  let requests = 0;
  const requestJson = async () => {
    requests += 1;
    return { plugins: [{ name: 'Whale Widget', owner: 'demo', url: 'https://github.com/demo/whale', description: 'balance whale' }] };
  };
  const first = await searchMarketplace('whale', { home, requestJson, now: () => 1000 });
  const second = await searchMarketplace('balance', { home, requestJson, now: () => 1001 });
  assert.equal(requests, 1);
  assert.equal(first.catalog.source, 'network');
  assert.equal(second.catalog.source, 'memory');
  assert.equal(second.items[0].installSpec, 'github:demo/whale');
});

test('uses an existing disk catalog without another network request', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-market-disk-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = marketplaceCacheFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    registryUrl: 'https://example.test/plugins.json',
    cachedAt: 5000,
    data: { plugins: [{ name: 'Demo', npm: 'dsh-demo', description: 'cached' }] }
  }));
  resetMarketplaceCache();
  const result = await searchMarketplace('', {
    home,
    registryUrl: 'https://example.test/plugins.json',
    now: () => 5001,
    requestJson: async () => { throw new Error('network should not be used'); }
  });
  assert.equal(result.catalog.source, 'disk');
  assert.equal(result.items[0].installSpec, 'dsh-demo');
});

test('accepts a built GitHub bundle and rejects lifecycle scripts or unsafe paths', () => {
  const valid = {
    name: 'dsh-whale-widget',
    version: '0.2.9',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } }
  };
  assert.deepEqual(validateGitHubManifest(valid), {
    name: 'dsh-whale-widget',
    version: '0.2.9',
    patch: 'cordis.patch.yml',
    entries: ['lib/index.js']
  });
  assert.throws(() => validateGitHubManifest({ ...valid, scripts: { prepare: 'npm run build' } }), /安装构建脚本/);
  assert.throws(() => validateGitHubManifest({ ...valid, main: '../outside.js' }), /路径不安全/);
});

test('requires GitHub to resolve an exact 40-character commit', async () => {
  await assert.rejects(() => resolveGitHubCandidate({
    source: 'github',
    installSpec: 'github:demo/plugin',
    repositoryUrl: 'https://github.com/demo/plugin'
  }, {
    requestJson: async () => ({ sha: 'main' }),
    requestBuffer: async () => Buffer.from('{}')
  }), /40 位 commit SHA/);
});
