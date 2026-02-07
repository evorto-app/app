# Baseline Delta Notes

## Source References

- `repomix-output-angular-bun-setup-main.zip.xml`
- `repomix-output-effect-angular-main.zip.xml`

## Current Repo vs Bun Baseline

1. Package manager
   - Current: `packageManager: yarn@4.12.0`, `yarn.lock`, `.yarnrc.yml`.
   - Baseline: `packageManager: bun@...`, Bun lockfile, Bun-first scripts.

2. Angular scripts
   - Current scripts call `ng` directly and use `node` for SSR/helper commands.
   - Baseline scripts use `bunx --bun ng` and `bun --bun dist/.../server.mjs`.

3. CI workflows
   - Current workflows bootstrap Yarn with `corepack` and run `yarn ...`.
   - Bun migration target is Bun install + `bun run ...` workflows.

4. Runtime stack
   - Current server runtime is Express + tRPC (`src/server/app.ts`, `src/server/trpc/**`).
   - Track target keeps Bun cutover first, then phases toward Effect HTTP/RPC.

5. Effect Angular query integration reference
   - Reference repo demonstrates `@effect/rpc` + TanStack Angular query helpers.
   - This should guide the client contract migration after Bun cutover.
