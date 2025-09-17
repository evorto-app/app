# Playwright Agent Handbook

The discount-suite refactor highlighted a few non-negotiables for writing Playwright specs in this repo:

- **Use Yarn v4 tooling only.** All scripts assume the Yarn 4 (Berry) runtime—do not run `npm`, `pnpm`, or global Playwright commands. Always invoke scripts through `yarn <script>` so the repo-managed binaries and constraints apply.
- **Stay user-facing end to end.** Configure the application by exercising the same flows real users do. Skip direct database access, ad-hoc TRPC fetches, or manually crafted HTTP calls—if data is required, create it through the UI or dedicated fixtures that reuse seeded storage states.
- **Navigate via the UI.** Move between screens using the navigation controls the product exposes (drawer links, buttons, etc.). `page.goto` is reserved for the very first entry point inside helpers/fixtures.
- **Stick with the shared fixtures.** Import `test`/`expect` from `e2e/fixtures/parallel-test` and add new fixtures when repeated setup becomes noisy. When you need an authenticated session, prefer `browser.newContext({ storageState })` to re-login flows.
- **Prefer resilient locators.** Use Playwright’s locator APIs with user-facing semantics—`getByRole`, `getByLabel`, `getByText`, or agreed `data-testid`s. Chain or filter locators instead of relying on brittle CSS/XPath selectors.
- **Use web-first assertions.** Keep expectations as `await expect(locator)…` so we get built-in waiting (`toBeVisible`, `toContainText`, etc.) without manual polling or `waitForTimeout`.
- **Keep tests isolated.** Every spec sets up and tears down its own state (remove created entities on exit) so scenarios can run in any order without cross-talk.
- **Document while you go.** Pair user journeys with `takeScreenshot`/markdown attachments to keep the documentation reporter accurate.
- **Fixture-only database access.** Seed data and mutations belong in fixtures. Test bodies must rely on user-visible behavior—no direct DB/TRPC calls once the scenario starts.
- **Doc titles stay simple.** Documentation tests are rendered into folder names—use concise, human-friendly titles without punctuation that would create awkward paths.
- **Rely on Playwright guarantees.** Pointer helpers already handle waiting, scrolling, and retry logic—write straight assertions without defensive fallbacks so genuine regressions break loudly.
- **Leverage MCP exploration.** Use the Playwright MCP browser tools to inspect current UI flows before writing locators—record actual buttons, headings, and navigation so specs mirror the live app instead of code assumptions.

## Test Accounts

All storage states live under `e2e/.auth/**`; reuse these logins instead of creating new users:

- `testuser1@evorto.app` / `testpassword1!` — full access seed (`default.json`), covers organizer + member flows.
- `admin@evorto.app` / `adminpassword1!` — tenant admin (`admin-user.json`) for settings management.
- `global-admin@evorto.app` / `gapassword1!` — global admin (`global-admin-user.json`) when platform permissions are required.
- `user@evorto.app` / `userpassword1!` — standard member (`regular-user.json`) for participant journeys.
- `organizer@evorto.app` / `organizerpassword1!` — organizer role (`organizer-user.json`) for event setup.
- `testuser2@evorto.app` / `testpassword2!` — lightweight member (`empty-user.json`) useful for clean-state assertions.

The tests run `e2e/setup/authentication.setup.ts` to set up the test accounts.

Follow these principles to keep the suite stable, deterministic, and aligned with how people actually use Evorto.
