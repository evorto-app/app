# AI tooling map

- Start with the root `AGENTS.md` and the nearest module `AGENTS.md`. Keep shared
  verification and workflow rules at the root, and module-specific rules nearby.
- Keep reusable skills in `.agents/skills`. Keep component implementation
  guidance in the component README; a discovery skill should point there rather
  than repeat it. Project design adaptations belong in `project-design`.
- Update third-party skills together with `skills-lock.json`. Preserve upstream
  skill contents and keep project-specific overrides separate.

## Tool-specific files

These files serve different integrations and are not duplicate instruction
manuals:

- `.codex/config.toml`: Codex MCP servers and feature settings.
- `.codex/environments/environment.toml`: Codex worktree setup.
- `.codex/hooks.json`, `.gemini/settings.json`, and `.github/hooks/entire.json`:
  Entire lifecycle hooks using each tool's own event names and schema.
- `.entire/settings.json`: shared Entire enablement and telemetry settings.
- `.github/workflows/copilot-code-review.yml`: source-only review setup without
  private-package or runtime credentials.
- `.github/workflows/copilot-setup-steps.yml`: cloud-agent dependencies and browser
  setup. It intentionally has different requirements from code review.
- `.air/settings.json`: Air's editor formatting and lint integration.

Keep tool-specific settings in their native files. Do not copy shared guidance
into per-tool manuals. Copilot IDE migration markers are per-user state and
must remain ignored by `.idea/.gitignore`.
