# Templates Module Guidelines

- Project Font Awesome icons into Material button icon slots with `matButtonIcon`. Extended FAB icons need an explicit 24px size and spacing; leaving them inside the label can stack the icon above the text.
- Keep template form workflows Signal Forms-first and strongly typed.
- Event creation starts with an editable copy of template add-ons and sign-up questions. Explicit empty selections omit them; never re-copy omitted items on the server or change the source template. Apply paid-item and tax checks to the selected event configuration.
- Maintain clear mapping from template models to event-creation payloads.
- Normalize optional payload fields to `null` when contracts require nullable values.
- Reuse shared template form utilities instead of duplicating mapping logic.
- After every template file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited template files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing a templates module file, run WebStorm `get_file_problems` on that file when possible before finishing.
