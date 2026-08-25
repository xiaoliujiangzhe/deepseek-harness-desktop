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
  listGeneralChatSessions,
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

test('lists every non-blank top-level general chat in latest-first order', () => {
  const summaries = [
    { sessionId: 'older', title: '第一段对话', blank: false, updatedAt: 10 },
    { sessionId: 'newer', title: '第二段对话', blank: false, updatedAt: 30 },
    { sessionId: 'blank', blank: true, updatedAt: 40 },
    { sessionId: 'child', title: '子会话', blank: false, updatedAt: 50, parentSessionId: 'newer' },
    { sessionId: 'other', title: '其他工作区', blank: false, updatedAt: 60 }
  ];
  assert.deepEqual(
    listGeneralChatSessions(summaries, ['older', 'newer', 'blank', 'child']),
    [
      { sessionId: 'newer', title: '第二段对话', blank: false, updatedAt: 30 },
      { sessionId: 'older', title: '第一段对话', blank: false, updatedAt: 10 }
    ]
  );
});

test('keeps the selected blank general chat visible with a safe fallback title', () => {
  const summaries = [{ sessionId: 'blank', title: '   ', blank: true, updatedAt: 20 }];
  assert.deepEqual(
    listGeneralChatSessions(summaries, ['blank'], 'blank'),
    [{ sessionId: 'blank', title: '新对话', blank: true, updatedAt: 20 }]
  );
});

test('sandboxed main-window preload does not require local CommonJS modules', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-main.js'), 'utf8');
  assert.doesNotMatch(preload, /require\(\s*['"]\.\.?[\\/]/);
});

test('desktop tools boot before the general-chat history enhancement', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-main.js'), 'utf8');
  const boot = preload.match(/function bootDesktopFeatures\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(boot.indexOf('bootTools();') >= 0);
  assert.ok(boot.indexOf('bootGeneralChat();') > boot.indexOf('bootTools();'));
});

test('native new-session behavior is bridged only while a general chat is selected', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-main.js'), 'utf8');
  assert.match(preload, /if \(!generalChatSessionIds\(\)\.includes\(selected\)\) return;/);
  assert.match(preload, /if \(current\?\.blank\) \{[\s\S]*?当前已经是空白新对话/);
});
