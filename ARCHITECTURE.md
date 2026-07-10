# Architecture Context

Evorto is an Angular SSR application with a server/runtime layer built around Effect, typed RPC contracts, Drizzle, Postgres, Stripe, Auth0, and object storage.

This file gives future agents the high-level map. More specific guidance belongs near the code it governs.

## System Shape

Evorto is a tenant-based app.

At a high level:

- Angular renders the app, including authenticated SSR pages.
- Cookie-based authentication allows authenticated server-side rendering.
- The server/runtime layer exposes typed Effect RPC APIs.
- Data is persisted in Postgres through Drizzle.
- Payments and refunds are handled through Stripe.
- Auth is handled through Auth0 for now.
- Blob/object storage is used for uploaded files such as receipts.
- Tenants are resolved from domains.
- Playwright drives regression tests and generated product documentation.

## Non-Negotiable Architecture Choices

Do not casually replace these choices:

- Angular
- Angular SSR
- cookie-based authentication
- Angular Material for components
- Material 3 design direction
- Tailwind for styling/layout utilities
- TanStack Query for client data/query state
- Effect v4
- Effect RPC for app/server contracts
- Effect Schema at server/API boundaries
- Drizzle as the database schema/query layer
- Postgres as the persisted relational store
- Stripe for payment and refund lifecycle
- tenant/domain-based product model

Changing one of these requires an explicit design decision, not incidental refactoring.

## Runtime and Rendering

Evorto uses server-side rendering.

Cookie-based authentication is important because authenticated pages should be renderable on the server. Agents should avoid introducing assumptions that authentication only exists client-side.

SSR-sensitive work should consider:

- tenant resolution from request domain
- authenticated user context
- cookie/session behavior
- redirects
- server/client data consistency
- whether a page must work before client hydration

## Tenant Resolution

Tenants are resolved by domain.

The current relaunch schema stores one active primary domain per tenant. That
domain may be an Evorto-provided subdomain or a manually configured custom
domain, but automated multi-domain/custom-domain verification is outside the
current runtime model. Derive the production HTTPS origin for email and Stripe
return links from the normalized primary domain; local development may use an
explicit loopback runtime origin. Never derive an external URL from
caller-controlled request headers. Only a platform administrator may change
the saved tenant host.

If no tenant matches the request domain, fail closed or show a tenant-not-found state. Do not guess a tenant.

Tenant context affects:

- visible events
- available roles
- user role assignments
- registration eligibility
- templates
- tenant settings
- branding
- legal pages
- Stripe/payment configuration where applicable

## Tenant Runtime Formatting

The product's formatting locale is fixed to `de-DE`; it does not provide UI
translation. Currency and business timezone remain tenant-specific runtime
configuration. Supported currencies are `EUR`, `CZK`, and `AUD`; the timezone
is an IANA name and defaults to `Europe/Berlin`. SSR and browser rendering must
resolve the same tenant values: use currency for money defaults and
recorded-money display, and use the tenant timezone for scheduling,
registration/check-in windows, and date/time display. Do not let a viewer's
browser timezone silently redefine an event's business time.

## Angular App Boundary

The Angular app should follow the repo's app guidance:

- standalone components
- no NgModules
- no explicit `standalone: true`
- `ChangeDetectionStrategy.OnPush`
- signals for local state
- `computed()` for derived state
- `effect()` for side effects
- native control flow
- Signal Forms for new form work
- Angular Material components where suitable
- Material 3 design direction
- Tailwind for styling and responsive layout
- Font Awesome Duotone icons through `<fa-duotone-icon>`
- no new `<mat-icon>` usage

Use the typed RPC Angular client for data access. Do not reintroduce legacy client patterns or bypass type errors with cast hacks.

## Server/API Boundary

The server should remain Effect-first.

Use:

- Effect services
- `Context.Service`
- composed `Layer`s
- Effect RPC
- Effect Schema for input/output validation
- typed error channels
- explicit domain error mapping

Do not introduce new Express/Hono server paths.

