# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `yarn start` - Start development server on http://localhost:4200
- `yarn build` - Build for production
- `yarn test` - Run unit tests with Karma
- `yarn lint` - Check code style with ESLint
- `yarn lint:fix` - Fix linting issues automatically
- `yarn format` - Format code with Prettier

### Database Operations
- `yarn push:database` - Push schema changes to database
- `yarn setup:database` - Initialize database with seed data
- `yarn reset:database` - Reset and reinitialize database

### Testing
- `yarn e2e` - Run all Playwright e2e tests
- `yarn e2e:ui` - Run e2e tests with UI (2 workers)
- `yarn e2e:browser` - Run e2e tests in headed mode
- `yarn e2e:docs` - Run documentation tests only
- `npx playwright test e2e/tests/path/to/test.ts` - Run specific test file
- Use `--reporter=line` to avoid report viewer launching
- Use `--project=chromium` to prevent duplicate runs

### Docker Environment
- `yarn docker:start` - Start development environment with Docker
- `yarn docker:start-test` - Start test environment
- `yarn docker:stop` - Stop Docker containers

## Architecture Overview

### Tech Stack
- **Frontend**: Angular 20 with standalone components and signals
- **Backend**: tRPC server with Express
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Auth0
- **Payments**: Stripe
- **Styling**: Tailwind CSS + Angular Material
- **Testing**: Playwright for e2e, Karma for unit tests

### Project Structure
- `src/app/` - Main Angular application with feature modules
- `src/server/` - tRPC backend server and API routes
- `src/db/` - Database schema, queries, and Drizzle configuration
- `src/shared/` - Shared types and utilities
- `e2e/` - Playwright tests including documentation tests (`.doc.ts`)
- `helpers/` - Database setup and utility scripts

### Key Architectural Patterns

#### Frontend Architecture
- **Standalone Components**: All components use `standalone: true`
- **OnPush Change Detection**: Default strategy for performance
- **Dependency Injection**: Use `inject()` function instead of constructor injection
- **Control Flow**: New Angular syntax (`@if`, `@for`, `@switch`)
- **State Management**: Angular Signals for local state, TanStack Query for server state

#### Backend Architecture
- **tRPC**: Type-safe API with router-based organization
- **Context Middleware**: Authentication, tenant, and user context
- **Database**: Drizzle ORM with prepared statements
- **Multi-tenancy**: Tenant-scoped data access

#### Database Schema
- Base models use `modelBasics` (id, createdAt, updatedAt)
- Tenant-scoped models use `modelOfTenant`
- Custom ID generation with CUID2

### Component Conventions
- Selector prefix: `app-`
- Use `NgOptimizedImage` for static images
- Material Design principles with custom tokens in `src/styles.scss`
- Reactive forms with proper validation

### Testing Conventions
- Documentation tests (`.doc.ts`) generate project documentation
- Use `takeScreenshot()` for visual documentation
- Test files follow feature structure in `e2e/tests/`
- Setup files handle authentication and database initialization

### Important Files
- `src/app/app.config.ts` - Application configuration and providers
- `src/server/trpc/app-router.ts` - Main tRPC router
- `src/db/schema/model.ts` - Base database model patterns
- `eslint.config.mjs` - ESLint configuration with strict rules
- `playwright.config.ts` - Test configuration with multiple browsers

### Code Style
- ESLint with strict TypeScript, Angular, and Unicorn rules
- Prettier for formatting
- No comments unless explicitly needed
- Follow existing component and service patterns