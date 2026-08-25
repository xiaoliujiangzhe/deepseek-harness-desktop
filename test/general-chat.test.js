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
  ensureGeneralChatWorkspace,
  selectGeneralChatSession
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

test('restores the explicitly remembered general-chat session', () => {
  const summaries = [
    { sessionId: 'newer', blank: false, updatedAt: 20 },
    { sessionId: 'remembered', blank: false, updatedAt: 10 }
  ];
  assert.equal(selectGeneralChatSession(summaries, ['newer', 'remembered'], 'remembered').sessionId, 'remembered');
});

test('migration prefers the latest non-blank session over a newer accidental blank', () => {
  const summaries = [
    { sessionId: 'accidental-blank', blank: true, updatedAt: 30 },
    { sessionId: 'older-chat', blank: false, updatedAt: 20 },
    { sessionId: 'newer-chat', blank: false, updatedAt: 25 },
    { sessionId: 'other-workspace', blank: false, updatedAt: 40 },
    { sessionId: 'subagent', blank: false, updatedAt: 50, origin: 'subagent' }
  ];
  assert.equal(
    selectGeneralChatSession(summaries, ['accidental-blank', 'older-chat', 'newer-chat', 'subagent']).sessionId,
    'newer-chat'
  );
});

test('reuses the latest blank session and returns null only when none belongs to the workspace', () => {
  const summaries = [
    { sessionId: 'blank-old', blank: true, updatedAt: 10 },
    { sessionId: 'blank-new', blank: true, updatedAt: 20 }
  ];
  assert.equal(selectGeneralChatSession(summaries, ['blank-old', 'blank-new']).sessionId, 'blank-new');
  assert.equal(selectGeneralChatSession(summaries, ['missing']), null);
});

test('sandboxed main-window preload does not require local CommonJS modules', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-main.js'), 'utf8');
  assert.doesNotMatch(preload, /require\(\s*['"]\.\.?[\\/]/);
});
