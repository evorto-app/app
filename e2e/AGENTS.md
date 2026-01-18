# Playwright Agent Handbook

The discount-suite refactor highlighted a few non-negotiables for writing Playwright specs in this repo:

## Testing strategy

- **Documentation journeys** (`e2e/tests/docs/**`, `*.doc.ts`) are the living product guides; keep them concise, visual, and aligned to user stories.
- **Requirement/regression specs** (`e2e/tests/specs/**`) validate outcomes a user can observe. "Contract" specs should still assert user-visible behavior; avoid API-only checks in E2E.
- **User-first execution**: data setup belongs in fixtures and seeded storage states. Once the scenario starts, interact only through the UI.
- **Keep coverage explicit**: add new scenarios to `e2e/tests/test-inventory.md` and tag them by feature (`@finance`, `@templates`, etc.) to track requirements.

## Test layout

- Documentation journeys live under `e2e/tests/docs/<domain>/*.doc.ts`; pick the domain that matches the user-facing area (events, finance, profile, etc.).
- Regression and contract coverage sits in `e2e/tests/specs/<domain>/**/*.test.ts` (or `.spec.ts` for contract suites). Keep slow contract checks grouped under `specs/contracts/*`.
- Infrastructure verifications (reporters, screenshot helpers, seed invariants) belong in `e2e/tests/specs/tooling` or `e2e/tests/specs/seed` so they do not pollute domain folders.
- Name files and `test()` titles as user outcomes (“creates template in empty category”) so generated docs, dashboards, and slugs stay legible.
- Avoid adding new top-level folders unless the product area is genuinely new—extend existing domains wherever possible.
- Authentication lives in setup storage states. Prefer `test.use({ storageState: path })` (or project-level `storageState`) over bespoke helpers, and only create a secondary context when the scenario truly needs simultaneous roles.
- Tenant context cookies come from shared fixtures—don’t reimplement cookie injection unless a test purposely overrides it.
- If a scenario truly needs its own session, reuse the helpers in `e2e/utils/auth-context.ts` rather than hand-rolling `browser.newContext` logic.

### Authoring workflow

1. **Pick the folder first.** Docs → `docs/<domain>/journey.doc.ts`; regression/contract → `specs/<domain>/scenario.test.ts` (or `.spec.ts` for contracts); infrastructure → `specs/tooling/*`.
2. **Use shared fixtures.** Always import `test`/`expect` from `e2e/fixtures/*` (parallel/base/permissions) so seeded data, auth, and helpers stay consistent.
3. **Write outcomes, not steps.** Keep titles and assertions anchored on observable user value. Prefer web-first expectations and resilient locators.
4. **Documentation tests stay lean.** Pair each important step with `takeScreenshot()` + concise markdown; declare permissions in the opening callout so the reporter can surface them automatically.
5. **Keep specs isolated.** Seed or clean up via fixtures; don’t reach into the database directly from the test body; ensure navigation happens via the UI.
6. **Update coverage mapping.** Add the new test to `e2e/tests/test-inventory.md` with a short user-story description.
7. **Run locally before landing.** Execute the targeted Playwright command and eyeball `test-results` (for docs) to confirm attachments look right.

### Running suites

- `yarn e2e` — full regression run across `specs/**` (uses `ng e2e` so the dev server is managed automatically).
- `yarn e2e --project=local-chrome` — run a single Playwright project (matches CI usage).
- `yarn e2e --grep "@tag"` — run tagged scenarios (for example `@finance`).
- `yarn e2e:ui` — interactive UI mode for debugging (also uses `ng e2e`).
- `yarn e2e:docs` — generate documentation output from every `*.doc.ts` under `docs/**`.

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
- **Skip ESN validation flows.** Lower environments do not expose reliable ESN test numbers. Any scenario that depends on validating a specific ESN identifier must be marked `test.skip(...)`/`test.fixme(...)` until stable fixtures exist.

## Test Accounts

All storage states live under `e2e/.auth/**`; reuse these logins instead of creating new users:

- `testuser1@evorto.app` / `testpassword1!` — full access seed (`default.json`), covers organizer + member flows.
- `admin@evorto.app` / `adminpassword1!` — tenant admin (`admin-user.json`) for settings management.
- `global-admin@evorto.app` / `gapassword1!` — global admin (`global-admin-user.json`) when platform permissions are required.
- `user@evorto.app` / `userpassword1!` — standard member (`regular-user.json`) for participant journeys.
- `organizer@evorto.app` / `organizerpassword1!` — organizer role (`organizer-user.json`) for event setup.
- `testuser2@evorto.app` / `testpassword2!` — lightweight member (`empty-user.json`) useful for clean-state assertions or alternative ownership checks.

The tests run `e2e/setup/authentication.setup.ts` to set up the test accounts.

Follow these principles to keep the suite stable, deterministic, and aligned with how people actually use Evorto.

## Documentation Tests

Documentation scenarios double as living docs; author them so the custom reporter in `e2e/reporters/documentation-reporter.ts` can turn the run into publishable markdown artifacts.

- **Organize by test title.** The reporter slugifies the `test.title` into the output folder and page front matter (`test-results/docs/<slug>/page.md`). Keep titles short, descriptive, and free of punctuation that would be awkward in URLs.
- **Use the provided helpers.** Call `await takeScreenshot(testInfo, locator, page, caption?)` to highlight UI focus points and emit the `image`/`image-caption` attachments the reporter expects. When highlighting multiple elements, pass an array of locators so they stay visible in the capture.
- **Stream content with markdown attachments.** Add narrative context in the order it should appear: `await testInfo.attach('markdown', { body })`. Optional YAML front matter at the top of the attachment is stripped from the body, and list items inside it populate the “User permissions” callout automatically.
- **Declare permissions explicitly.** If the scenario depends on specific roles, either include them as list items in the markdown front matter or attach a separate `permissions` blob with one role per line. The reporter merges both sources into the callout.
- **Anchor each step to evidence.** Pair important navigation or state changes with a concise screenshot or short markdown block so the generated docs stay focused—skip redundant captures that don't add context.
- **Verify assets locally.** After adding or updating documentation tests, run `yarn e2e:docs` (or the targeted suite) and inspect `test-results/docs/**` to confirm images render, captions align with the correct screenshots, and no stale folders linger.
