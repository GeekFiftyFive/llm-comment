import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A scratch directory standing in for os.tmpdir(), removed after each test. */
export async function scratchDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'llm-comment-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function writeInput(dir: string, content: string, name = 'input.md'): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}
