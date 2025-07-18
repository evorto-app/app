# Evorto

An Angular 20 application for event management and registration with comprehensive testing infrastructure.

## Quick Start

### Prerequisites
- Node.js 18+ and Yarn 4+
- Git
- A modern web browser

### Setup
1. Clone the repository
2. Install dependencies: `yarn install`
3. Set up environment variables (see [Environment Configuration](#environment-configuration))
4. Start development server: `yarn start`

## Environment Configuration

Create a `.env` file in the project root with the following variables:

```env
# Required for basic functionality
SECRET=your-secret-key
DATABASE_URL=sqlite:///tmp/test.db
BASE_URL=http://localhost:4200
PORT=4200

# Auth0 Configuration (required for authentication)
CLIENT_ID=your-auth0-client-id
CLIENT_SECRET=your-auth0-client-secret
ISSUER_BASE_URL=https://your-domain.auth0.com
AUDIENCE=your-auth0-audience

# Optional settings
CONSOLA_LEVEL=1000
PLAYWRIGHT_TEST_BASE_URL=http://localhost:4200
```

For testing purposes, you can use the provided `.env.local` as a template.

## Development Commands

### Building and Running
```bash
# Start development server
yarn start

# Build for production
yarn build

# Build and watch for changes
yarn watch
```

### Testing
```bash
# Run unit tests (currently 0 tests)
yarn test --no-watch --browsers=ChromeHeadless

# Run all e2e tests
yarn e2e --reporter=line --project=chromium

# Run specific test file
npx playwright test e2e/tests/smoke/load-application.test.ts --project=chromium --reporter=line

# Run documentation tests
yarn e2e:docs --reporter=line

# Run tests in UI mode (for debugging)
yarn e2e:ui --workers=2
```

### Code Quality
```bash
# Check code style
yarn lint

# Auto-fix linting issues
yarn lint:fix

# Format code
yarn format
```

### Database
```bash
# Push database schema
yarn push:database

# Setup database with initial data
yarn setup:database

# Reset database (push + setup)
yarn reset:database
```

## Project Structure

```
├── src/
│   ├── app/              # Angular application code
│   ├── db/               # Database schema and setup
│   ├── server/           # Server-side code (tRPC routes)
│   └── assets/           # Static assets
├── e2e/                  # End-to-end tests
│   ├── tests/            # Test files (.test.ts, .doc.ts)
│   ├── fixtures/         # Test fixtures and utilities
│   ├── setup/            # Test setup (auth, database)
│   └── reporters/        # Custom test reporters
├── helpers/              # Utility scripts
├── public/               # Public assets
└── migration/            # Database migrations
```

## Testing Architecture

### Unit Tests (Angular/Karma)
- Framework: Karma + Jasmine
- Configuration: `angular.json`, `karma.conf.js`
- Currently configured but no tests written
- Run: `yarn test --no-watch --browsers=ChromeHeadless`

### E2E Tests (Playwright)
- Framework: Playwright with custom fixtures
- Configuration: `playwright.config.ts`
- Test types:
  - `.test.ts` - Functional tests
  - `.doc.ts` - Documentation tests with screenshots
- Run: `yarn e2e --reporter=line --project=chromium`

### Test Projects
- `chromium` - Main browser testing
- `firefox` - Firefox compatibility
- `webkit` - Safari compatibility
- `docs` - Documentation generation
- `setup` - Database and authentication setup

## Key Features

- **Event Management**: Create, edit, and manage events
- **Template System**: Reusable event templates and categories
- **User Authentication**: Auth0 integration with role-based access
- **Payment Processing**: Stripe integration for event payments
- **QR Code Scanning**: Event check-in functionality
- **Documentation**: Auto-generated docs from tests

## Known Issues

1. **Build Errors**: TypeScript errors in authentication-related components
2. **Test Coverage**: Unit tests are configured but not implemented
3. **Lint Issues**: 65 lint errors need to be addressed
4. **Docker Setup**: Requires FontAwesome token for full Docker build

## Contributing

1. **Before Changes**: 
   - Fix build errors: `yarn build`
   - Check lint issues: `yarn lint`
   - Ensure tests pass: `yarn e2e --reporter=line --project=chromium`

2. **Development**:
   - Follow Angular style guide
   - Use standalone components with `ChangeDetectionStrategy.OnPush`
   - Use `inject()` function for dependencies
   - Write tests for new features

3. **Testing**:
   - Add unit tests for new components/services
   - Update or create `.doc.ts` files for user-facing features
   - Use `--reporter=line` flag to avoid UI interference

## Architecture Notes

- **Frontend**: Angular 20 with standalone components
- **Backend**: tRPC with Express.js
- **Database**: Drizzle ORM with SQLite/PostgreSQL
- **Authentication**: Auth0 with OpenID Connect
- **Styling**: Tailwind CSS with Material Design tokens
- **Testing**: Playwright for E2E, Karma/Jasmine for unit tests

## Additional Resources

- [Angular CLI Overview](https://angular.dev/tools/cli)
- [Playwright Documentation](https://playwright.dev/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [Project Guidelines](./.junie/guidelines.md)
