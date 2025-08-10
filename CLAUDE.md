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

### Responsive Layout
- **Desktop**: Two-column layout with event list always visible in sidebar
- **Mobile**: Single-column layout with event list hidden when viewing event details/organize pages
- Layout automatically adapts based on screen size using responsive design patterns

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

## Neon Database Integration Guidelines

### Dependencies
For Neon with Drizzle ORM integration:
```bash
npm install drizzle-orm @neondatabase/serverless dotenv
npm install -D drizzle-kit
```

### Connection Configuration
- Use Neon connection string format: `postgres://username:password@ep-instance-id.region.aws.neon.tech/neondb`
- Store in `.env` or `.env.local` file as `DATABASE_URL`

### Connection Setup
```typescript
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle({ client: sql });
```

### Key Considerations
- Use `neon-http` adapter for serverless optimization
- Leverage Neon's auto-scaling and connection pooling
- Support for Postgres features: JSON/JSONB, arrays, enums, full-text search
- Use prepared statements for repeated queries
- Batch operations when possible for efficiency

## Angular Development Rules (Critical)

### Component Architecture
- **ALL COMPONENTS MUST BE STANDALONE**: Never explicitly set `standalone: true` (implied by default)
- **MUST USE OnPush**: Always set `changeDetection: ChangeDetectionStrategy.OnPush`
- **Modern Control Flow**: Use `@if`, `@for`, `@switch` instead of structural directives
- **Signal-based I/O**: Use `input()` and `output()` functions, not decorators

### Forbidden Patterns
- ❌ `NgModules` (`@NgModule`)
- ❌ `*ngIf`, `*ngFor`, `*ngSwitch` (use `@if`, `@for`, `@switch`)
- ❌ `NgClass`, `NgStyle` (use `[class]`, `[style]` bindings)
- ❌ `@Input()`, `@Output()` decorators (use `input()`, `output()` functions)
- ❌ Constructor injection (use `inject()` function)

### Required Patterns
```typescript
// Component structure
@Component({
  selector: 'app-example',
  imports: [CommonModule],
  template: `
    @if (isVisible()) {
      <div [class.active]="isActive()">Content</div>
    }
    @for (item of items(); track item.id) {
      <span>{{ item.name }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExampleComponent {
  // Signals for state
  private myService = inject(MyService);
  protected isVisible = signal(false);
  protected items = signal<Item[]>([]);
  
  // Signal inputs/outputs
  public title = input.required<string>();
  public search = output<string>();
  
  // Computed values
  protected isActive = computed(() => this.items().length > 0);
}
```

### Error Detection Process
1. After every modification, run `ng build`
2. Monitor IDE diagnostics
3. Check dev server output
4. Automatically fix common Angular errors
5. Report unresolvable errors with specific location and suggested fixes

## Project Architecture Decisions

### Code Organization
- **No Barrel Files**: Do not create index.ts barrel export files for now
- **Direct Imports**: Use direct imports from specific files rather than barrel exports
- **Path Mapping**: Use TypeScript path mapping for cleaner imports when needed

### TypeScript Path Mappings
Use these path aliases to avoid deep relative imports:
- `@app/*` → `src/app/*` (Angular client code)
- `@server/*` → `src/server/*` (Server-side code)
- `@db/*` → `src/db/*` (Database layer)
- `@shared/*` → `src/shared/*` (Shared utilities and types)
- `@types/*` → `src/types/*` (Type definitions)
- `@helpers/*` → `helpers/*` (Helper scripts)

### Code Boundary Enforcement
ESLint rules prevent inappropriate cross-boundary imports:
- **Production code** (`src/**`) cannot import helpers (development/testing only)
- **Client code** (`src/app/**`) cannot import server modules or server-only dependencies
- **Server code** (`src/server/**`) cannot import Angular framework or client modules
- **Database layer** (`src/db/**`) must remain framework-agnostic
- **Shared code** (`src/shared/**`) can be imported from both client and server
- **Helpers** (`helpers/**`) are restricted to development and testing scripts only