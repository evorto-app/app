# Events Module Guidelines

- Keep event dates in the tenant IANA timezone. Hide its label only after the browser confirms the same canonical zone; retain it for SSR, disabled JavaScript, or unknown device zones. Never compare current UTC offsets to decide whether zones match.

- Public event details contain the schedule and public description, never meeting points or online joining details. These belong beside a confirmed ticket and must be withheld in public and unconfirmed-registration RPC responses. Keep exact meeting information out of public seed descriptions as well.

- Keep event and registration form flows Signal Forms-first.
- Normalize optional API-bound strings (for example optional descriptions/tax ids) to `null` at submit boundaries.
- Preserve typed mapping between form models, RPC contracts, and UI display models.
- Keep registration lifecycle calls aligned with typed `AppRpc.injectClient()` helpers.
