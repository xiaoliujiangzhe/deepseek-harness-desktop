'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  GENERAL_CHAT_DIRNAME,
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_TITLE,
  ensureGeneralChatWorkspace
} = require('../src/general-chat');

test('creates a private general-chat workspace and instructions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-general-chat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = ensureGeneralChatWorkspace(root);

  assert.deepEqual(result, { path: path.join(root, GENERAL_CHAT_DIRNAME), title: GENERAL_CHAT_TITLE });
  assert.equal(fs.readFileSync(path.join(result.path, 'AGENTS.md'), 'utf8'), GENERAL_CHAT_INSTRUCTIONS);
});

test('does not overwrite existing general-chat instructions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-general-chat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, GENERAL_CHAT_DIRNAME);
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'user instructions\n');

  ensureGeneralChatWorkspace(root);

  assert.equal(fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), 'user instructions\n');
});

test('rejects a relative userData directory', () => {
  assert.throws(() => ensureGeneralChatWorkspace('relative'), /absolute userData/);
});
