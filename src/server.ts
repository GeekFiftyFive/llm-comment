import { timingSafeEqual } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { DocumentInfo } from './session.js';
import { CommentError, type CommentStore, type NewComment } from './store.js';

export interface ServerOptions {
  document: DocumentInfo;
  store: CommentStore;
  token: string;
  /** Built frontend to serve; omitted in API-only tests. */
  publicDir?: string;
  /** Called after the user clicks Done and the response has been sent. */
  onDone?: () => void;
  /** Called on every authenticated API request, for idle-timeout tracking. */
  onActivity?: () => void;
}

const MAX_TEXT = 10_000;
const ID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

interface StaticFile {
  body: Buffer;
  type: string;
}

/** Loads the whole frontend into memory so request paths never reach the file system. */
async function loadStatic(dir: string): Promise<Map<string, StaticFile>> {
  const files = new Map<string, StaticFile>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const type = CONTENT_TYPES[extname(entry.name)];
    if (!type) continue;
    const full = join(entry.parentPath, entry.name);
    files.set('/' + relative(dir, full).split(sep).join('/'), { body: await readFile(full), type });
  }
  return files;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const { document, store, token } = options;
  const staticFiles = options.publicDir ? await loadStatic(options.publicDir) : new Map();

  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  // Only JSON bodies are accepted. text/plain is what a cross-site <form> can send.
  app.removeContentTypeParser('text/plain');

  const listeningPort = (): number | undefined => {
    const address = app.server.address();
    return typeof address === 'object' && address ? address.port : undefined;
  };

  const reject = (reply: FastifyReply, statusCode: number, message: string) =>
    reply.code(statusCode).send({ error: message });

  app.addHook('onSend', async (_request, reply) => {
    reply.headers(SECURITY_HEADERS);
  });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // DNS rebinding defence: a hostile domain resolving to 127.0.0.1 would send its own Host.
    const port = listeningPort();
    const host = request.headers.host;
    if (port === undefined || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      return reject(reply, 421, 'Unexpected Host header');
    }

    if (!request.url.startsWith('/api/')) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
        return reject(reply, 403, 'Cross-origin request refused');
      }
      const site = request.headers['sec-fetch-site'];
      if (site !== undefined && site !== 'same-origin' && site !== 'none') {
        return reject(reply, 403, 'Cross-site request refused');
      }
    }

    if (!tokenMatches(request.headers.authorization, token)) {
      return reject(reply, 401, 'Missing or invalid token');
    }
    options.onActivity?.();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CommentError) return reject(reply, error.statusCode, error.message);
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    return reject(reply, statusCode, statusCode < 500 ? (error as Error).message : 'Internal error');
  });

  const idParams = {
    type: 'object',
    properties: { id: { type: 'string', pattern: ID_PATTERN } },
    required: ['id'],
  } as const;
  const commentText = { type: 'string', minLength: 1, maxLength: MAX_TEXT } as const;

  app.get('/api/document', async () => document);

  app.get('/api/comments', async () => store.snapshot());

  app.post<{ Body: NewComment }>(
    '/api/comments',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['startLine', 'endLine', 'quote', 'comment'],
          properties: {
            startLine: { type: 'integer', minimum: 1 },
            endLine: { type: 'integer', minimum: 1 },
            quote: { type: 'string', maxLength: MAX_TEXT },
            comment: commentText,
          },
        },
      },
    },
    async (request, reply) => reply.code(201).send(await store.add(request.body)),
  );

  app.patch<{ Params: { id: string }; Body: { comment: string } }>(
    '/api/comments/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['comment'],
          properties: { comment: commentText },
        },
      },
    },
    async (request) => store.update(request.params.id, request.body.comment),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/comments/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      await store.remove(request.params.id);
      return reply.code(204).send();
    },
  );

  app.post('/api/done', async (_request, reply) => {
    await store.markDone();
    reply.raw.once('finish', () => options.onDone?.());
    return reply.code(204).send();
  });

  /** Lets `llm-comment comments` stop a background server. */
  app.post('/api/shutdown', async (_request, reply) => {
    reply.raw.once('finish', () => void app.close());
    return reply.code(204).send();
  });

  app.get('/*', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (path.startsWith('/api/')) return reject(reply, 404, 'Not found');
    // Unknown paths fall back to the app shell.
    const file = staticFiles.get(path) ?? staticFiles.get('/index.html');
    if (!file) return reject(reply, 404, 'Frontend not built');
    return reply.type(file.type).send(file.body);
  });

  return app;
}
