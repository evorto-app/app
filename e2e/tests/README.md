# Documentation Tests

This directory contains Playwright tests that are used to automatically generate markdown documentation for the application. These tests navigate through the application, take screenshots, and provide explanatory text that is compiled into comprehensive documentation.

## How Documentation Tests Work

1. Tests with the `.doc.ts` extension are run using the `e2e:docs` script
2. These tests use the `takeScreenshot` function and `testInfo.attach('markdown', ...)` to capture visual and textual content
3. The `documentation-reporter.ts` processes these attachments and generates markdown files
4. The markdown files are used to build the documentation website

## Existing Documentation Tests

The application has the following documentation tests:

### User Management
- `users/create-account.doc.ts`: Creating a new user account
- `roles/roles.doc.ts`: Managing user roles and permissions

### Events
- `events/register.doc.ts`: Registering for events (free and paid)
- `events/event-management.doc.ts`: Creating and managing events

### Templates
- `templates/templates.doc.ts`: Working with event templates
- `template-categories/categories.doc.ts`: Managing template categories

### Finance
- `finance/finance-overview.doc.ts`: Managing financial transactions

### Profile
- `profile/user-profile.doc.ts`: Managing user profiles

### Scanning
- `scanning/scanner.doc.ts`: Using the QR code scanner for event check-ins

## Running Documentation Tests

To run all documentation tests:

```bash
yarn e2e:docs
```

To run a specific documentation test:

```bash
npx playwright test e2e/tests/path/to/test.doc.ts --project=docs
```

## Creating New Documentation Tests

When creating new documentation tests:

1. Create a new file with the `.doc.ts` extension in the appropriate subdirectory
2. Use the existing tests as templates for structure
3. Include appropriate permissions in a callout at the beginning
4. Structure the test to follow a logical user journey
5. Use `testInfo.attach('markdown', ...)` to add explanatory text
6. Use `takeScreenshot()` to capture important UI elements
7. Make sure to cover all important aspects of the feature

## Best Practices

- Keep markdown content clear and concise
- Use proper Markdown formatting (headings, lists, code blocks, etc.)
- Take screenshots of specific UI elements rather than the entire page when possible
- Include callouts for important information or prerequisites
- Structure the documentation to follow a logical flow from basic to advanced usage
- Test the documentation by running the tests and reviewing the generated markdown
