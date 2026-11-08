# AI tooling

Codex and Claude are the supported development assistants.

- `AGENTS.md` is the canonical repository guide. Read the nearest module
  `AGENTS.md` and README for local rules.
- `CLAUDE.md` imports that same guide rather than maintaining a second manual.
- `.codex/config.toml` configures Codex MCP servers and features.
- `.codex/environments/environment.toml` configures Codex worktree setup.
- `.agents/skills` contains reusable skills. Update third-party skills together
  with `skills-lock.json`; keep project-specific adaptations separate.
- `.github/workflows/copilot-code-review.yml` supports the required Copilot PR
  review. It does not configure a separate development agent or require private
  packages and runtime credentials.

Keep shared formatting and linting in `.editorconfig`, Prettier, and ESLint
configuration rather than checking in editor-specific settings.

Entire session recording is not enabled by this repository. Its agent/Git hooks
are separate from Entire Git hosting. The planned hosting and CI migration is
tracked in [EVO-50](https://linear.app/evorto/issue/EVO-50/move-evorto-to-entire-and-rwx-with-smaller-workflows-and-reliable-test);
current PR review and verification requirements remain in force until cutover.
