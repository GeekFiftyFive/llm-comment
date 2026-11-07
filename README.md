# llm-comment

Leave inline comments on AI agent output in a local web UI, then hand them back to the agent. Works with any harness
that can run a shell command.

## Agent skill

`plugin/skills/review-output/SKILL.md` tells an agent how to write its output to a file, run a review and act on the
comments. In Claude Code it runs as `/llm-comment:review-output`, or automatically when you ask to comment on its
output.

Install in Claude Code (this repo is also a plugin marketplace). Run this from any directory; there's no need to
clone the repo first:

```sh
/plugin install llm-comment --marketplace GeekFiftyFive/llm-comment
```

Claude Code fetches the marketplace straight from the `GeekFiftyFive/llm-comment` GitHub repo, saves it in your user
settings and installs the skill for all your projects. Add `--scope project` to record it in the current project's
`.claude/settings.json` instead, so collaborators are offered it too.

On versions before 2.1.275, add the marketplace first:
`/plugin marketplace add GeekFiftyFive/llm-comment`, then `/plugin install llm-comment@llm-comment`.

The skill runs `llm-comment` if it's on your `PATH`, and otherwise `npx -y llm-comment@<pinned version>`, so you
don't need to install the CLI separately.

## CLI usage

```sh
# Foreground: blocks until the user clicks "Finish review", then prints the comments JSON.
npx -y llm-comment@0.1.0 open /path/to/output.md --wait

# Background: prints {"session":"…","url":"…"} and exits immediately.
npx -y llm-comment@0.1.0 open /path/to/output.md
# Later: print the comments and stop the background server.
npx -y llm-comment@0.1.0 comments <session>
```

Options for `open`: `--no-open` (don't launch a browser), `--port <n>`, `--timeout <minutes>` (idle timeout, default
120). The server also stops when the review is finished.

Output:

```json
{
  "version": 1,
  "document": { "sha256": "…", "lines": 31 },
  "status": "done",
  "comments": [
    {
      "id": "…",
      "startLine": 7,
      "endLine": 9,
      "quote": "selected text",
      "comment": "…",
      "createdAt": "…"
    }
  ]
}
```

`status` is `"open"` if the review timed out or `comments` was run before the user finished.

## Security model

- The input file is copied into a private `mkdtemp` session directory (mode 0700). The server only reads and writes
  fixed files in that directory; no request ever carries a path.
- Listens on `127.0.0.1` only, on a random port. Requests with any other `Host` header are refused (DNS rebinding).
- Every API request needs a per-session bearer token, delivered in the URL fragment so it never reaches logs or
  `Referer`. No CORS headers are sent; writes also check `Origin`/`Sec-Fetch-Site` and only JSON bodies are accepted.
- Request bodies are schema-validated and size-limited.
- The document is rendered without raw HTML, remote images are blocked, and a strict CSP is applied.

## Development

```sh
npm run build        # compile the CLI and bundle the frontend into dist/
npm run typecheck    # tsc over src, test and web
npm test             # unit tests
npm run test:e2e     # builds, then drives the real CLI
npm run lint         # oxlint
npm run format       # oxfmt (format:check to check without writing)
```

Git hooks are managed by [Lefthook](https://lefthook.dev) and installed by `npm install`. Before each commit they
lint and format-check the staged files and run the unit tests; before each push they lint and format-check the whole
project, typecheck, and run the unit and end-to-end tests. Skip them once with `LEFTHOOK=0`.

Frontend with live reload: run `npm run dev:server` (serves `example.md` on port 4100 and prints a URL with a token),
then `npm run dev:web` and open `http://localhost:5173/#token=<token from the first command>`.

To try the skill against your working copy, run `npm link` (puts `llm-comment` on your `PATH`, pointing at `dist/`),
then start Claude Code with `claude --plugin-dir ./plugin`. Check manifests with `claude plugin validate .`.

Jest runs under `node --experimental-vm-modules` so it can load Fastify's ESM-only dependencies. TypeScript 7 has no
compiler API for ts-jest, so tests are transpiled with SWC and type-checked separately by `npm run typecheck`.

## CI and releasing

Every pull request to `main`, including drafts, runs lint, format check, typecheck, build and all tests
(`.github/workflows/ci.yml`).

To release:

1. Bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and the pinned `npx` version in
   `plugin/skills/review-output/SKILL.md` together, so the skill always runs the CLI it was written for. Merge that to
   `main`.
2. Tag the merged commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. Approve the `npm` deployment in the workflow run on GitHub.

`.github/workflows/release.yml` checks the tag matches the `package.json` version and points at a commit on `main`,
runs every check, packs the package, and publishes that tarball to npm with provenance. Versions with a pre-release
suffix (`v0.2.0-beta.1`) are published under the `next` dist-tag instead of `latest`.

Publishing uses npm trusted publishing, so no npm token is stored in GitHub. It relies on these settings:

- **npm package settings:** a trusted publisher for GitHub Actions (`GeekFiftyFive/llm-comment`, workflow
  `release.yml`, environment `npm`), and publishing access set to "Require two-factor authentication and disallow
  tokens".
- **GitHub environment `npm`:** a required reviewer, and deployments limited to tags matching `v*`.
- **GitHub rulesets:** `v*` tags can only be created, moved or deleted by admins; `main` requires a pull request
  with the "Lint, build and test" check passing.
- **GitHub Actions settings:** fork pull request workflows need approval for all outside contributors, and the default
  workflow permissions are read-only.
