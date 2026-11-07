import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'llm-comment-';
// mkdtemp appends six characters from [A-Za-z0-9].
const SESSION_ID = /^[A-Za-z0-9]{6}$/;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface DocumentInfo {
  content: string;
  sha256: string;
  lines: number;
}

export interface SessionPaths {
  id: string;
  dir: string;
  document: string;
  comments: string;
  server: string;
}

/** Connection details the background server writes for `llm-comment comments`. */
export interface ServerInfo {
  pid: number;
  port: number;
  token: string;
}

function pathsFor(dir: string, id: string): SessionPaths {
  return {
    id,
    dir,
    document: join(dir, 'document.md'),
    comments: join(dir, 'comments.json'),
    server: join(dir, 'server.json'),
  };
}

export function describeDocument(content: string): DocumentInfo {
  const lines = content.split(/\r\n|\r|\n/);
  // A trailing newline ends the last line rather than starting a new one.
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return {
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    lines: lines.length,
  };
}

/**
 * Copies the input file into a fresh private session directory. The server
 * only ever touches files inside this directory, at fixed names.
 */
export async function createSession(
  inputPath: string,
  baseDir = tmpdir(),
): Promise<{ paths: SessionPaths; document: DocumentInfo }> {
  const info = await stat(inputPath);
  if (!info.isFile()) throw new Error(`Not a regular file: ${inputPath}`);
  if (info.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`File is larger than ${MAX_DOCUMENT_BYTES} bytes: ${inputPath}`);
  }

  const content = await readFile(inputPath, 'utf8');
  // mkdtemp creates the directory with mode 0700.
  const dir = await mkdtemp(join(baseDir, PREFIX));
  const paths = pathsFor(dir, dir.slice(-6));
  await writeFile(paths.document, content, { flag: 'wx', mode: 0o600 });
  return { paths, document: describeDocument(content) };
}

/** Resolves a session id to its directory, refusing anything we didn't create. */
export async function resolveSession(id: string, baseDir = tmpdir()): Promise<SessionPaths> {
  if (!SESSION_ID.test(id)) throw new Error(`Invalid session id: ${id}`);
  const dir = join(baseDir, PREFIX + id);

  let info;
  try {
    info = await lstat(dir);
  } catch {
    throw new Error(`No such session: ${id}`);
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Session path is not a directory: ${dir}`);
  }
  if (process.getuid && info.uid !== process.getuid()) {
    throw new Error(`Session directory is owned by another user: ${dir}`);
  }
  return pathsFor(dir, id);
}

export async function loadDocument(paths: SessionPaths): Promise<DocumentInfo> {
  return describeDocument(await readFile(paths.document, 'utf8'));
}
