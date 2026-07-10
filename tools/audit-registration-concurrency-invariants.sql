-- Read-only deployment audit for the partial registration indexes.
--
-- Both result sets must be empty before applying the Drizzle schema. If either
-- query returns rows, stop and perform manual Stripe-aware reconciliation.
-- Never automatically choose or delete a winning registration or transaction.

SELECT
  "eventId",
  "userId",
  count(*) AS active_registration_count,
  array_agg(DISTINCT "tenantId" ORDER BY "tenantId") AS tenant_ids,
  array_agg(id ORDER BY "createdAt", id) AS registration_ids
FROM event_registrations
WHERE status <> 'CANCELLED'
GROUP BY "eventId", "userId"
HAVING count(*) > 1
ORDER BY "eventId", "userId";

SELECT
  "eventRegistrationId",
  count(*) AS pending_transaction_count,
  array_agg(DISTINCT "tenantId" ORDER BY "tenantId") AS tenant_ids,
  array_agg(id ORDER BY "createdAt", id) AS transaction_ids,
  array_agg("stripeCheckoutSessionId" ORDER BY "createdAt", id)
    AS checkout_session_ids
FROM transactions
WHERE status = 'pending'
  AND type = 'registration'
  AND "eventRegistrationId" IS NOT NULL
GROUP BY "eventRegistrationId"
HAVING count(*) > 1
ORDER BY "eventRegistrationId";
