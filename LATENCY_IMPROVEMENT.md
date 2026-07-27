# Latency Improvement Playbook

Use this playbook for warm-path latency work in the Angular SSR, Effect RPC, and
PostgreSQL request path. Cold starts are measured separately and are not allowed
to hide steady-state regressions.

The operational counterpart is
[infrastructure/scaleway/LATENCY_MONITORING.md](infrastructure/scaleway/LATENCY_MONITORING.md).

## Incident baseline

The following evidence was captured against `https://staging.evorto.app` on
2026-07-27. It is a dated comparison point, not a claim about current
performance:

- Eight consecutive anonymous `/events` requests reported 769-1,006 ms in
  `X-Envoy-Upstream-Service-Time`.
- Those requests had 932-1,247 ms external time-to-first-byte.
- `/healthz` used 43-168 ms of upstream time during the same investigation.
- One authenticated browser reload issued 12 client RPC requests after the
  document response. Event data became available roughly 2.5 seconds after the
  client RPC sequence began.
- The browser made duplicate `config.tenant` and `events.eventList` requests.
- Warm `events.eventList` calls used roughly 430-450 ms upstream.
- Server-rendered `/events` HTML contained `Loading events...`; the event list
  was not available in the rendered response.

The relevant latency code paths were unchanged between the deployed revision
and `main` when this evidence was captured.

## Provisional completion budgets

Treat these as initial engineering budgets. Replace them with accepted
production SLOs after at least seven representative days, but do not loosen
them merely to make a regression green.

| Boundary                                  | Initial warm budget                                |
| ----------------------------------------- | -------------------------------------------------- |
| `/events` upstream service time           | p95 at or below 500 ms over 20 consecutive samples |
| `/events` external TTFB                   | p95 at or below 750 ms over 20 consecutive samples |
| `config.bootstrap` RPC, once introduced   | p95 at or below 250 ms                             |
| `events.eventList` RPC                    | p95 at or below 350 ms                             |
| Event list visibly ready after navigation | p75 at or below 1.25 s and p95 at or below 2 s     |
| Duplicate RPCs during one navigation      | zero duplicate method/input pairs                  |

Correct tenant, permission, SSR, event-visibility, and authentication behavior
remains mandatory. A faster result that weakens one of those boundaries is a
regression.

## 1. Add enough spans to locate elapsed time

Do this before changing database indexes or adding caches. The existing HTTP
trace is too coarse to distinguish request-context, connection acquisition,
query execution, serialization, and Angular rendering.

The first observability slice now provides named `Effect.fn` operations or
explicit `Effect.withSpan` boundaries for:

- `Server.renderSsr`
- `Server.loadAuthSession`
- `Server.resolveHttpRequestContext`
- `Server.resolveTenantContext`
- `Server.resolveUserContext`
- `Server.resolveUserOnboarding`
- `Server.resolveUserAttributes`
- all Effect RPC handlers under the stable `Rpc.*` prefix, including
  `Rpc.events.eventList`;
- `Db.events.eventList`
- `Angular.handle`

Add `Rpc.config.bootstrap` through the same RPC prefix when the bootstrap
endpoint is introduced.

Annotate spans only with bounded, non-sensitive values:

- deployment environment, role, revision, and digest;
- normalized route or RPC method;
- authenticated versus anonymous;
- SSR-internal versus external request;
- database query name;
- result count and pagination limit.

Do not record cookies, tokens, email addresses, Auth0 IDs, user IDs, complete
tenant objects, RPC payloads, or SQL parameter values. Keep SQL statement
labels stable and low-cardinality.

For a staging investigation, dispatch `Deploy Scaleway staging` with
`full_trace_debugging` enabled. This temporarily raises trace sampling from 10%
to 100%; the next normal reconciliation restores 10%. `/healthz`, `/readyz`,
and `/version` intentionally remain untraced.

Exit criterion: one trace explains at least 90% of the elapsed time for an
anonymous `/events` request and an authenticated `events.eventList` request.

## 2. Remove the proven duplicate client work

### Tenant configuration

`ConfigService` currently creates a `config.tenant` TanStack query and also
calls `config.tenant` directly from `initialize()`.

Choose one query and one cache key:

1. Make the generated `config.tenant.queryOptions()` result the browser source
   of truth.
2. Have initialization await the same QueryClient entry instead of issuing a
   separate `.call()`.
3. On SSR, initialize tenant data from `REQUEST_CONTEXT` and disable the
   browser-only tenant query.
4. Add a unit test that constructs and initializes `ConfigService` and proves
   that only one browser tenant request occurs.

### Event list

`EventListService` puts `users.maybeSelf` data into the `events.eventList`
input. The first event query runs before `maybeSelf` resolves; the user ID then
changes the query key and triggers a second event query. The server already
derives the authenticated user from `RpcAccess`.

1. Remove `userId` from the event-list RPC input schema.
2. Remove the event-list service's `selfQuery` dependency.
3. Remove the mismatch-only server warning for the deleted input.
4. Keep user-specific filtering based only on the trusted RPC request context.
5. Update RPC, service, and Playwright tests to prove one event-list request per
   filter state.

