# Finance Module Guidelines

- Keep money values consistent and explicit in smallest currency units where required.
- Preserve typed mapping across receipt/transaction RPC contracts and UI view models.
- Keep approval/review/refund flows aligned with current Effect RPC handlers.
- Do not introduce ad-hoc runtime/storage clients; use existing server integration paths.
- After every finance file edit, run `bun run lint` and `bun run format:write`.
- Before calling WebStorm `get_file_problems` on edited finance files, run `bun run lint` first.
- Markdown files do not need a WebStorm `get_file_problems` pass.
- After editing a finance module file, run WebStorm `get_file_problems` on that file when possible before finishing.