Unexpected runtime failures should remain defects until the boundary where they can be logged and surfaced correctly. Do not hide defects with silent fallbacks.

Permission implications must use shared evaluation semantics in the client and
server. The client may use them for navigation and affordances, but each server
read and write remains responsible for enforcing the resolved permission.

## Data Boundary

Drizzle schema is the source of truth for persisted shapes.

Agents should:

- derive types from Drizzle where possible
- avoid duplicate handwritten DB model types
- keep migrations explicit and committed
- define real database constraints where needed
- keep relation optionality accurate
- be careful with event/registration/payment archival model changes

High-risk data areas:

- tenant isolation
- role and capability assignment
- event lifecycle state
- registration options
- registration exclusivity
- capacity and waitlist handling
- pending paid registrations
- Stripe payment/refund mapping
- guest quantities
- add-on entitlement, redemption, cancellation, and stock state
- check-in state
- receipt persistence
- event archival

## Auth Boundary

Auth0 is the current auth provider.

The product does not require anonymous registration. Users need an account to register, but anonymous users may browse eligible listed events.

Auth-related changes should preserve:

- cookie-based auth
- SSR support for authenticated pages
- global users across tenants
- tenant-scoped role assignments
- home tenant support
- social login / lightweight account creation where available

Tenant onboarding is part of the auth boundary. A cross-tenant join records
acceptance of the tenant's current privacy policy and answers to required
tenant-wide onboarding questions before creating the tenant membership. That
first completed membership becomes the user's home tenant. A later automatic
join must not overwrite it; only an explicit profile action may do so. Every
privacy-policy change creates a new acceptance requirement and tells the tenant
administrator making the change that affected users must re-accept it. Supported
tenant-wide question types are short text and selection from a list. Resolve
the current policy/version and required answers for every
authenticated tenant user; block tenant-scoped actions with an immediate,
accessible completion flow until they are current.

Changing auth provider is possible in the future, but not an incidental task.

## Platform Administration

Platform administrators are independent platform principals. They may perform
any platform operation for any tenant at any time without a tenant membership.
Keep that authority explicit in the request context and audit trail rather than
silently reusing a tenant user's identity or roles. Record immutable actor,
target tenant, action, before/after data, reason, and timestamp for every
cross-tenant platform action.

## Payment Boundary

Stripe is the source of truth for payment state.

Evorto should use local payment data only as application state derived from Stripe and app workflow needs.

Payments belong to each tenant's configured Stripe Connect account. Every
tenant payment, customer, Checkout, payment-intent, expiry, and refund call
must pass that account as the connected-account context. Evorto adds only its
application fee; tenant payment and cancellation settings remain tenant-owned,
with narrower registration-option overrides where configured.

High-risk payment flows:

- Stripe Checkout
- webhook processing
- pending registration cleanup
- registration confirmation after payment
- refunds
- transfer/resale flow
- tenant payment configuration
- financial reporting

Agents must not fake successful payment state locally without respecting Stripe lifecycle.
Application approval, capacity reservation, and Checkout creation must have one
durable owner and one live payment transaction per registration. Capacity and
payment transitions belong in atomic, replay-safe state changes.

## Notification Boundary

Customer-facing email is rendered from React Email components and committed to
the transactional outbox before delivery through the configured provider. Do
not bypass the outbox for template rendering, delivery, idempotency, retries, or
failure observability.

## Storage Boundary

Object/blob storage is used for uploaded files such as receipts.

Local development uses MinIO. Production storage may differ behind the same app-level storage boundary.

Agents should avoid tying application behavior to MinIO-specific assumptions unless working on local runtime tooling.
Authorized receipt-media preflight binds an upload to the current tenant,
event, and submitting user before object storage accepts it; submission then
consumes that authorized upload rather than trusting an arbitrary object key.

## Local Runtime and Worktrees

The local runtime should make dependencies easy to start and isolate.

Expected local dependency stack:

- Docker Compose
- Neon Local for ephemeral Postgres branches
- MinIO for blob storage
- app server on a configurable local port where possible

