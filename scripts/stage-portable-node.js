'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_VERSION = 'v24.18.0';
const EXPECTED_PLATFORM = 'win32';
const EXPECTED_ARCH = 'x64';

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  if (process.platform !== EXPECTED_PLATFORM || process.arch !== EXPECTED_ARCH) {
    throw new Error(`portable Node staging requires ${EXPECTED_PLATFORM}-${EXPECTED_ARCH}; got ${process.platform}-${process.arch}`);
  }
  if (process.version !== EXPECTED_VERSION) {
    throw new Error(`portable Node staging requires ${EXPECTED_VERSION}; got ${process.version}`);
  }

  const source = process.execPath;
  const outputDir = path.join(__dirname, '..', 'runtime', 'node');
  const output = path.join(outputDir, 'node.exe');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.copyFileSync(source, output);

  const stagedVersion = execFileSync(output, ['--version'], { encoding: 'utf8' }).trim();
  if (stagedVersion !== EXPECTED_VERSION) {
    fs.rmSync(output, { force: true });
    throw new Error(`staged runtime reports ${stagedVersion}; expected ${EXPECTED_VERSION}`);
  }

  const manifest = {
    version: EXPECTED_VERSION,
    platform: EXPECTED_PLATFORM,
    arch: EXPECTED_ARCH,
    source: 'build host process.execPath',
    sha256: sha256(output)
  };
  fs.writeFileSync(path.join(outputDir, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`staged ${EXPECTED_VERSION} (${manifest.sha256})`);
}

main();
