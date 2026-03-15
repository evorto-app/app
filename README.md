# Evorto

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) and is maintained on Angular 21 with Bun-first tooling.

## Git workflow

This repository uses Git Town to manage branching, syncing, and shipping. Prefer `git town` commands for daily workflow.

For large multi-phase changes, keep an assembly branch plus one child branch per reviewable phase. Create the next branch with `git town append`, keep the stack current with `git town sync --stack`, and open PRs with `git town propose`.

## Release documentation

We use Knope for release notes.

- Always add a change file in `.changeset/*.md` for release-relevant work.
- Do not rely on conventional commits or PR titles as release documentation.

## Development server

To start a local development server, run:

```bash
bun run dev:start
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
bun run dev:ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
bun run dev:ng generate --help
```

## Building

To build the project run:

```bash
bun run build:app
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
bun run test:unit
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
bun run test:e2e
```

To run documentation tests:

```bash
bun run test:e2e:docs
```

For deterministic test/runtime details, seed profiles, docker-backed local test setup, and the stacked delivery workflow used for infra/config changes, see [docs/testing.md](docs/testing.md).

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
