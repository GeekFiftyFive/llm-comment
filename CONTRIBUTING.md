# Contributing to llm-comment

Thanks for your interest in improving llm-comment. Bug reports, fixes and ideas are all welcome.

## Before you start

For anything bigger than a small fix, please [open an issue](https://github.com/GeekFiftyFive/llm-comment/issues)
first to discuss it. That way you won't spend time on a change that doesn't fit the project.

## Setting up

You need Node.js 24 or later. Fork the repository, clone your fork, then:

```sh
npm install
```

This also installs git hooks (via [Lefthook](https://lefthook.dev)) that lint, format-check and test your changes on
commit and push. The commands for building, testing and running the app locally are in the
[Development section of the README](README.md#development).

## Making a change

- Branch from `main`, using a name like `fix/short-description`.
- Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org/) style, for example
  `fix: keep comments anchored after a source edit`.
- Add or update tests for any change in behaviour.
- Keep each pull request to one change. Small PRs get reviewed faster.
- Don't change the version number or release files. Releases are handled by the maintainer.
- Before opening a PR, make sure `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` and
  `npm run test:e2e` all pass. CI runs the same checks.

## Opening a pull request

Open your pull request against `main`. We recommend opening it as a draft and marking it ready for review once you're
happy with it. The PR template asks for a summary, how you tested the change, and whether you used AI tools.

## Using AI tools

You're welcome to use AI coding tools to help with your contribution, on these conditions:

- **Disclose it.** Say in the PR which tools you used and roughly what for.
- **Understand it.** You must have read and understood every line you're submitting, and be able to explain it in
  review.
- **Own it.** You're responsible for the contribution as if you'd written it all yourself: answering review
  questions, making changes, and fixing problems it causes.

If you use an AI agent, it will find project-specific instructions in [AGENTS.md](AGENTS.md). Those instructions
include not posting anything to GitHub on your behalf without your approval.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