The project should support multiple worktrees running in parallel. Worktree-local generated env/runtime configuration should avoid collisions in Docker project names and service ports.

The app port may remain constrained by Auth0 callback configuration, but the architecture should not make parallel worktrees harder than necessary.

## Common Change Areas

Agents should usually start in these areas when working on related changes:

- event browsing and listing
- event creation/editing
- template management
- review and publishing workflow
- registration options
- registration eligibility
- registration checkout/payment
- waitlists
- transfer/resale
- guest quantities
- QR code generation/check-in
- roles and capabilities
- tenant settings/branding/legal pages
- receipts/reimbursements
- generated Playwright documentation
- local runtime/test helpers

Use module-local `AGENTS.md` files and READMEs for implementation-specific guidance.

## Browser and Playwright Relationship

The Codex in-app Browser plugin is for exploratory verification and manual
validation:

- understand page structure
- reproduce issues
- inspect console/network behavior
- check visual states
- validate that a changed UI feels correct
- explore flows before encoding them in tests

Playwright is for repeatable confidence:

- regression tests
- CI coverage
- deterministic product flows
- generated user/admin documentation
- screenshots and evidence for documented flows

A useful pattern is:

1. Use Browser to explore and validate behavior.
2. Encode the final expected behavior in Playwright.
3. Use Playwright screenshots/docs as durable evidence.

## Documentation Architecture

Playwright-generated documentation should be grouped by feature area, not by persona first.

Persona metadata or tags may be added later.

Feature-area grouping should align with test organization where practical.

## Architecture Watchpoints

### SSR and auth

Current default: authenticated pages should work with cookie-based SSR.

Raise this when: changing auth, redirects, tenant resolution, page loading, or server/client data fetching.

Do not: make authenticated pages depend only on client-side auth unless explicitly approved.

### Tenant isolation

Current default: tenant data is isolated except for global users and cross-tenant membership.

Raise this when: changing queries, caching, roles, templates, registrations, payments, files, or generated docs.

Do not: load tenant-scoped data without an explicit tenant boundary.

### Registration data model

Current default: registration options are flexible, mutually exclusive per event, role-gated, and used for both participant and organizer signup.

Templates and events own independent simple/advanced configuration modes. A
template-to-event operation copies a snapshot; it never leaves a live link that
silently mutates the event later. In simple mode, the UI projects one organizing
and one non-organizing option. In advanced mode, it uses a stable option-id list
with an explicit organizing flag. Missing organizer or participant options are
diagnostic warnings, not persistence blockers, because optionless operational
events are valid. Mode changes require explicit confirmation; advanced-to-simple
conversion additionally requires exactly one option of each kind.

Add-ons are reusable event/template entities with explicit many-to-many option
attachments. Each attachment must keep included entitlement quantity separate
from optional purchase quantity. A purchase record needs immutable granted,
included, redeemed, and cancelled quantities so stock changes or later edits do
not rewrite a settled registration. Guests remain a typed registration-level
quantity because capacity, price, cancellation, QR scanning, and partial
check-in have different invariants from ordinary stock add-ons.

Registration configuration UI should keep ownership shallow: the page-level
Signal Form owns the option and attachment collections; bounded partial forms
receive their field slice through inputs and use projected slots for option
actions. Do not build an unbounded nested tree of option → add-on → purchase
forms or duplicate client/server payload models.

Scanner redemption and its immediate undo are tenant-scoped, conditional writes
that require organizer/check-in access. Unilateral registration or add-on
cancellation/refund is a distinct capability and must be checked server-side on
every mutation. Refund creation remains Stripe-connected-account work and must
not refund included units or already redeemed/cancelled quantities twice.

Raise this when: changing schema, event setup UI, checkout, capacity, discounts, waitlists, guests, or check-in.

Do not: flatten the model in ways that block the known product workflows.

### Event archival

Current default: support archival at the data-model level for relaunch, but do not add automatic archival without explicit product direction.

Raise this when: changing event graph persistence or personal-data retention behavior.

Do not: copy personal data into archive records unless there is a clear retention reason.
