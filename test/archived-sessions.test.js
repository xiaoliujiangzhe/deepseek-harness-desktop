'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listArchivedSessions, mutateArchivedSession, preflightArchivedSessionMutation } = require('../src/archived-sessions');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-archive-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, 'storages'), { recursive: true });
  fs.mkdirSync(path.join(home, 'sessions', '--project--', 'session-archived'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', '--project--', 'session-archived', 'session.jsonl.zstd'), 'log');
  fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['workspace-1'], archivedSessionIds: ['session-archived'] },
    tables: { workspaces: { 'workspace-1': { title: '项目', path: 'C:\\project', sessionIds: ['session-archived', 'session-kept'] } } }
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(home, 'storages', 'session_projcache.json'), `${JSON.stringify({
    unit: { name: 'session_projcache', version: 3 }, global: null,
    tables: { sessions: { 'session-archived': { rows: {} }, 'session-kept': { rows: {} } } }
  }, null, 2)}\n`);
  return home;
}

test('builds a newest-first archived session list across workspaces', () => {
  const rows = listArchivedSessions([
    { sessionId: 'session-old', updatedAt: 10, projections: { values: { title: '旧会话' } } },
    { sessionId: 'session-new', updatedAt: 20 }
  ], [
    { title: '项目 A', path: 'C:\\A', sessionIds: ['session-old'] },
    { title: '项目 B', path: 'C:\\B', sessionIds: ['session-new'] }
  ], ['session-old', 'session-new']);
  assert.deepEqual(rows.map(row => row.sessionId), ['session-new', 'session-old']);
  assert.equal(rows[0].workspaceTitle, '项目 B');
  assert.equal(rows[1].title, '旧会话');
});

test('restores an archived session without touching its workspace membership or log', (t) => {
  const home = fixture(t);
  const result = mutateArchivedSession({ home, sessionId: 'session-archived', action: 'restore' });
  const workspace = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8'));
  assert.deepEqual(workspace.global.archivedSessionIds, []);
  assert.deepEqual(workspace.tables.workspaces['workspace-1'].sessionIds, ['session-archived', 'session-kept']);
  assert.equal(fs.existsSync(path.join(home, 'sessions', '--project--', 'session-archived', 'session.jsonl.zstd')), true);
  assert.equal(fs.existsSync(path.join(result.backup, 'workspace.json')), true);
});

test('deletes an archived session from persistence and indexes with a recovery backup', (t) => {
  const home = fixture(t);
  preflightArchivedSessionMutation({ home, sessionId: 'session-archived', action: 'delete' });
  const result = mutateArchivedSession({ home, sessionId: 'session-archived', action: 'delete' });
  const workspace = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8'));
  const projections = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'session_projcache.json'), 'utf8'));
  assert.deepEqual(workspace.global.archivedSessionIds, []);
  assert.deepEqual(workspace.tables.workspaces['workspace-1'].sessionIds, ['session-kept']);
  assert.equal(Object.hasOwn(projections.tables.sessions, 'session-archived'), false);
  assert.equal(Object.hasOwn(projections.tables.sessions, 'session-kept'), true);
  assert.equal(fs.existsSync(path.join(home, 'sessions', '--project--', 'session-archived')), false);
  assert.equal(fs.existsSync(path.join(result.backup, 'session', 'session.jsonl.zstd')), true);
});

test('refuses to mutate a session that is not archived', (t) => {
  const home = fixture(t);
  assert.throws(() => mutateArchivedSession({ home, sessionId: 'session-kept', action: 'restore' }), /不在归档记录/);
});
