# Config Guidelines

## Effect Config Shape

- Prefer native Effect `Config.*` combinators in module declarations.
- `ConfigProvider.fromEnv` does not trim values. If surrounding whitespace is invalid for a config field, trim explicitly in the config declaration.
- Use `Config.withDefault(...)` when a missing value has a sensible fallback.
- Use `Config.option(...)` when absence is semantically meaningful, then resolve that optionality at the config-module or service boundary.
- If blank strings should behave like "not configured", handle that conversion inside the config module instead of hiding it behind a broad helper layer.
- Do not add generic wrapper helpers for Effect primitives like booleans, ports, or defaults.
- Prefer structural helper names like `trimmedString(...)` over domain-specific helper names like `optionalAuthStringConfig(...)` unless the helper encodes domain rules.

## Helpers Policy

- Shared config utilities should encode a deliberate repo-wide policy only.
- In this directory, shared string utilities should stay structural: trimming, optional parsing, and non-empty validation.
- If a helper hides core Effect config semantics, keep it local to the module or remove it.
- Do not collapse `Option` to `undefined` in a shared helper. If a caller needs `undefined`, convert it at the boundary where the value is consumed.

## Service Boundary

- Shared runtime config should be exposed through `RuntimeConfig` or module-level config loaders, not redefined ad hoc in downstream services.
- Inline `yield* Config.*` reads are acceptable for small local utilities, but application runtime config should remain centralized.
- Resolve optional config into plain application-facing values as early as possible; avoid leaking raw `Option` handling deep into consumers unless the domain genuinely needs it.
- When a config family really has a namespace like `AUTH_*` or `STRIPE_*`, prefer `Config.nested(...)` to model that structurally instead of treating namespacing as a loader concern.

## Optional Values

- Treat `Config.option(...)` and `Config.withDefault(...)` as distinct tools:
- `Config.withDefault(...)` is for "missing value, known fallback".
- `Config.option(...)` is for "absence changes behavior".
- When absence is meaningful, prefer handling it inside the config module/service instead of pushing that branching into unrelated consumers.
- `Config.nonEmptyString(...)` validates the raw value, not a trimmed one. If whitespace-only input must be rejected after trimming, trim first and then validate non-empty explicitly.
- `Config.nonEmptyString(name).pipe(Config.map((s) => s.trim()))` is not equivalent to trim-then-validate. It accepts whitespace-only input and returns `''`.
