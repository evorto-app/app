# Dependency patches

Keep runtime changes here rather than editing the pristine source snapshots in
`repos/`. Reassess each patch when updating its package.

- `@effect/sql-pg@4.0.6`: retain the query-cancellation safeguard. A cancelled
  active session is discarded, and its physical socket must close before pool
  invalidation admits a replacement. Preserve upstream acquisition timeouts,
  pinning, and connection telemetry when rebasing. PostgreSQL integration tests
  cover cancellation and delayed stream closure.
- The Effect Angular bridge patches retain Angular 22 peer support. The platform
  bridge also uses the stable Effect 4 HTTP/RPC import paths in its runtime and
  type declarations.
- The Material color utility patch fixes missing `.js` extensions in the
  published 0.4.0 ES module imports. Importing the unpatched package in Node
  24.22.1 fails with `ERR_MODULE_NOT_FOUND`; retain it until a corrected release
  is published.
- The Drizzle rc.4 error-constructor patch was removed: rc.5 uses the supported
  Effect `Schema.TaggedError` API upstream.

The package manifest also overrides Vite to 8.3.5 because Angular's builder pins
an older affected release, and Tailwind Typography's selector parser to 7.1.6
because it still pins the affected 6.0.10 version. Keep these overrides until
those upstream packages depend on fixed versions. The selector parser API used
by Typography remains supported; app builds and rich-text rendering tests
exercise this integration.

## Update boundaries (2026-10-23)

The reference snapshots have their own branch and commit; dependency updates do
not edit `repos/`. See [source provenance](../repos/README.md).

Keep TypeScript on 6.0: Angular 22.2 requires `>=6.0 <6.1`. Stripe 23 and the
OpenTelemetry 3 exporter are separate API migrations; this update retains
Stripe 22 and the compatible OpenTelemetry 2 / exporter 0.223 line. The
Jasmine type major, Unicorn 78 rule changes, and Happy DOM 21 are not necessary
for this update; retain their existing major versions.

Drizzle rc.5 passes native arrays to the driver. Role-ID containment and overlap
predicates explicitly cast the bound arrays to `varchar[]` so PostgreSQL does not
resolve them as `text[]`. Existing PostgreSQL tests verify role deletion,
visibility, ownership, and tenant boundaries through this path.

Bun 1.4.3 and 1.4.4 are held: the existing real-runtime request-body regression
probe fails with `bodyless request drain cleanup timed out`, while 1.4.2 passes
with the same application and dependencies. Keep the package manager, Docker,
and CI on Bun 1.4.2 until that regression is resolved. Node is updated to
24.22.1 independently. Do not extend the timeout or weaken the cleanup check to
accept these Bun releases.
