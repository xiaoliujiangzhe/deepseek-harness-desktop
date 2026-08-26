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
  generalChatSessionTitle,
  increasedForkTitle,
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

test('selection excludes archived sessions but keeps ordinary forks eligible', () => {
  const summaries = [
    { sessionId: 'archived', blank: false, updatedAt: 30 },
    { sessionId: 'fork', blank: false, updatedAt: 20, parentSessionId: 'root' },
    { sessionId: 'subagent', blank: false, updatedAt: 40, parentSessionId: 'root', origin: 'subagent' }
  ];
  assert.equal(
    selectGeneralChatSession(summaries, ['archived', 'fork', 'subagent'], 'archived', ['archived']).sessionId,
    'fork'
  );
});

test('reads durable session titles from direct and projected list fields', () => {
  assert.equal(generalChatSessionTitle({ title: '  手动标题  ' }), '手动标题');
  assert.equal(generalChatSessionTitle({ projections: { values: { title: '  自动标题  ' } } }), '自动标题');
  assert.equal(generalChatSessionTitle({ projections: { values: {} } }), '');
});

test('increments fork titles with the same suffix convention as Harness', () => {
  assert.equal(increasedForkTitle('测试'), '测试 (1)');
  assert.equal(increasedForkTitle('测试 (1)'), '测试 (2)');
  assert.equal(increasedForkTitle('测试（8）'), '测试（9）');
  assert.equal(increasedForkTitle('   '), '');
});

test('lists every ordinary general chat including forks in latest-first order', () => {
  const summaries = [
    { sessionId: 'older', title: '第一段对话', blank: false, updatedAt: 10 },
    { sessionId: 'newer', blank: false, updatedAt: 30, projections: { values: { title: '第二段对话' } } },
    { sessionId: 'blank', blank: true, updatedAt: 40 },
    { sessionId: 'fork', title: '分叉会话', blank: false, updatedAt: 50, parentSessionId: 'newer' },
    { sessionId: 'subagent', title: '子 Agent', blank: false, updatedAt: 70, parentSessionId: 'newer', origin: 'subagent' },
    { sessionId: 'archived', title: '已归档', blank: false, updatedAt: 60 },
    { sessionId: 'other', title: '其他工作区', blank: false, updatedAt: 60 }
  ];
  assert.deepEqual(
    listGeneralChatSessions(
      summaries,
      ['older', 'newer', 'blank', 'fork', 'subagent', 'archived'],
      '',
      ['archived']
    ),
    [
      {
        sessionId: 'fork',
        title: '分叉会话',
        blank: false,
        updatedAt: 50,
        hasTitle: true,
        parentSessionId: 'newer'
      },
      { sessionId: 'newer', title: '第二段对话', blank: false, updatedAt: 30, hasTitle: true },
      { sessionId: 'older', title: '第一段对话', blank: false, updatedAt: 10, hasTitle: true }
    ]
  );
});

test('keeps the selected blank general chat visible with a safe fallback title', () => {
  const summaries = [{ sessionId: 'blank', title: '   ', blank: true, updatedAt: 20 }];
  assert.deepEqual(
    listGeneralChatSessions(summaries, ['blank'], 'blank'),
    [{ sessionId: 'blank', title: '新对话', blank: true, updatedAt: 20, hasTitle: false }]
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

test('general chat row actions use Harness rename, fork and archive RPC methods', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-main.js'), 'utf8');
  assert.match(preload, /generalChatRpc\('session\.rename'/);
  assert.match(preload, /generalChatRpc\('session\.fork'/);
  assert.match(preload, /generalChatRpc\('workspace\.archiveSession'/);
  assert.match(preload, /generalChatRpc\('workspace\.list'/);
  assert.match(preload, /dshd-general-chat-session-menu-button/);
});

test('archived conversations have a labeled and accessible sidebar entry', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload-main.js'), 'utf8');
  assert.match(preload, /archive\.setAttribute\('aria-label', '查看已归档对话'\)/);
  assert.match(preload, /<span>已归档<\/span>/);
  assert.match(preload, /ipcRenderer\.invoke\('archive:mutate'/);
});
