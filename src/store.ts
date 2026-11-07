import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { DocumentInfo } from "./session.js";

export const MAX_COMMENTS = 500;

export interface Comment {
  id: string;
  startLine: number;
  endLine: number;
  quote: string;
  comment: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CommentsFile {
  version: 1;
  document: { sha256: string; lines: number };
  status: "open" | "done";
  comments: Comment[];
}

export interface NewComment {
  startLine: number;
  endLine: number;
  quote: string;
  comment: string;
}

export class CommentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

async function writeAtomic(path: string, data: string): Promise<void> {
  // `wx` refuses to follow a pre-existing file or symlink at the temp path.
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, data, { flag: "wx", mode: 0o600 });
  await rename(temp, path);
}

/** In-memory comment state, persisted to disk after every change. */
export class CommentStore {
  private writes: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private data: CommentsFile,
  ) {}

  static async create(path: string, document: DocumentInfo): Promise<CommentStore> {
    const store = new CommentStore(path, {
      version: 1,
      document: { sha256: document.sha256, lines: document.lines },
      status: "open",
      comments: [],
    });
    await store.persist();
    return store;
  }

  static async load(path: string): Promise<CommentStore> {
    return new CommentStore(path, JSON.parse(await readFile(path, "utf8")) as CommentsFile);
  }

  snapshot(): CommentsFile {
    return structuredClone(this.data);
  }

  async add(input: NewComment): Promise<Comment> {
    const { lines } = this.data.document;
    if (input.startLine > input.endLine || input.endLine > lines) {
      throw new CommentError(`Line range must be within 1-${lines}`, 400);
    }
    if (this.data.comments.length >= MAX_COMMENTS) {
      throw new CommentError(`At most ${MAX_COMMENTS} comments are allowed`, 409);
    }
    const comment: Comment = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    this.data.comments.push(comment);
    await this.persist();
    return comment;
  }

  async update(id: string, text: string): Promise<Comment> {
    const comment = this.find(id);
    comment.comment = text;
    comment.updatedAt = new Date().toISOString();
    await this.persist();
    return comment;
  }

  async remove(id: string): Promise<void> {
    this.find(id);
    this.data.comments = this.data.comments.filter((c) => c.id !== id);
    await this.persist();
  }

  async markDone(): Promise<void> {
    this.data.status = "done";
    await this.persist();
  }

  private find(id: string): Comment {
    const comment = this.data.comments.find((c) => c.id === id);
    if (!comment) throw new CommentError("Comment not found", 404);
    return comment;
  }

  private persist(): Promise<void> {
    // Serialise writes so a slow write can never overwrite a newer one.
    const json = JSON.stringify(this.data, null, 2) + "\n";
    this.writes = this.writes.catch(() => {}).then(() => writeAtomic(this.path, json));
    return this.writes;
  }
}
