'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const declared = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  .dependencies?.['@deepseek-ai/dsh'];
let installed = null;
try {
  installed = JSON.parse(fs.readFileSync(
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    'utf8'
  )).version;
} catch {
  /* reported below */
}

if (typeof declared !== 'string' || installed !== declared) {
  console.error(`Harness 依赖不一致：package.json=${declared ?? '未声明'}，node_modules=${installed ?? '未安装'}`);
  console.error('请先运行 npm install，确认 package-lock.json 也更新后再启动或打包。');
  process.exit(1);
}

console.log(`Harness 版本校验通过：${installed}`);
