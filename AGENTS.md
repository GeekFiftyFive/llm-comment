# AGENTS.md

Instructions for AI coding agents working on this repository. Human contributors should read
[CONTRIBUTING.md](CONTRIBUTING.md); everything there applies to agents too.

## Project overview

llm-comment opens an agent's Markdown output in a local web page, lets the user leave inline comments, and returns
them as JSON. It ships as an npm CLI and as a Claude Code plugin.

- `src/`: the CLI (`cli.ts`), the local Fastify review server (`server.ts`), session directories (`session.ts`) and
  comment storage (`store.ts`).
- `web/`: the React review UI, bundled by Vite into `dist/public/`.
- `plugin/`: the Claude Code plugin and its `review-output` skill. `.claude-plugin/marketplace.json` makes this repo a
  plugin marketplace.
- `test/`: Jest unit tests, plus `test/e2e/`, which drives the built CLI.
- `docs/`: contributor and maintainer docs. `README.md` is for end users; don't add contributor material to it.

## Commands

Node.js 24 (see `.nvmrc`). `npm install` also installs the Lefthook git hooks.

```sh
npm run build        # compile the CLI and bundle the frontend into dist/
npm run typecheck    # tsc over src, test and web
npm test             # unit tests
npm run test:e2e     # builds, then drives the real CLI
npm run lint         # oxlint
npm run format       # oxfmt (format:check to check without writing)
```

Before saying a change is done, run `lint`, `format:check`, `typecheck`, `test` and `test:e2e`. These are what CI runs.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`,
  `chore:`, `build:`, `ci:`, `style:`, `test:`, `refactor:`.
- New behaviour comes with tests, following the existing patterns in `test/`.
- Keep changes focused on the task. No drive-by refactors or reformatting of unrelated code.

## Hard rules

These apply in both workflows below. Each one can be overridden only by the user explicitly asking.

- **Never change the project version.** Releases are a deliberate maintainer decision, and the version has to
  change in several files at once. It lives in all of these places:
  - `version` in `package.json` and the matching fields in `package-lock.json`
  - `version` in `plugin/.claude-plugin/plugin.json`
  - the pinned `npx -y llm-comment@x.y.z` in `plugin/skills/review-output/SKILL.md`
  - the pinned `npx` examples in `README.md`

  Also don't run `npm version` or `npm publish`, and don't create or push git tags. If a change looks like it
  warrants a release, say so in the PR description instead. When asked to bump the version, follow
  [docs/RELEASING.md](docs/RELEASING.md).

- **Never skip git hooks** (`--no-verify`, `LEFTHOOK=0`). If a hook fails, fix the cause.
- **Don't change CI or release workflows** in `.github/workflows/`. They are security-sensitive: CI must stay on
  `pull_request` (never `pull_request_target`) with read-only permissions and SHA-pinned actions, and the
  `Lint, build and test` job name is referenced by the branch ruleset.
- **Don't weaken the review server's security checks** in `src/server.ts` (bearer token, `Host`, `Origin` and
  `Sec-Fetch-Site` checks, body validation, CSP). See "Security model" in the README.
- **Don't add runtime dependencies.** The published package is deliberately small.

## Which workflow applies

Find out whether the user maintains this repository:

```sh
gh repo view GeekFiftyFive/llm-comment --json viewerPermission -q .viewerPermission
```

If it prints `ADMIN` or `MAINTAIN`, use the maintainer workflow. If it prints anything else, fails, or `gh` isn't
installed, use the contributor workflow.

## Maintainer workflow

You are working with the project maintainer.

- **Tickets:** work is tracked in Linear. If the task has a ticket, use the branch name Linear generates for it (for
  example `lllmc-7-establish-llm-ways-of-working`) and reference the ticket ID in the PR description. Without a
  ticket, name the branch `<type>/<short-slug>`, for example `build/slim-package`.
- **Never commit to `main`.** Work on a branch; `main` only changes through pull requests.
- **Ask before changing anything remote.** Editing files and committing locally is fine. Pushing, opening or updating
  PRs, and changing Linear tickets all need the user's permission. When you think the implementation is done, say so
  and ask for permission to push and open a PR.
- **Always open PRs as drafts** (`gh pr create --draft --base main`). The maintainer marks them ready for review.
- **Never merge PRs.**

## Contributor workflow

You are working for someone contributing from outside the project. Their name is on the contribution, so they must
see and approve everything before it is published.

- **Discuss larger changes first.** For anything bigger than a small fix, suggest the user opens an issue before you
  start, so the work isn't wasted on a change that won't be accepted.
- **Work on a fork.** `origin` is the user's fork and `upstream` is `GeekFiftyFive/llm-comment`. Branch from
  `upstream/main`, and name the branch `<type>/<short-slug>`.
- **Nothing is posted without approval.** Draft the PR title and description (or issue, or comment), show them to the
  user, and only run `gh pr create` or similar after they approve. Open PRs as drafts; the user marks them ready once
  they're happy.
- **Fill in the PR template**, including the AI disclosure section. Only tick the ownership checkbox if the user has
  confirmed it; never tick it on their behalf.
- **Don't reference private context.** The maintainer's Linear tickets aren't visible to contributors. Link GitHub
  issues instead.
- **One concern per PR.** Keep PRs small, and don't touch files the hard rules above protect.
