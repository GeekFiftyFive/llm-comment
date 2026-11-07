import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { scratchDir, writeInput } from "../helpers.js";

// Runs the built CLI (`npm run test:e2e` builds first).
const CLI = join(__dirname, "..", "..", "dist", "cli.js");
const run = promisify(execFile);

let dir: string;
let cleanup: () => Promise<void>;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  ({ dir, cleanup } = await scratchDir());
  // Sessions are created under os.tmpdir(), which honours TMPDIR.
  env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir };
});
afterEach(() => cleanup());

function client(url: string) {
  const { origin, hash } = new URL(url);
  const token = new URLSearchParams(hash.slice(1)).get("token");
  return (method: string, path: string, body?: unknown) =>
    fetch(origin + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
}

const comment = { startLine: 1, endLine: 1, quote: "Hello", comment: "Say goodbye instead" };

it("--wait prints the comments when the user finishes", async () => {
  const input = await writeInput(dir, "# Hello\n\nWorld\n");
  const child = spawn(process.execPath, [CLI, "open", input, "--wait", "--no-open"], { env });

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
  const url = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+\/#token=\S+/.exec(stderr);
      if (match) resolve(match[0]);
    });
    child.once("exit", () => reject(new Error(stderr)));
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));

  const api = client(url);
  expect((await api("GET", "/")).headers.get("content-type")).toContain("text/html");
  expect((await api("POST", "/api/comments", comment)).status).toBe(201);
  expect((await api("POST", "/api/done")).status).toBe(204);

  expect(await exited).toBe(0);
  const result = JSON.parse(stdout);
  expect(result.status).toBe("done");
  expect(result.document.lines).toBe(3);
  expect(result.comments).toEqual([expect.objectContaining(comment)]);
});

it("open starts a background server that comments collects and stops", async () => {
  const input = await writeInput(dir, "Hello\n");
  const opened = await run(process.execPath, [CLI, "open", input, "--no-open"], { env });
  const { session, url } = JSON.parse(opened.stdout);
  expect(session).toMatch(/^[A-Za-z0-9]{6}$/);

  const api = client(url);
  expect((await api("POST", "/api/comments", comment)).status).toBe(201);

  const collected = await run(process.execPath, [CLI, "comments", session], { env });
  const result = JSON.parse(collected.stdout);
  expect(result.status).toBe("open");
  expect(result.comments).toEqual([expect.objectContaining(comment)]);

  await expect(api("GET", "/api/document")).rejects.toThrow();
});

it("rejects an invalid session id", async () => {
  await expect(run(process.execPath, [CLI, "comments", "../etc"], { env })).rejects.toMatchObject({
    stderr: expect.stringContaining("Invalid session id"),
  });
});
