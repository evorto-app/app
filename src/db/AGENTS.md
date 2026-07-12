# Database Guidelines

- Drizzle schema is the source of truth for persisted shapes.
- For Drizzle reference material, inspect the vendored upstream source under `repos/drizzle/drizzle-orm/**` first.
- For relation behavior, query builders, dialect details, and type inference, prefer upstream tests in `repos/drizzle/drizzle-orm/tests/**`, `repos/drizzle/drizzle-orm/type-tests/**`, and `repos/drizzle/integration-tests/**` over stale examples.
- Treat `repos/drizzle` as read-only reference material. Do not import from it; app code should keep importing from normal Drizzle packages.
- Prefer inferred Drizzle types across callers; avoid duplicate handwritten DB model types.
- Keep migrations explicit and committed when schema changes.
- Avoid `any`/unchecked casts in query helpers.
- Server-side Effect authorization is authoritative; no PostgreSQL RLS layer is
  planned.
- Composite tenant foreign keys, `NO ACTION` relationships, and database
  constraints are integrity safeguards, not authorization mechanisms.
- When changing schema or constraints, document required local reset/setup steps in track/handoff docs.
- After every DB file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited DB files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing a DB file, run WebStorm `get_file_problems` on that file when possible before finishing.

## Drizzle Relations v2 Schema Design Notes

- Define Drizzle relations for query ergonomics, but still define real database foreign keys and constraints in schema tables; relations alone do not create DB constraints.
- For many-to-many, model an explicit junction table and prefer a composite primary key on the pair of foreign keys.
- If using `through(...)` for relation traversal, index each foreign key column and add a composite index on the pair to support both directions and relation resolution efficiently.
- Use relation `alias` when two tables connect in multiple ways (for example `author` and `reviewer`) to avoid ambiguity.
- Only mark a relation as non-optional when the linked row is guaranteed to exist; keep nullable/optional relation types accurate.
- If relation definitions are split with `defineRelationsPart`, merge parts without overwriting table entries and keep one base part that includes all tables for complete type inference.
- Predefined relation `where` filters operate on the target (`to`) table; design polymorphic relation filters with that scope in mind.
