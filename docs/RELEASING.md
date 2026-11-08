# Releasing

Releases are published to npm by GitHub Actions when a version tag is pushed.

## Steps

1. Bump the version in `package.json`, `plugin/.claude-plugin/plugin.json` and the pinned `npx` version in
   `plugin/skills/review-output/SKILL.md` together, so the skill always runs the CLI it was written for. Merge that to
   `main`.
2. Tag the merged commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. Approve the `npm` deployment in the workflow run on GitHub.

`.github/workflows/release.yml` checks the tag matches the `package.json` version and points at a commit on `main`,
runs every check, packs the package, and publishes that tarball to npm with provenance. Versions with a pre-release
suffix (`v0.2.0-beta.1`) are published under the `next` dist-tag instead of `latest`.

## Required settings

Publishing uses npm trusted publishing, so no npm token is stored in GitHub. It relies on these settings:

- **npm package settings:** a trusted publisher for GitHub Actions (`GeekFiftyFive/llm-comment`, workflow
  `release.yml`, environment `npm`), and publishing access set to "Require two-factor authentication and disallow
  tokens".
- **GitHub environment `npm`:** a required reviewer, and deployments limited to tags matching `v*`.
- **GitHub rulesets:** `v*` tags can only be created, moved or deleted by admins; `main` requires a pull request
  with the "Lint, build and test" check passing.
- **GitHub Actions settings:** fork pull request workflows need approval for all outside contributors, and the default
  workflow permissions are read-only.
