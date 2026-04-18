# Templates Module Guidelines

- Keep template form workflows Signal Forms-first and strongly typed.
- Maintain clear mapping from template models to event-creation payloads.
- Normalize optional payload fields to `null` when contracts require nullable values.
- Reuse shared template form utilities instead of duplicating mapping logic.
- Before calling WebStorm `get_file_problems` on edited template files, run `bun run lint:fix` first.
- After editing a templates module file, run WebStorm `get_file_problems` on that file when possible before finishing.
