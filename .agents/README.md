# AI tooling

Codex, Claude, Gemini CLI and Google Antigravity share the same Entire workflow.

- `AGENTS.md` is the canonical repository guide. Read the nearest module
  `AGENTS.md` and README for local rules.
- `CLAUDE.md` imports that same guide rather than maintaining a second manual.
- `GEMINI.md` imports it for Gemini CLI. Antigravity supports `AGENTS.md` and
  `GEMINI.md`; read nearest module guidance explicitly in every tool.
- [Entire workflow](entire-workflow.md) documents Trail publication, collaborator
  onboarding, issue/CI migration, billing and remaining cutover work.
- `.codex/config.toml` configures Codex MCP servers and features.
- `.codex/environments/environment.toml` configures Codex worktree setup.
- `.agents/skills` contains reusable skills. Update third-party skills together
  with `skills-lock.json`; keep project-specific adaptations separate.
- `.github/workflows/copilot-code-review.yml` supports the required Copilot PR
  review. It does not configure a separate development agent or require private
  packages and runtime credentials.

Keep shared formatting and linting in `bunfig.toml`, `.editorconfig`, and
ESLint configuration.

Entire Trails use the existing GitHub mirror. Entire recording is enabled for
Codex, Claude Code and Antigravity through generated lifecycle hooks; current
Entire no longer supports Gemini CLI capture. Gemini still follows the shared
Trail instructions. Brain supplies repository memory and hosted synchronization;
read the setup and validation requirements in the workflow guide.
Keep authentication, personal settings and session caches local. The migration
is tracked in [EVO-54](https://linear.app/evorto/issue/EVO-54/migrate-git-hosting-and-protected-review-to-entire)
under EVO-50. Current Linear, PR review and verification requirements remain in
force until their replacements are verified and the policy cutover lands.
