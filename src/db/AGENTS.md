# Database Guidelines

- Drizzle schema is the source of truth for persisted shapes.
- Prefer inferred Drizzle types across callers; avoid duplicate handwritten DB model types.
- Keep migrations explicit and committed when schema changes.
- Avoid `any`/unchecked casts in query helpers.
- When changing schema or constraints, document required local reset/setup steps in track/handoff docs.
