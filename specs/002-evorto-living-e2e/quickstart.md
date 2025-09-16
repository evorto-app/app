# Quickstart: Evorto Living E2E Baseline

Purpose: Run deterministic E2E baseline (functional + living documentation) producing narrative markdown + screenshots.

## Prerequisites
- Environment: PLAYWRIGHT_TEST_BASE_URL, DATABASE_URL
- Optional (for first-time account doc): AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_DOMAIN

## 1. Install & Start Services
```bash
yarn install
yarn docker:start-test
```

## 2. Run Baseline Functional Tests
```bash
yarn e2e
# If you need to inspect failures interactively, prefer the default configured reporters
# (do NOT override with --reporter). Then open the report:
# yarn e2e:report
```
Outputs: Playwright report + ensures seed & isolation logic works.

## 3. Run Living Documentation Journeys
```bash
yarn e2e:docs
```
Environment overrides (optional):
```bash
DOCS_OUT_DIR=./artifacts/docs DOCS_IMG_OUT_DIR=./artifacts/docs/images yarn e2e:docs
```

## 4. Artifacts
- HTML Report: `playwright-report/`
- View HTML Report: `yarn e2e:report`
- Docs Markdown: `test-results/docs` (or DOCS_OUT_DIR)
- Journey Images: `test-results/docs/images` (or DOCS_IMG_OUT_DIR)

## 5. Skips & Tags
- Paid registration & finance flows: tagged @finance (excluded)
- First-time account doc: @needs-auth0 (auto-skip if env missing)

## 6. Adding a New Journey
1. Add `.doc.ts` file → uses documentation reporter.
2. Tag permissions in test description block.
3. Capture minimal screenshots at state boundaries.
4. Re-run docs command.

## 7. Deterministic Seeding
Seed helper ensures per-run tenant and baseline entities. To reset: delete generated tenant via helper or re-run entire test command (new tenant auto-created).

## 8. Troubleshooting
| Issue | Fix |
|-------|-----|
| Missing docs output | Ensure reporter env vars or defaults logging at run start |
| Flaky time window | Verify relative offset logic (>=2h future) |
| Auth journey skipped unexpectedly | Check required Auth0 env vars present |
| Permission test failing | Validate override helper executed before page navigation |

## 9. Next Steps
- Implement reporter env variable support if not already.
- Add permission override helper fixture.
- Add deterministic naming map logging to console for debugging.
