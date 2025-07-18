Look at [guidelines.md](../.junie/guidelines.md) for instructions on how to behave in this project.

## Testing Instructions

When running tests, use these specific commands to ensure proper execution:

### E2E Tests (Playwright)
- Add `--reporter=line` to avoid the report viewer launching
- Use `--project=chromium` to prevent duplicate runs across browsers
- Use `--project=docs` if running documentation tests specifically
- Example: `yarn e2e --reporter=line --project=chromium`

### Unit Tests (Angular/Karma)  
- Use `--no-watch --browsers=ChromeHeadless` for CI-style execution
- Example: `yarn test --no-watch --browsers=ChromeHeadless`

### Environment Setup
- Ensure `.env` file exists with required variables (DATABASE_URL, CLIENT_SECRET, etc.)
- Use `sqlite:///tmp/test.db` for local database testing
- Set `CONSOLA_LEVEL=1000` for minimal logging during tests

### Before Testing
- Fix build errors first: `yarn build`
- Check lint issues: `yarn lint`
- Ensure proper environment configuration

### Known Issues
- Build currently fails due to Auth0 query typing issues
- 65 lint errors need to be addressed
- Docker setup requires FontAwesome token - use local development instead
