'use strict';

const fs = require('node:fs');
const path = require('node:path');

function sessionTitle(summary) {
  const direct = typeof summary?.title === 'string' ? summary.title.trim() : '';
  if (direct) return direct;
  const projected = summary?.projections?.values?.title;
  return typeof projected === 'string' ? projected.trim() : '';
}

function listArchivedSessions(summaries, workspaces, archivedSessionIds) {
  if (!Array.isArray(summaries) || !Array.isArray(workspaces) || !Array.isArray(archivedSessionIds)) return [];
  const summaryById = new Map(summaries
    .filter(item => item && typeof item.sessionId === 'string')
    .map(item => [item.sessionId, item]));
  const workspaceBySession = new Map();
  for (const workspace of workspaces) {
    if (!workspace || !Array.isArray(workspace.sessionIds)) continue;
    for (const sessionId of workspace.sessionIds) {
      if (typeof sessionId === 'string' && !workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace);
    }
  }
  return archivedSessionIds
    .filter(sessionId => typeof sessionId === 'string')
    .map(sessionId => {
      const summary = summaryById.get(sessionId);
      const workspace = workspaceBySession.get(sessionId);
      const title = sessionTitle(summary);
      return {
        sessionId,
        title: title || '未命名对话',
        updatedAt: Number(summary?.updatedAt) || 0,
        workspaceTitle: typeof workspace?.title === 'string' && workspace.title.trim() ? workspace.title.trim() : '未分组',
        workspacePath: typeof workspace?.path === 'string' ? workspace.path : '',
        available: Boolean(summary)
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function loadJson(file, expectedUnit) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!document || document.unit?.name !== expectedUnit || typeof document.unit?.version !== 'number') {
    throw new Error(`${path.basename(file)} 不是当前 DSH ${expectedUnit} 存储文件`);
  }
  return document;
}

function atomicWriteJson(file, value) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const data = `${JSON.stringify(value, null, 2)}\n`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, data, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function validateMutation(home, sessionId, action) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new TypeError('DSH_HOME 必须是绝对路径');
  if (typeof sessionId !== 'string' || !/^session-[A-Za-z0-9-]{1,160}$/.test(sessionId)) throw new TypeError('会话 ID 格式不受支持');
  if (action !== 'restore' && action !== 'delete') throw new TypeError('不支持的归档操作');
  const workspaceFile = path.join(home, 'storages', 'workspace.json');
  const workspace = loadJson(workspaceFile, 'workspace');
  const archived = workspace?.global?.archivedSessionIds;
  if (!Array.isArray(archived) || !archived.includes(sessionId)) throw new Error('该会话已经不在归档记录中');
  return { workspaceFile, workspace };
}

function findSessionDirectory(home, sessionId) {
  const root = path.join(home, 'sessions');
  if (!fs.existsSync(root)) return null;
  const matches = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const candidate = path.join(root, project.name, sessionId);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) matches.push(candidate);
  }
  if (matches.length > 1) throw new Error(`发现 ${matches.length} 份同 ID 会话日志，拒绝自动删除`);
  return matches[0] || null;
}

function preflightArchivedSessionMutation(options) {
  const home = options?.home;
  const sessionId = options?.sessionId;
  const action = options?.action;
  const { workspaceFile } = validateMutation(home, sessionId, action);
  if (action === 'delete' && !findSessionDirectory(home, sessionId)) throw new Error('没有找到该归档会话的持久日志，拒绝删除索引');
  return { home, sessionId, action, workspaceFile };
}

function mutateArchivedSession(options) {
  const home = options?.home;
  const sessionId = options?.sessionId;
  const action = options?.action;
  const { workspaceFile, workspace } = validateMutation(home, sessionId, action);
  const projectionFile = path.join(home, 'storages', 'session_projcache.json');
  const sessionDirectory = action === 'delete' ? findSessionDirectory(home, sessionId) : null;
  if (action === 'delete' && !sessionDirectory) throw new Error('没有找到该归档会话的持久日志，拒绝删除索引');

  const backup = path.join(home, 'desktop-session-backups', `${timestamp()}-${action}-${sessionId}`);
  fs.mkdirSync(backup, { recursive: true });
  fs.copyFileSync(workspaceFile, path.join(backup, 'workspace.json'));
  let projection = null;
  if (action === 'delete' && fs.existsSync(projectionFile)) {
    projection = loadJson(projectionFile, 'session_projcache');
    fs.copyFileSync(projectionFile, path.join(backup, 'session_projcache.json'));
  }

  workspace.global.archivedSessionIds = workspace.global.archivedSessionIds.filter(id => id !== sessionId);
  if (action === 'restore') {
    atomicWriteJson(workspaceFile, workspace);
    return { action, sessionId, backup, message: '会话已恢复，正在重启桌面端' };
  }

  for (const record of Object.values(workspace?.tables?.workspaces || {})) {
    if (Array.isArray(record?.sessionIds)) record.sessionIds = record.sessionIds.filter(id => id !== sessionId);
  }
  if (projection?.tables?.sessions && Object.prototype.hasOwnProperty.call(projection.tables.sessions, sessionId)) {
    delete projection.tables.sessions[sessionId];
  }

  const backedSession = path.join(backup, 'session');
  fs.renameSync(sessionDirectory, backedSession);
  try {
    atomicWriteJson(workspaceFile, workspace);
    if (projection) atomicWriteJson(projectionFile, projection);
  } catch (error) {
    try { fs.copyFileSync(path.join(backup, 'workspace.json'), workspaceFile); } catch {}
    if (projection) try { fs.copyFileSync(path.join(backup, 'session_projcache.json'), projectionFile); } catch {}
    try { fs.renameSync(backedSession, sessionDirectory); } catch {}
    throw error;
  }
  return { action, sessionId, backup, message: '会话已从 DSH 删除，正在重启桌面端' };
}

module.exports = {
  atomicWriteJson,
  listArchivedSessions,
  mutateArchivedSession,
  preflightArchivedSessionMutation
};
