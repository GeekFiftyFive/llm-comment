import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describeDocument } from '../src/session.js';
import { CommentError, CommentStore, MAX_COMMENTS } from '../src/store.js';
import { scratchDir } from './helpers.js';

let dir: string;
let cleanup: () => Promise<void>;
let path: string;
let store: CommentStore;

beforeEach(async () => {
  ({ dir, cleanup } = await scratchDir());
  path = join(dir, 'comments.json');
  store = await CommentStore.create(path, describeDocument('a\nb\nc\n'));
});
afterEach(() => cleanup());

const onDisk = async () => JSON.parse(await readFile(path, 'utf8'));
const input = { startLine: 1, endLine: 2, quote: 'a b', comment: 'Fix this' };

it('writes an empty open file on creation', async () => {
  expect(await onDisk()).toEqual({
    version: 1,
    document: { sha256: describeDocument('a\nb\nc\n').sha256, lines: 3 },
    status: 'open',
    comments: [],
  });
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
});

it('adds, updates and removes comments, persisting each change', async () => {
  const added = await store.add(input);
  expect(added).toMatchObject(input);
  expect((await onDisk()).comments).toEqual([added]);

  const updated = await store.update(added.id, 'Changed');
  expect(updated.comment).toBe('Changed');
  expect(updated.updatedAt).toBeDefined();
  expect((await onDisk()).comments[0].comment).toBe('Changed');

  await store.remove(added.id);
  expect((await onDisk()).comments).toEqual([]);
});

it('marks the review done', async () => {
  await store.markDone();
  expect((await onDisk()).status).toBe('done');
});

it('reloads what it wrote', async () => {
  await store.add(input);
  expect((await CommentStore.load(path)).snapshot()).toEqual(store.snapshot());
});

it('keeps the last write when changes overlap', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.add({ ...input, comment: `#${i}` })));
  expect((await onDisk()).comments).toHaveLength(20);
  expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
});

it.each([
  [{ startLine: 3, endLine: 2 }, 'within'],
  [{ startLine: 1, endLine: 4 }, 'within'],
])('rejects the line range %j', async (range) => {
  await expect(store.add({ ...input, ...range })).rejects.toThrow(CommentError);
});

it('caps the number of comments', async () => {
  for (let i = 0; i < MAX_COMMENTS; i++) await store.add(input);
  await expect(store.add(input)).rejects.toMatchObject({ statusCode: 409 });
});

it('reports unknown ids as not found', async () => {
  await expect(store.update('missing', 'x')).rejects.toMatchObject({ statusCode: 404 });
  await expect(store.remove('missing')).rejects.toMatchObject({ statusCode: 404 });
});
