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

module.exports = {
  GENERAL_CHAT_DIRNAME,
  GENERAL_CHAT_INSTRUCTIONS,
  GENERAL_CHAT_TITLE,
  ensureGeneralChatWorkspace
};
