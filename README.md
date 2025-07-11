# Evorto

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.0.6.

## Local Development with Local Database

For local development, you can use a local PostgreSQL database instead of connecting to a remote Neon database. This provides faster development, offline capability, and isolated testing.

### Quick Start with Local Database

```bash
# Start local database and development server
yarn dev:local
```

This command will:
1. Start a local PostgreSQL container
2. Set up the database schema
3. Seed the database with test data
4. Start the Angular development server

### Manual Setup

```bash
# Start local database
yarn db:local:up

# Set up schema and seed data
yarn db:local:reset

# Start development server
yarn start
```

### Database Management

```bash
# Database management commands
yarn db:local:up        # Start local database
yarn db:local:down      # Stop local database
yarn db:local:reset     # Reset database (schema + seed data)
yarn db:local:push      # Push schema changes only
yarn db:local:setup     # Seed database with test data

# Using the management script
./scripts/local-db.sh help     # Show all available commands
./scripts/local-db.sh status   # Check database status
./scripts/local-db.sh connect  # Connect to database CLI
```

For detailed local database setup instructions, see [docs/local-database.md](docs/local-database.md).

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
