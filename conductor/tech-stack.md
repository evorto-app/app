# Tech Stack

## Runtime & Platform

- Runtime: Bun (primary for server/SSR/tooling).
- Web platform: Angular SSR (stay current with latest Angular).

## Frontend

- Framework: Angular (standalone components, signals).
- UI: Angular Material + Tailwind.
- Data/state: TanStack Query on the client for server state.
- Accessibility/UI guidance: Material Design.
- Adopt new Angular practices early (including experimental signal forms).

## Backend

- Server: SSR/server adapted to Bun runtime.
- API layer: RPC-based; currently tRPC, evolving toward Effect-based RPC.

## State & Effects

- Core: Effect for correctness/composability, especially server-side.

## Data Layer

- Database: Neon Serverless Postgres.
- ORM: Drizzle ORM.
- Migrations: Drizzle Kit (existing tooling).

## Testing

- E2E + doc tests: Playwright.
- Unit tests: minimized unless necessary.

## Tooling & Package Manager

- Package manager: Bun.
- Linting/format: ESLint + Prettier (existing tooling).
