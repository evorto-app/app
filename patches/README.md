# Dependency patches

Keep runtime changes here rather than editing the pristine source snapshots in
`repos/`. Reassess each patch when updating its package.

- `@effect/sql-pg@4.1.5`: retain the query-cancellation safeguard. A cancelled
  active session is discarded, and its physical socket must close before pool
  invalidation admits a replacement. Preserve upstream acquisition timeouts,
  pinning, and connection telemetry when rebasing. PostgreSQL integration tests
  cover cancellation and delayed stream closure.
- The `@heddendorp/effect-angular-query` and `@heddendorp/effect-platform-angular`
  Angular 22 patches were removed: `0.2.1` and `0.1.1` support Angular 22 and
  Effect 4.1.5 upstream.
- The Material color utility patch fixes missing `.js` extensions in the
  published 0.4.0 ES module imports. Importing the unpatched package in Node
  24.22.1 fails with `ERR_MODULE_NOT_FOUND`; retain it until a corrected release
  is published.
- The Drizzle rc.4 error-constructor patch was removed: rc.5+ uses the supported
  Effect `Schema.TaggedError` API upstream.

The package manifest also overrides Vite to 8.3.5 because Angular's builder pins
an older affected release, and Tailwind Typography's selector parser to 7.1.6
because it still pins the affected 6.0.10 version. Keep these overrides until
those upstream packages depend on fixed versions. The selector parser API used
by Typography remains supported; app builds and rich-text rendering tests
exercise this integration.

## Update boundaries (2026-11-21)

The reference snapshots have their own commit; dependency updates do not edit
`repos/`. See [source provenance](../repos/README.md).

Keep TypeScript on 6.0: Angular 22.3 requires `>=6.0 <6.1`. Stripe 23 and the
OpenTelemetry 3 exporter are separate API migrations; this update retains
Stripe 22 and the compatible OpenTelemetry 2 / exporter 0.223 line. Unicorn 80
rule changes are not necessary for this update; retain `76.0.0`. `drizzle-seed`
remains on `1.0.0-rc.5` because no `1.0.0-rc.6` release is published.

Drizzle rc.6 removed cast codecs (`::text` column casts) for `@effect/sql-pg`
and encodes `varchar[]` parameters as PostgreSQL array literals. Role-ID
containment and overlap predicates retain explicit `varchar[]` casts so
PostgreSQL does not resolve them as `text[]`. Existing PostgreSQL tests verify
role deletion, visibility, ownership, and tenant boundaries through this path.

Bun 1.4.4 is now the package-manager, formatter, Docker and CI baseline. Its
Node HTTP bridge can close a socket without closing the associated rejected
request stream. The application closes that stream when its socket closes and
removes the temporary drain observers when request cleanup finishes. The
unchanged real-runtime request-body probe passes on both Bun 1.4.2 and 1.4.4;
deterministic unit coverage also checks socket-first and request-first cleanup
and an already-closed socket. Keep these safeguards when updating Bun; do not
extend the timeout or weaken cleanup assertions to accept a runtime release.
Node remains pinned independently to 24.22.1.
