import { mkdir, readFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createSession, describeDocument, MAX_DOCUMENT_BYTES, resolveSession } from '../src/session.js';
import { scratchDir, writeInput } from './helpers.js';

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => ({ dir, cleanup } = await scratchDir()));
afterEach(() => cleanup());

describe('describeDocument', () => {
  it.each([
    ['one', 1],
    ['one\n', 1],
    ['one\ntwo', 2],
    ['one\r\ntwo\r\n', 2],
    ['one\n\n', 2],
    ['', 1],
  ])('counts lines in %j as %d', (content, lines) => {
    expect(describeDocument(content).lines).toBe(lines);
  });
});

describe('createSession', () => {
  it('copies the input into a private session directory', async () => {
    const input = await writeInput(dir, '# Hello\n');
    const { paths, document } = await createSession(input, dir);

    expect(paths.id).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(paths.dir).toBe(join(dir, `llm-comment-${paths.id}`));
    expect(await readFile(paths.document, 'utf8')).toBe('# Hello\n');
    expect(document.lines).toBe(1);
    if (process.platform !== 'win32') {
      expect((await stat(paths.dir)).mode & 0o777).toBe(0o700);
      expect((await stat(paths.document)).mode & 0o777).toBe(0o600);
    }
  });

  it('rejects directories', async () => {
    await expect(createSession(dir, dir)).rejects.toThrow('Not a regular file');
  });

  it('rejects oversized files', async () => {
    const input = await writeInput(dir, 'x'.repeat(MAX_DOCUMENT_BYTES + 1));
    await expect(createSession(input, dir)).rejects.toThrow('larger than');
  });
});

describe('resolveSession', () => {
  it('finds a session it created', async () => {
    const { paths } = await createSession(await writeInput(dir, 'hi'), dir);
    expect(await resolveSession(paths.id, dir)).toEqual(paths);
  });

  it.each(['../etc', 'abc', 'abc/def', 'abcdefg', '..%2f..', ''])('rejects the id %j', async (id) => {
    await expect(resolveSession(id, dir)).rejects.toThrow('Invalid session id');
  });

  it('rejects unknown sessions', async () => {
    await expect(resolveSession('abcdef', dir)).rejects.toThrow('No such session');
  });

  it('rejects a symlink in place of a session directory', async () => {
    await mkdir(join(dir, 'elsewhere'));
    await symlink(join(dir, 'elsewhere'), join(dir, 'llm-comment-abcdef'));
    await expect(resolveSession('abcdef', dir)).rejects.toThrow('not a directory');
  });
});
