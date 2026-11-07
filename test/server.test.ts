import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildServer } from "../src/server.js";
import { describeDocument } from "../src/session.js";
import { CommentStore } from "../src/store.js";
import { scratchDir } from "./helpers.js";

const TOKEN = "test-token";
const CONTENT = "# Title\n\nLine three\nLine four\n";

let cleanup: () => Promise<void>;
let app: FastifyInstance;
let store: CommentStore;
let origin: string;
let onDone: jest.Mock;

beforeEach(async () => {
  let dir: string;
  ({ dir, cleanup } = await scratchDir());
  const publicDir = join(dir, "public");
  await mkdir(join(publicDir, "assets"), { recursive: true });
  await writeFile(join(publicDir, "index.html"), "<!doctype html><title>app</title>");
  await writeFile(join(publicDir, "assets", "app.js"), "console.log(1)");
  await writeFile(join(dir, "secret.txt"), "top secret");

  const document = describeDocument(CONTENT);
  store = await CommentStore.create(join(dir, "comments.json"), document);
  onDone = jest.fn();
  app = await buildServer({ document, store, token: TOKEN, publicDir, onDone });
  await app.listen({ host: "127.0.0.1", port: 0 });
  origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await app.close();
  await cleanup();
});

/** Sends a request that looks like it came from the app's own page. */
function send(options: InjectOptions & { headers?: Record<string, string> }) {
  return app.inject({
    ...options,
    headers: { host: new URL(origin).host, authorization: `Bearer ${TOKEN}`, ...options.headers },
  });
}

const validComment = { startLine: 3, endLine: 4, quote: "Line three Line four", comment: "Reword" };

