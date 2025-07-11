# Evorto Project Guidelines for Junie

## Important references

- [Angular instructions]('./angular.md')

## Project Overview

Evorto is an Angular 20 application for event management and registration. The application allows users to create, manage, and register for events, with features including:

- Event creation and management
- Event templates and categories
- User registration and authentication (via Auth0)
- Payment processing (via Stripe)
- QR code scanning for event check-ins
- Role-based access control
- Documentation generation from tests

## Project Structure

- `/src` - Main Angular application code
  - `/app` - Application components, services, and modules
  - `/assets` - Static assets like images and icons
- `/e2e` - End-to-end tests using Playwright
  - `/tests` - Test files, including documentation tests (`.doc.ts`)
  - `/fixtures` - Test fixtures and utilities
  - `/reporters` - Custom test reporters, including documentation generator
- `/helpers` - Utility scripts and helper functions
- `/public` - Public assets served by the application
- `/migration` - Database migration scripts
- `/.junie` - Junie AI assistant configuration

## Testing Guidelines

When implementing changes, Junie should:

1. **Run tests to verify changes**: Use `yarn e2e` to run end-to-end tests
2. **Create or update documentation tests**: For new features or significant changes, update or create `.doc.ts` files
3. **Test specific features**: Use `npx playwright test e2e/tests/path/to/test.ts` to test specific features
4. **Generate documentation**: Use `yarn e2e:docs` to generate documentation from tests

## Building the Project

Before submitting changes, Junie should:

1. **Build the project**: Use `yarn build` to ensure the project builds successfully
2. **Check for linting errors**: Use `yarn lint` to check for code style issues
3. **Format code**: Use `yarn format` to ensure consistent code formatting

## Code Style Guidelines

1. **Follow Angular style guide**: Adhere to the [Angular style guide](https://angular.dev/style-guide)
2. **Use TypeScript features**: Leverage TypeScript's type system for safer code
3. **Write comprehensive tests**: Ensure code changes are covered by tests
4. **Document public APIs**: Use JSDoc comments for public methods and classes
5. **Follow existing patterns**: Maintain consistency with the existing codebase

## Database Changes

If making database changes:

1. **Update schema**: Use Drizzle ORM for database schema changes
2. **Create migrations**: Use `yarn push:database` to create and apply migrations
3. **Test migrations**: Ensure migrations can be applied and rolled back correctly

## Database interactions

When interacting with the database, Junie should:

1. **Use Drizzle ORM**: Follow the existing patterns for database interactions https://orm.drizzle.team/llms-full.txt

## Design Guidelines

1. **Follow existing design patterns**: Use the existing components and styles as a reference
2. **Use Tailwind CSS**: Leverage Tailwind CSS for styling components
3. **Use material design**: Follow Material Design principles for UI components, use the tokens defined in `src/styles.scss` for consistent styling. Also use material design expressive https://m3.material.io/blog/building-with-m3-expressive#what-rsquo-s-in-the-update
4. **Use custom components**: Utilize the custom components defined in the project, such as `quick-links`, `callout`, and `figure`, for consistent UI elements

## Angular Component Generation

- Always generate standalone components (`standalone: true`).
- Default to `ChangeDetectionStrategy.OnPush`.
- Use the `inject` function for dependencies. Example: `const myService = inject(MyService);`
- Component templates should use the new built-in control flow syntax (`@if`, `@for`).
- Use `NgOptimizedImage` for all static images.
- Selector prefix should be `app-`.

## Angular Service Generation

- Services should be tree-shakable (`providedIn: 'root'`).
- Use the `inject` function for internal dependencies.

## State Management

- Prefer Angular Signals for reactive state within components.
- All other state should be covered by tanstack query.

## Documentation

For changes that affect user-facing features:

1. **Update documentation tests**: Modify or create `.doc.ts` files in the appropriate directory
2. **Include screenshots**: Use `takeScreenshot()` to capture UI elements
3. **Provide clear explanations**: Use markdown attachments to explain features
4. **Follow documentation structure**: Use proper headings, lists, and callouts

## Submitting Changes

Before submitting changes, Junie should:

1. **Verify all tests pass**: Run `yarn test` and `yarn e2e` to ensure all tests pass
2. **Build the project**: Run `yarn build` to ensure the project builds successfully
3. **Check for linting errors**: Run `yarn lint` to check for code style issues
4. **Summarize changes**: Provide a clear summary of the changes made
