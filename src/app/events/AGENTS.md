# Events Module Guidelines

- Keep event and registration form flows Signal Forms-first.
- Normalize optional API-bound strings (for example optional descriptions/tax ids) to `null` at submit boundaries.
- Preserve typed mapping between form models, RPC contracts, and UI display models.
- Keep registration lifecycle calls aligned with typed `AppRpc.injectClient()` helpers.
- After every event file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited event files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing an events module file, run WebStorm `get_file_problems` on that file when possible before finishing.
