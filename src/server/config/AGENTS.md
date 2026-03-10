# Config Guidelines

## Provider and Environment Sources

- Runtime config resolution uses provider precedence in this order: real environment variables, `.env.local`, `.env`, `.env.runtime`, then in-code defaults.
- `.env.runtime` is a generated local runtime/test artifact. Keep canonical keys there for local flows when needed, but do not treat it as a source of truth.
- In CI and other cloud environments, do not rely on `.env` files or `/Users/hedde/code/effect`. Use explicit environment variables or generated runtime env artifacts instead.

## Effect Config Shape

- Prefer native Effect `Config.*` combinators in module declarations.
- `ConfigProvider.fromEnv` does not trim string values. If surrounding whitespace is
  invalid for a config field, trim explicitly with `Config.map((s) => s.trim())`.
- Use `Config.withDefault(...)` when a missing value has a sensible fallback — the
  result type stays `A`, no `Option` involved.
- Use `Config.option(...)` when absence is semantically meaningful. Resolve that
  `Option` at the config-module or service-layer boundary, not deep in consumers.
- If blank strings should behave like "not configured", handle that inside the config
  module with `Option.filter((s) => s.length > 0)` after trimming.
- Do not add generic wrapper helpers for Effect primitives (booleans, ports, durations,
  defaults). Use the built-ins directly.
- Prefer structural helper names (`trimmedString`, `optionalTrimmedString`) over
  domain-specific names (`optionalAuthStringConfig`) unless the helper genuinely
  encodes a domain rule.

## `Config.nonEmptyString` vs trim-then-validate

`Config.nonEmptyString(name)` validates `text.length > 0` against the **raw,
untrimmed** value from the provider. This means:

- `"   "` (whitespace only) **passes** `Config.nonEmptyString` and would be returned
  as `"   "` if you trim afterwards.
- `Config.nonEmptyString(name).pipe(Config.map((s) => s.trim()))` is therefore **not**
  equivalent to "trim then reject empty" — it accepts whitespace-only input.

When whitespace-only input must be rejected, **trim first, then validate non-empty**:

```typescript
// Correct: trim first, then reject empty
Config.string(name).pipe(
  Config.map((s) => s.trim()),
  Config.mapOrFail((s) =>
    s.length > 0
      ? Either.right(s)
      : Either.left(ConfigError.MissingData([name], `Expected ${name} to be a non-empty string`))
  )
)

// Wrong: validates raw value, whitespace-only strings pass through
Config.nonEmptyString(name).pipe(Config.map((s) => s.trim()))
```

Use `Config.nonEmptyString` only when you trust the provider to not supply
whitespace-only values (e.g. structured JSON providers, test maps).

## Helpers Policy

- Shared config utilities should encode a deliberate repo-wide policy only.
- Shared string utilities should stay structural: trimming, optional non-empty parsing.
- Do not collapse `Option` to `undefined` in a shared helper. Convert at the boundary
  where the value is consumed.
- Do not hide core Effect config semantics inside a helper. Keep helpers transparent.

## Service Boundary

- Config definitions should be plain `Config<A>` values — no `loadXSync` wrappers.
  Let callers compose them with the rest of their program.
- `Effect.runSync` (or any `run*`) belongs at the program entry point only, not inside
  config modules.
- Application runtime config should be provided through a `Layer` and accessed via the
  Effect context. Inline `yield* Config.*` reads are acceptable for small local
  one-offs only.
- When a config family has a namespace (`AUTH_*`, `STRIPE_*`), express that with
  `Config.nested("AUTH")` on the `Config.all({...})` declaration — not by prefixing
  every key name or passing a namespace string to a loader function.

## Optional Values

`Config.option` and `Config.withDefault` are distinct tools:

| Tool | Use when |
|---|---|
| `Config.withDefault(fallback)` | Missing value has a known fallback; result type is `A` |
| `Config.option(...)` | Absence meaningfully changes behaviour; result type is `Option<A>` |

When using `Config.option`, resolve the `Option` inside the config module or service
layer. Prefer `Option.filter` over `Option.match` when the only goal is to convert
blank values to `None`:

```typescript
// Preferred
Config.option(trimmedString(name)).pipe(
  Config.map(Option.filter((s) => s.length > 0))
)

// Avoid — verbose, hides intent
Config.option(trimmedString(name)).pipe(
  Config.map((value) =>
    Option.match(value, {
      onNone: () => Option.none(),
      onSome: (s) => s.length > 0 ? Option.some(s) : Option.none(),
    })
  )
)
```
