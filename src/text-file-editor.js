'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.bat', '.c', '.cc', '.cfg', '.cjs', '.cmd', '.conf', '.cpp', '.cs', '.css', '.csv',
  '.dockerignore', '.editorconfig', '.env', '.gitattributes', '.gitignore', '.go',
  '.graphql', '.gql', '.h', '.hpp', '.ini', '.java', '.js', '.json', '.jsonc',
  '.jsx', '.less', '.log', '.lua', '.md', '.markdown', '.mjs', '.npmrc', '.php',
  '.properties', '.ps1', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte',
  '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml'
]);
const TEXT_FILENAMES = new Set([
  'dockerfile', 'license', 'makefile', 'readme', 'requirements.txt'
]);

function isSupportedTextFile(file) {
  const value = String(file || '').trim();
  if (!value) return false;
  const basename = path.basename(value).toLowerCase();
  return TEXT_EXTENSIONS.has(path.extname(basename)) || TEXT_EXTENSIONS.has(basename) || TEXT_FILENAMES.has(basename);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveWorkspaceTextFile(workspace, file, options = {}) {
  if (!workspace) throw new Error('当前工作区尚未初始化');
  if (!isSupportedTextFile(file)) throw new Error('该文件类型不支持内置编辑');
  const root = fs.realpathSync(path.resolve(workspace));
  const requested = path.resolve(String(file || ''));
  if (!fs.existsSync(requested)) throw new Error('文件不存在');
  const target = fs.realpathSync(requested);
  if (!isInside(root, target)) throw new Error('只能编辑当前工作区内的文件');
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error('目标不是文件');
  if (options.enforceSize !== false && stat.size > MAX_EDITABLE_BYTES) throw new Error('文件超过 2 MB，只能使用外部编辑器打开');
  return { root, target, stat };
}

function revisionOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeText(buffer) {
  if (buffer.includes(0) && !(buffer[0] === 0xff && buffer[1] === 0xfe) && !(buffer[0] === 0xfe && buffer[1] === 0xff)) {
    throw new Error('文件疑似为二进制内容，不能在文本编辑器中打开');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { content: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: true };
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    if (swapped.length % 2 !== 0) throw new Error('UTF-16BE 文件长度无效');
    swapped.swap16();
    return { content: swapped.toString('utf16le'), encoding: 'utf16be', bom: true };
  }
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const body = bom ? buffer.subarray(3) : buffer;
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf8', bom };
  } catch {
    throw new Error('文件不是有效的 UTF-8/UTF-16 文本，请使用外部编辑器打开');
  }
}

function encodeText(content, encoding, bom) {
  const text = String(content ?? '');
  if (encoding === 'utf16le') {
    const body = Buffer.from(text, 'utf16le');
    return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
  }
  if (encoding === 'utf16be') {
    const body = Buffer.from(text, 'utf16le');
    body.swap16();
    return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), body]) : body;
  }
  const body = Buffer.from(text, 'utf8');
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

function detectEol(content) {
  return /\r\n/.test(content) ? 'crlf' : 'lf';
}

function normalizeEol(content, eol) {
  const normalized = String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

function readWorkspaceTextFile(workspace, file) {
  const { root, target, stat } = resolveWorkspaceTextFile(workspace, file);
  const buffer = fs.readFileSync(target);
  const decoded = decodeText(buffer);
  return {
    path: target,
    relativePath: path.relative(root, target) || path.basename(target),
    name: path.basename(target),
    content: decoded.content,
    encoding: decoded.encoding,
    bom: decoded.bom,
    eol: detectEol(decoded.content),
    revision: revisionOf(buffer),
    size: stat.size
  };
}

function writeWorkspaceTextFile(workspace, request = {}) {
  const { target, stat } = resolveWorkspaceTextFile(workspace, request.path);
  const current = fs.readFileSync(target);
  const currentRevision = revisionOf(current);
  if (!request.force && request.revision && request.revision !== currentRevision) {
    return { ok: false, conflict: true, message: '文件已被其他程序修改，请重新载入或确认覆盖' };
  }
  const content = normalizeEol(request.content, request.eol);
  const output = encodeText(content, request.encoding, Boolean(request.bom));
  if (output.length > MAX_EDITABLE_BYTES) throw new Error('保存内容超过 2 MB 限制');
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.dsh-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, output, { mode: stat.mode, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  const saved = fs.readFileSync(target);
  return { ok: true, revision: revisionOf(saved), size: saved.length };
}

module.exports = {
  MAX_EDITABLE_BYTES,
  isSupportedTextFile,
  readWorkspaceTextFile,
  resolveWorkspaceTextFile,
  writeWorkspaceTextFile
};
