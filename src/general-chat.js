'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GENERAL_CHAT_DIRNAME = 'general-chat';
const GENERAL_CHAT_TITLE = '通用对话';
const GENERAL_CHAT_INSTRUCTIONS = `# DSH General Chat

This directory is managed by DeepSeek Harness Desktop for general-purpose conversations.

- Treat the conversation as general-purpose unless the user explicitly asks to work with files in this directory.
- Do not inspect, create, edit, execute, or delete local files unless the user explicitly requests it.
- If a task needs an existing project or repository, ask the user to switch to or select that workspace first.
`;

/**
 * Create the private directory backing the desktop app's general-chat entry.
 * Existing user-authored instructions are never overwritten.
 *
 * @param {string} userData Electron userData directory.
 * @returns {{ path: string, title: string }} Managed workspace descriptor.
 */
function ensureGeneralChatWorkspace(userData) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData)) {
    throw new TypeError('general chat requires an absolute userData directory');
  }
  const workspace = path.join(userData, GENERAL_CHAT_DIRNAME);
  fs.mkdirSync(workspace, { recursive: true });
  const instructions = path.join(workspace, 'AGENTS.md');
  if (!fs.existsSync(instructions)) {
    fs.writeFileSync(instructions, GENERAL_CHAT_INSTRUCTIONS, { encoding: 'utf8', flag: 'wx' });
  }
  return { path: workspace, title: GENERAL_CHAT_TITLE };
}

/**
 * Resolve the conversation opened by the general-chat navigation entry.
 * Prefer an explicitly remembered top-level session. During migration from
 * v0.5.1, prefer a non-blank session so an accidentally-created newer blank
 * session does not hide an existing conversation.
 *
 * @param {Array<object>} summaries Rows returned by session.list.
 * @param {Array<string>} workspaceSessionIds Session ids owned by the workspace.
 * @param {string} preferredSessionId Last general-chat session selected by the user.
 * @returns {object|null}
 */
function selectGeneralChatSession(summaries, workspaceSessionIds, preferredSessionId = '') {
  if (!Array.isArray(summaries) || !Array.isArray(workspaceSessionIds)) return null;
  const membership = new Set(workspaceSessionIds.filter(id => typeof id === 'string'));
  const candidates = summaries.filter(summary => summary
    && typeof summary.sessionId === 'string'
    && membership.has(summary.sessionId)
    && summary.origin !== 'subagent'
    && !summary.parentSessionId);
  const preferred = candidates.find(summary => summary.sessionId === preferredSessionId);
  if (preferred) return preferred;
  return candidates.sort((left, right) => {
    if (Boolean(left.blank) !== Boolean(right.blank)) return left.blank ? 1 : -1;
    return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
  })[0] || null;
}

/**
 * Build the visible history shown below the desktop general-chat entry.
 * Blank sessions stay hidden unless currently selected, matching Harness's
 * native sidebar while preserving access to every real top-level chat.
 *
 * @param {Array<object>} summaries Rows returned by session.list.
 * @param {Array<string>} workspaceSessionIds Session ids owned by the workspace.
 * @param {string} selectedSessionId Currently selected session id.
 * @returns {Array<{sessionId: string, title: string, updatedAt: number, blank: boolean}>}
 */
function listGeneralChatSessions(summaries, workspaceSessionIds, selectedSessionId = '') {
  if (!Array.isArray(summaries) || !Array.isArray(workspaceSessionIds)) return [];
  const membership = new Set(workspaceSessionIds.filter(id => typeof id === 'string'));
  return summaries
    .filter(summary => summary
      && typeof summary.sessionId === 'string'
      && membership.has(summary.sessionId)
      && summary.origin !== 'subagent'
      && !summary.parentSessionId
      && (!summary.blank || summary.sessionId === selectedSessionId))
    .sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0))
    .map(summary => ({
      sessionId: summary.sessionId,
      title: typeof summary.title === 'string' && summary.title.trim() ? summary.title.trim() : '新对话',
      updatedAt: Number(summary.updatedAt) || 0,
      blank: Boolean(summary.blank)
    }));
}

module.exports = {
  GENERAL_CHAT_DIRNAME,
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_TITLE,
  ensureGeneralChatWorkspace,
  listGeneralChatSessions,
  selectGeneralChatSession
};