describe("API", () => {
  it("serves the document", async () => {
    const response = await send({ method: "GET", url: "/api/document" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(describeDocument(CONTENT));
  });

  it("creates, edits, lists and deletes comments", async () => {
    const created = await send({ method: "POST", url: "/api/comments", payload: validComment });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();

    const edited = await send({
      method: "PATCH",
      url: `/api/comments/${id}`,
      payload: { comment: "Better" },
    });
    expect(edited.json().comment).toBe("Better");

    const listed = await send({ method: "GET", url: "/api/comments" });
    expect(listed.json().comments).toHaveLength(1);

    expect((await send({ method: "DELETE", url: `/api/comments/${id}` })).statusCode).toBe(204);
    expect(store.snapshot().comments).toEqual([]);
  });

  it("marks the review done and notifies the caller", async () => {
    expect((await send({ method: "POST", url: "/api/done" })).statusCode).toBe(204);
    expect(store.snapshot().status).toBe("done");
    expect(onDone).toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it.each([
    ["no token", undefined],
    ["a wrong token", "Bearer nope"],
    ["a token of the wrong length", `Bearer ${TOKEN}x`],
    ["the token without the scheme", TOKEN],
  ])("rejects %s", async (_label, authorization) => {
    const headers: Record<string, string> = { host: new URL(origin).host };
    if (authorization) headers.authorization = authorization;
    for (const url of ["/api/document", "/api/comments"]) {
      expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(401);
    }
    const write = await app.inject({
      method: "POST",
      url: "/api/comments",
      headers,
      payload: validComment,
    });
    expect(write.statusCode).toBe(401);
    expect(store.snapshot().comments).toEqual([]);
  });

  it("does not require a token for the frontend", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/",
      headers: { host: new URL(origin).host },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("DNS rebinding", () => {
  it.each(["evil.example:1234", "evil.example", "127.0.0.1", "127.0.0.1:1", "0.0.0.0", ""])(
    "rejects the Host header %j",
    async (host) => {
      const response = await send({ method: "GET", url: "/", headers: { host } });
      expect(response.statusCode).toBe(421);
    },
  );

  it("accepts localhost on the listening port", async () => {
    const host = `localhost:${new URL(origin).port}`;
    expect(
      (await send({ method: "GET", url: "/api/document", headers: { host } })).statusCode,
    ).toBe(200);
  });
});

describe("CSRF", () => {
  it("rejects writes from another origin", async () => {
    const response = await send({
      method: "POST",
      url: "/api/comments",
      payload: validComment,
      headers: { origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects cross-site fetch metadata", async () => {
    const response = await send({
      method: "POST",
      url: "/api/done",
      headers: { origin, "sec-fetch-site": "cross-site" },
    });
    expect(response.statusCode).toBe(403);
    expect(store.snapshot().status).toBe("open");
  });

  it("accepts writes from its own origin", async () => {
    const response = await send({
      method: "POST",
      url: "/api/comments",
      payload: validComment,
      headers: { origin, "sec-fetch-site": "same-origin" },
    });
    expect(response.statusCode).toBe(201);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])(
    "refuses %s bodies, which a cross-site form could send",
    async (type) => {
      const response = await send({
        method: "POST",
        url: "/api/comments",
        payload: JSON.stringify(validComment),
        headers: { "content-type": type },
      });
      expect(response.statusCode).toBe(415);
    },
  );

  it("sends no CORS headers", async () => {
    const response = await send({
      method: "OPTIONS",
      url: "/api/comments",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("validation", () => {
  it.each([
    ["an extra field", { ...validComment, extra: 1 }],
    ["a missing field", { startLine: 1, endLine: 1, quote: "" }],
    ["a string line number", { ...validComment, startLine: "1" }],
    ["a fractional line number", { ...validComment, startLine: 1.5 }],
    ["line zero", { ...validComment, startLine: 0 }],
    ["an empty comment", { ...validComment, comment: "" }],
    ["an oversized comment", { ...validComment, comment: "x".repeat(10_001) }],
    ["a range past the end", { ...validComment, endLine: 5 }],
    ["a reversed range", { ...validComment, startLine: 4, endLine: 3 }],
  ])("rejects %s", async (_label, payload) => {
    const response = await send({ method: "POST", url: "/api/comments", payload });
    expect(response.statusCode).toBe(400);
    expect(store.snapshot().comments).toEqual([]);
  });

  it("rejects bodies over the size limit", async () => {
    const payload = { ...validComment, quote: "x".repeat(70_000) };
    expect((await send({ method: "POST", url: "/api/comments", payload })).statusCode).toBe(413);
  });

  it.each(["../../etc/passwd", "not-a-uuid", "%2e%2e%2fsecret.txt"])(
    "rejects the comment id %j",
    async (id) => {
      const response = await send({
        method: "PATCH",
        url: `/api/comments/${id}`,
        payload: { comment: "x" },
      });
      // Ids with slashes don't match the route at all (404); others fail validation (400).
      expect([400, 404]).toContain(response.statusCode);
    },
  );

  it("returns 404 for an unknown comment", async () => {
    const url = "/api/comments/00000000-0000-4000-8000-000000000000";
    expect((await send({ method: "DELETE", url })).statusCode).toBe(404);
  });
});

describe("static files", () => {
  it("serves built assets with their content type", async () => {
    const response = await send({ method: "GET", url: "/assets/app.js" });
    expect(response.body).toBe("console.log(1)");
    expect(response.headers["content-type"]).toContain("text/javascript");
  });

  it.each([
    "/../secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/secret.txt",
  ])("never serves files outside the frontend for %s", async (url) => {
    const response = await send({ method: "GET", url });
    expect(response.body).not.toContain("top secret");
  });

  it("falls back to the app shell for unknown paths", async () => {
    const response = await send({ method: "GET", url: "/some/route" });
    expect(response.body).toContain("<title>app</title>");
  });

  it("returns 404 for unknown API routes", async () => {
    expect((await send({ method: "GET", url: "/api/nope" })).statusCode).toBe(404);
  });

  it("sets security headers", async () => {
    const response = await send({ method: "GET", url: "/" });
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
});
