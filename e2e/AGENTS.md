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

Follow these principles to keep the suite stable, deterministic, and aligned with how people actually use Evorto.
