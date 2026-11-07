#!/usr/bin/env node
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildServer } from "./server.js";
import {
  createSession,
  loadDocument,
  resolveSession,
  type ServerInfo,
  type SessionPaths,
} from "./session.js";
import { CommentStore } from "./store.js";

const CLI_PATH = fileURLToPath(import.meta.url);
const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const READY_TIMEOUT_MS = 10_000;

const USAGE = `Usage:
  llm-comment open <file> [options]   Start a review session for <file>
  llm-comment comments <session>      Print a session's comments as JSON and stop its server

Options for open:
  --wait             Stay in the foreground and print the comments when the user clicks Done
  --no-open          Don't open a browser; just print the URL
  --port <n>         Port to listen on (default: random)
  --timeout <min>    Stop the server after this many idle minutes (default: 120)
`;

type ExitReason = "done" | "timeout" | "shutdown";

interface ServeOptions {
  port: number;
  timeoutMs: number;
}

type ReadyMessage = { type: "ready"; url: string } | { type: "error"; message: string };

class UsageError extends Error {}

const serveArgs = {
  port: { type: "string", default: "0" },
  timeout: { type: "string", default: "120" },
} as const;

function parseServeOptions(values: { port: string; timeout: string }): ServeOptions {
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`Invalid port: ${values.port}`);
  }
  const minutes = Number(values.timeout);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new UsageError(`Invalid timeout: ${values.timeout}`);
  }
  return { port, timeoutMs: minutes * 60_000 };
}

async function runServer(paths: SessionPaths, options: ServeOptions) {
  const document = await loadDocument(paths);
  const store = await CommentStore.load(paths.comments);
  const token = randomBytes(32).toString("base64url");

  let reason: ExitReason = "shutdown";
  let idleTimer: NodeJS.Timeout | undefined;
  const stop = (why: ExitReason) => {
    reason = why;
    void app.close();
  };
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop("timeout"), options.timeoutMs);
  };

  const app = await buildServer({
    document,
    store,
    token,
    publicDir: PUBLIC_DIR,
    onActivity: resetIdleTimer,
    onDone: () => stop("done"),
  });
  const closed = new Promise<ExitReason>((resolve) => {
    app.addHook("onClose", async () => {
      clearTimeout(idleTimer);
      resolve(reason);
    });
  });

  await app.listen({ host: "127.0.0.1", port: options.port });
  resetIdleTimer();

  const { port } = app.server.address() as AddressInfo;
  const info: ServerInfo = { pid: process.pid, port, token };
  await writeFile(paths.server, JSON.stringify(info), { mode: 0o600 });

  return {
    // The token goes in the fragment so it is never sent to the server or in a Referer.
    url: `http://127.0.0.1:${port}/#token=${token}`,
    closed,
    stop: () => stop("shutdown"),
  };
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch (error) {
    process.stderr.write(`Could not open a browser (${(error as Error).message}). Visit: ${url}\n`);
  }
}

async function printComments(paths: SessionPaths): Promise<void> {
  process.stdout.write(await readFile(paths.comments, "utf8"));
}

function waitForReady(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Server did not start in time")),
      READY_TIMEOUT_MS,
    );
    child.once("message", (message: ReadyMessage) => {
      clearTimeout(timer);
      if (message.type === "ready") resolve(message.url);
      else reject(new Error(message.message));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited before it was ready (code ${code})`));
    });
  });
}

async function openCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: {
      ...serveArgs,
      wait: { type: "boolean", default: false },
      open: { type: "boolean", default: true },
    },
  });
  const file = positionals[0];
  if (!file || positionals.length > 1) throw new UsageError("open takes exactly one file");
  const options = parseServeOptions(values);

  const { paths, document } = await createSession(file);
  await CommentStore.create(paths.comments, document);

  if (values.wait) {
    const server = await runServer(paths, options);
    process.stderr.write(`Session ${paths.id}: review the output at ${server.url}\n`);
    process.once("SIGINT", server.stop);
    process.once("SIGTERM", server.stop);
    if (values.open) await openBrowser(server.url);

    const reason = await server.closed;
    if (reason === "timeout") process.stderr.write("Timed out waiting for the review to finish.\n");
    await printComments(paths);
    return;
  }

  const child = spawn(
    process.execPath,
    [CLI_PATH, "serve", paths.id, "--port", values.port, "--timeout", values.timeout],
    { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  try {
    const url = await waitForReady(child);
    if (values.open) await openBrowser(url);
    process.stdout.write(JSON.stringify({ session: paths.id, url }) + "\n");
  } finally {
    child.removeAllListeners();
    if (child.connected) child.disconnect();
    child.unref();
  }
}

/** Internal: runs the server for an existing session, started in the background by `open`. */
async function serveCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: serveArgs });
  try {
    if (positionals.length !== 1) throw new UsageError("serve takes exactly one session id");
    const paths = await resolveSession(positionals[0]!);
    const server = await runServer(paths, parseServeOptions(values));
    process.send?.({ type: "ready", url: server.url } satisfies ReadyMessage);
    process.disconnect?.();
    await server.closed;
  } catch (error) {
    process.send?.({ type: "error", message: (error as Error).message } satisfies ReadyMessage);
    throw error;
  }
}

async function commentsCommand(args: string[]): Promise<void> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} });
  if (positionals.length !== 1) throw new UsageError("comments takes exactly one session id");
  const paths = await resolveSession(positionals[0]!);

  try {
    const info = JSON.parse(await readFile(paths.server, "utf8")) as ServerInfo;
    await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${info.token}` },
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // The server has already stopped.
  }
  await printComments(paths);
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  switch (command) {
    case "open":
      return openCommand(args);
    case "comments":
      return commentsCommand(args);
    case "serve":
      return serveCommand(args);
    case undefined:
    case "-h":
    case "--help":
      process.stdout.write(USAGE);
      return;
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`llm-comment: ${(error as Error).message}\n`);
    if (error instanceof UsageError) process.stderr.write(`\n${USAGE}`);
    process.exit(1);
  },
);
