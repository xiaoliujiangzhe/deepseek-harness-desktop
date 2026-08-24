'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  isSupportedTextFile,
  readWorkspaceTextFile,
  resolveWorkspaceTextFile,
  writeWorkspaceTextFile
} = require('../src/text-file-editor');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-editor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('recognizes common text and source files', () => {
  assert.equal(isSupportedTextFile('notes.txt'), true);
  assert.equal(isSupportedTextFile('README'), true);
  assert.equal(isSupportedTextFile('.env'), true);
  assert.equal(isSupportedTextFile('install.cmd'), true);
  assert.equal(isSupportedTextFile('photo.png'), false);
});

test('reads and writes text while preserving CRLF and UTF-8 BOM', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'notes.txt');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')]));
  const opened = readWorkspaceTextFile(root, file);
  assert.equal(opened.bom, true);
  assert.equal(opened.eol, 'crlf');
  const saved = writeWorkspaceTextFile(root, { ...opened, content: 'one\nchanged\n' });
  assert.equal(saved.ok, true);
  assert.deepEqual(fs.readFileSync(file).subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
  assert.equal(fs.readFileSync(file).subarray(3).toString('utf8'), 'one\r\nchanged\r\n');
});

test('detects external changes before saving', (t) => {
  const root = fixture(t);
  const file = path.join(root, 'notes.md');
  fs.writeFileSync(file, 'first');
  const opened = readWorkspaceTextFile(root, file);
  fs.writeFileSync(file, 'outside');
  const result = writeWorkspaceTextFile(root, { ...opened, content: 'inside' });
  assert.equal(result.conflict, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'outside');
  assert.equal(writeWorkspaceTextFile(root, { ...opened, content: 'inside', force: true }).ok, true);
});

test('rejects files outside the workspace and binary files', (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  const outsideFile = path.join(outside, 'notes.txt');
  fs.writeFileSync(outsideFile, 'no');
  assert.throws(() => resolveWorkspaceTextFile(root, outsideFile), /当前工作区/);
  const binary = path.join(root, 'binary.txt');
  fs.writeFileSync(binary, Buffer.from([1, 0, 2, 0]));
  assert.throws(() => readWorkspaceTextFile(root, binary), /二进制/);
  assert.equal(resolveWorkspaceTextFile(root, binary, { enforceSize: false }).target, binary);
});
