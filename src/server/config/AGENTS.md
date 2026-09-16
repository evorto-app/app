# Config Guidelines

## Provider and Environment Sources

- Supported package commands resolve configuration in memory through `bun run env:run -- <command>`. The precedence is caller-provided environment variables, `.env.dev.local`, generated runtime defaults, then `.env`.
- Use the package scripts or `env:run` for direct external commands. Do not chain `env:runtime` with `dotenv`: a concurrent command can replace the shared snapshot between generation and loading.
- `env:runtime` atomically writes an owner-only `.env.dev` snapshot for standalone inspection. Normal package command bootstrapping does not read that snapshot.
- `.env.dev.local` is the tracked shared default dev config file; `.env` is the untracked developer-secrets file.
- The Effect provider consumes the resolved process environment first. When called directly, its local file fallback remains `.env.dev.local`, `.env.dev`, then `.env`, followed by schema defaults. That fallback is not a substitute for the invocation environment when launching local commands.
- `.env.local`, `.env.runtime`, and `.env.ci` are unsupported in this repo and should not be created or referenced.
- Preserve explicit empty strings in both Effect process and dotenv providers. Field parsers decide whether blank is invalid or optional; an empty higher-priority value must not silently select a lower-priority value. Omit an optional CA setting instead of assigning an empty certificate.
- In CI and other cloud environments, do not rely on tracked or generated dotenv artifacts. Use explicit environment variables provided by GitHub Actions `env`, `vars`, and `secrets`.

## Explicit Runtime and Transport Settings

- Require `APP_ENVIRONMENT`, `APP_ROLE`, `WORKER_TRIGGER_MODE`, and
  `DATABASE_TLS_REQUIRED`; local environment generation supplies their local values.
- Auth0 issuer origins must use HTTPS on its default port. Only `BASE_URL` may
  use HTTP for local loopback development. Validate the raw origin shape before
  accepting URL normalization: allow only the authority and an optional trailing
  slash, with no paths, dot segments, query/fragment markers, backslashes,
  credentials, empty explicit ports, or internal whitespace. Surrounding whitespace
  is trimmed.
- Without a CA, shared PostgreSQL constructors retain the driver's raw absolute Unix socket path syntax, including its optional database suffix. Supplying a CA still requires a PostgreSQL URL with a host for verified TLS identity; a raw socket path cannot bypass that validation.
- A provided database CA certificate must be nonblank even when
  `DATABASE_TLS_REQUIRED=false`; preserve its PEM bytes. Shared PostgreSQL
  constructors and raw ops entrypoints enforce this before creating a pool.
  When configuring a CA, keep SSL settings out of `DATABASE_URL` so they cannot
  override certificate and server-name verification in the PostgreSQL driver.
- Managed schema operations also use a supplied CA when TLS is optional. Explicit
  bracketed IPv6 TLS identities are unwrapped for IP-SAN checks and omitted from
  SNI. Only one complete pair around a valid IPv6 address may be unwrapped;
  malformed brackets and bracketed DNS identities fail configuration validation.
  IPv6 connection hosts and certificate identities use the same normalized
  effective host in both PostgreSQL clients.
- Normalize the optional TLS server name before both certificate identity and
  SNI: trim surrounding whitespace, and treat a blank value as absent so the
  effective connection host is verified. Managed Drizzle and the shared pool
  constructors used by prerequisites and reset enforce the same policy as the
  application config. Preserve CA certificate bytes.
- With a CA, managed Drizzle URLs support only `host`, `port`, `user`, and
  `password` query options. Match the pinned PostgreSQL parser: the final value
  wins, and an empty final value uses the authority value. Decode the database
  pathname like that parser; `database` is not a query override. Reject other
  query options explicitly, including session options, rather than silently
  dropping settings such as `options=-c search_path=...`. This tightens the
  managed URL contract; move necessary session configuration to an explicit
  database-role policy before running schema operations.
- Managed schema credentials require a host, user, password, and database in the
  URL. The effective port must be an integer from 1 through 65535 and defaults
  to 5432. These values never fall back to ambient `PG*` variables. Without a CA,
  optional-TLS Drizzle commands retain their existing driver URL configuration.

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
      ? Effect.succeed(s)
      : Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message: `Expected ${name} to be a non-empty string`,
            }),
          ),
        ),
  ),
);

// Wrong: validates raw value, whitespace-only strings pass through
Config.nonEmptyString(name).pipe(Config.map((s) => s.trim()));
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

| Tool                           | Use when                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| `Config.withDefault(fallback)` | Missing value has a known fallback; result type is `A`             |
| `Config.option(...)`           | Absence meaningfully changes behaviour; result type is `Option<A>` |

When using `Config.option`, resolve the `Option` inside the config module or service
layer. Prefer `Option.filter` over `Option.match` when the only goal is to convert
blank values to `None`:

```typescript
// Preferred
Config.option(trimmedString(name)).pipe(Config.map(Option.filter((s) => s.length > 0)));

// Avoid — verbose, hides intent
Config.option(trimmedString(name)).pipe(
  Config.map((value) =>
    Option.match(value, {
      onNone: () => Option.none(),
      onSome: (s) => (s.length > 0 ? Option.some(s) : Option.none()),
    }),
  ),
);
```

## Private Ops Database Role

Non-bootstrap `APP_ROLE=ops` requires `DATABASE_RUNTIME_ROLE` in the actual process
environment inherited by the packaged prerequisites command. An Effect dotenv
fallback alone does not satisfy this requirement. Both startup/request validation
and the child command share `isDatabaseRuntimeRoleName`; surrounding whitespace
is invalid.
Web, worker, initial bootstrap, and local seed commands do not require this setting.

## Sign-in Callback Recovery

A stale or replayed callback with the SDK's `MissingTransactionError` receives
an explicit non-cacheable 400 response. Handle this only at the callback boundary;
unknown SDK failures and errors merely named like an expected error remain defects.
