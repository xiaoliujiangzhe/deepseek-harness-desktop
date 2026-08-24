'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeBrowserUrl } = require('../src/embedded-browser');

test('normalizes plain hostnames to HTTPS', () => {
  assert.equal(normalizeBrowserUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserUrl('http://127.0.0.1:3000/a'), 'http://127.0.0.1:3000/a');
});

test('blocks privileged and credential-bearing URLs', () => {
  assert.throws(() => normalizeBrowserUrl('file:///C:/Windows/System32'), /http\/https/);
  assert.throws(() => normalizeBrowserUrl('javascript:alert(1)'), /http\/https/);
  assert.throws(() => normalizeBrowserUrl('https://user:secret@example.com'), /账号或密码/);
});
