# Templates Module Guidelines

- Keep template form workflows Signal Forms-first and strongly typed.
- Maintain clear mapping from template models to event-creation payloads.
- Normalize optional payload fields to `null` when contracts require nullable values.
- Reuse shared template form utilities instead of duplicating mapping logic.