Exit criterion: one `/events` navigation contains no duplicate
`config.tenant` call and exactly one `events.eventList` call for the initial
filter.

## 3. Collapse browser bootstrap RPC fan-out

The browser currently requests tenant, permissions, platform authority, public
configuration, authentication, and user state through several RPCs. Every HTTP
RPC repeats session and request-context resolution.

Introduce one typed `config.bootstrap` RPC response containing the state needed
to start the browser:

- tenant;
- permissions;
- platform authority;
- public configuration;
- authentication state;
- nullable current user.

Use one generated TanStack query as the shared source for `ConfigService`,
`Auth`, permissions, guards, and navigation. Do not copy the result into
multiple independent query keys.

Keep onboarding and scanner capability calls separate only if they are not
derivable from the bootstrap result. Start them concurrently after bootstrap
when they are both required; do not serialize unrelated calls.

Exit criterion: the browser reaches its first route with one bootstrap
request, and no component repeats a value already present in that response.

## 4. Remove the SSR loopback request

The outer SSR request resolves its tenant/user context before Angular starts.
Server-side `ConfigService.initialize()` then calls `config.public` through
`SSR_RPC_ORIGIN=http://127.0.0.1:4200`, causing `/rpc` to load the session and
resolve context again.

Extend the server-owned Angular request context with the already validated
public configuration, or provide an equivalent server-only injection token.
The server branch of `ConfigService.initialize()` should consume that value
directly. The browser branch should continue using typed RPC.

Do not solve this with externally supplied "trusted" headers, an authentication
bypass, or a process-global user cache. Preserve the existing tests proving
that forged forwarding and tenant headers cannot select another tenant.

Exit criterion: one anonymous `/events` SSR request resolves request context
once and makes no loopback RPC.

## 5. Reduce authenticated request-context cost

After fan-out and loopback removal, use the new spans to measure the remaining
context work. Focus on:

- tenant lookup by domain;
- user and tenant-assignment lookup;
- onboarding lookup;
- user-attribute lookup;
- database connection acquisition.

The current `user_attributes` view aggregates organizing registrations and is
queried during authenticated context resolution. Compare it with a
tenant-and-user-scoped `EXISTS` query. Prefer the scoped query when the plan
shows that the aggregate view scans unrelated tenants or users.

Load expensive user attributes lazily if only a subset of RPC handlers needs
them. Keep authorization fail-closed: a missing attribute may not silently
become permission.

Do not add a tenant or user cache until duplicate requests are gone and traces
prove repeated lookup cost remains material. Any later cache needs an explicit
key, bounded lifetime, mutation invalidation, tenant-isolation tests, and a
documented stale-data policy.

## 6. Explain and optimize the event-list SQL

Capture the exact SQL emitted for representative anonymous and authenticated
inputs. Run the plan through a private PostgreSQL path using the same schema and
realistic staging cardinality:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
-- exact parameterized SELECT, with test values substituted safely
;
ROLLBACK;
```

Store the redacted JSON plan with the performance evidence. Never include
personal data or credentials.

The current schema makes these measured candidates worth checking:

- `event_instances` has no dedicated tenant/start listing index;
- `event_registration_options` has no index led by `event_id`;
- the active registration lookup already has a partial
  `(event_id, user_id)` index for non-cancelled rows.

Evaluate, but do not blindly add:

- an `event_instances` index led by `tenant_id` and `start`, with status and
  listed-state ordering chosen from the real plan;
- an `event_registration_options(event_id)` index;
- a partial public-list index if approved, listed events dominate the hot path.

For each proposed index:

1. record the before plan, execution time, rows, loops, shared-buffer hits, and
   reads;
2. add it through the Drizzle schema and an explicit migration;
3. rerun both plans and the PostgreSQL integration suite;
4. verify write/storage cost is justified by the measured read improvement;
5. remove the index proposal if PostgreSQL does not use it under realistic
   cardinality.

## 7. Verify each slice independently

Measure after each phase instead of landing all changes as one opaque
optimization.

For every slice:

1. capture before/after trace IDs and revision/digest;
2. run unit tests for changed services, contracts, and handlers;
3. run the PostgreSQL integration suite for query or schema changes;
4. use Browser network inspection to verify request count and timing;
5. add Playwright coverage for stable request-count and visible-loading
   behavior;
6. repeat 20 warm `/events` samples and an authenticated event-list journey;
7. compare p50, p95, worst case, request count, and error count;
8. update the dated evidence record.

Do not encode tight wall-clock assertions in the general Playwright suite.
Enforce request shape/count there and enforce latency through the deployment
and monitoring checks described in the monitoring runbook.

Before a push or PR, run the complete local equivalents of every CI suite the
change triggers, with zero skips, todos, retries, or other incomplete outcomes,
as required by `QUALITY.md`.

## Completion record

Record this for the accepted improvement:

```text
Date:
Revision:
Image digest:
Trace evidence:
Browser network evidence:
PostgreSQL plans:
Warm /events p50/p95/max:
Authenticated event-data-ready p75/p95:
Initial client RPC count:
Tests:
Remaining bottleneck:
Accepted by:
```
