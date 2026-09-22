# Registration and Checkout

Registration orchestration lives in `../effect/rpc/handlers/events/event-registration.service.ts`.
The files here own add-on purchases, immutable price snapshots, Checkout binding,
completion and cleanup. Transfer behavior remains in the transfer modules.

- Reserve capacity and record the immutable tenant, event, registration, user,
  account, amount, currency, fee and Checkout request together. Re-read current
  membership and option eligibility under the reservation locks.
- Lock an existing registration before checking eligibility. Eligibility locks
  tenant, then event and questions, then membership/roles, then the option.
  Read answers against that locked question set. Free and waitlist paths use
  tenant key-share; paths that later lock payment configuration take tenant
  update immediately, without upgrading a shared lock. Eligibility takes the
  event update lock up front so compensation never upgrades an event share lock.
  Keep provider calls outside reservation transactions.
- Home-organization changes also take the destination tenant key-share lock
  before membership. The later global-user home-tenant foreign-key check must
  not reverse registration's tenant-before-membership lock order.
- A newly created claim owns one provider-create attempt. An uncertain create
  result or an interrupted attempt keeps the claim and reservation for review;
  another request must not create a second Checkout from that claim. A local UI
  attempt with no canonical server claim is a separate state.
- Resume only a usable Checkout already bound to the exact persisted claim.
  Validate the returned provider identity and hosted URL before binding. An
  ambiguous binding acknowledgement must be reconciled before expiring a
  session; never expire an exactly committed binding.
- Record a mismatched or unbound returned session as an incident when cleanup
  cannot establish a safe terminal state. Incidents are excluded from ordinary
  expiry cleanup. Preserve unexpected defects during reconciliation and cleanup.
- Paid manual approval binds Checkout and its required notification in one
  transaction. A bound replay must also confirm the exact notification record;
  it must not enqueue or dispatch a replacement notification.
- Read settled prices from the stored snapshot. Provider completion validates
  the exact payment identity and amount before transferring reserved capacity
  to confirmed capacity. Refund and acquisition records retain source-payment
  ownership.
- Canonical uncertain payment setup blocks cancellation and transfer while the
  place is held. Explain that an organizer or finance team must investigate;
  do not offer another approval or payment-create attempt. Platform finance has
  an explicit, reasoned recovery action for direct-registration claims. It
  reads the original account's existing Checkout, verifies the stored identity,
  request, amount, currency and line items, and revalidates the reviewed claim
  under registration-first locks before atomically binding and auditing it.
  Missing, ambiguous, incomplete or mismatched provider evidence keeps the hold.
- Recovery never creates or replays Checkout creation. Open Checkout may have
  no PaymentIntent and exposes no application fee: preserve the stored fee and
  retain canonical settlement's fee check. When a PaymentIntent exists, verify
  its fee, amount and currency before binding. Preserve incident identity and
  error history in the private audit; public history omits provider identifiers.
- Recovery schedules canonical completion/expiry without changing reserved
  capacity or add-on stock itself. For an open manual-approval payment, enqueue
  a missing notification with the original idempotency key in the same
  transaction; an existing failed or uncertain delivery stays untouched.
  Separate add-on purchase and transfer claims remain outside this workflow.

Unit fixtures use real Drizzle construction with explicit typed connection rows.
PostgreSQL tests prove locking, rollback, leases and replay behavior against the
owned disposable database; connection-free unit tests do not prove those properties.
