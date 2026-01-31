# Database Seeding

This directory contains scripts for setting up and seeding the database with test data.

## Overview

The database seeding process is designed to create a deterministic set of data that makes the application look like it's in a plausible state of being used. This is important for:

- Development testing
- UI/UX evaluation
- Documentation generation
- End-to-end testing

## Key Files

- `database.ts`: Main entry point for database setup and seeding
- `seed-tenant.ts`: Shared tenant seeding logic used by tests, development, and demos
- `add-events.ts`: Creates events with deterministic dates, statuses, and visibilities
- `add-roles.ts`: Sets up user roles and permissions
- `add-templates.ts`: Creates event templates
- `add-template-categories.ts`: Sets up template categories
- `user-data.ts`: Defines test users

## Seeding Approach

The seeding approach has been designed to be deterministic while still creating realistic data:

1. **Daily Seed**: We seed `@ngneat/falso` with the current day (YYYY-MM-DD) so data stays deterministic for a given day while still refreshing over time.
2. **Seed Clock (UTC)**: Time-based fixtures use the start of the current day in UTC to keep dates stable within the day.

3. **Deterministic Events**:
   - Fixed number of events per template type (3 events × 6 template types = ~18 total events)
   - Events are created relative to the current date:
     - Past events (30+ days ago)
     - Current/upcoming events (7+ days in the future)
     - Future events (30+ days in the future)
   - Deterministic assignment of status, visibility, and creator

4. **Realistic Data Structure**:
   - Events have appropriate registration options
   - Users have appropriate roles and permissions
   - Templates and categories are properly linked

## Running the Seeding Process

To reset and seed the database:

```bash
yarn reset:database
```

This will:

1. Push the latest schema to the database (`yarn push:database`)
2. Run the seeding script (`yarn setup:database`)

## Modifying the Seeding Process

If you need to modify the seeding process:

1. Make changes to the appropriate file(s) in the `helpers` directory
2. Test your changes by running `yarn reset:database`
3. Verify that the application displays the expected data

Remember that the goal is to maintain deterministic seeding while creating realistic data.
