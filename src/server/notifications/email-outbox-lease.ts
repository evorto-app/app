import { emailOutbox } from '@db/schema';
import { and, asc, desc, eq, not, type SQL, sql } from 'drizzle-orm';
import { QueryBuilder, unionAll } from 'drizzle-orm/pg-core';

/**
 * Long enough for the bounded provider request and its database settlement.
 * An expired claim is marked delivery-unknown and is never dispatched again.
 */
export const EMAIL_OUTBOX_CLAIM_LEASE_MS = 10 * 60 * 1000;

export const emailOutboxDispatchablePredicate = () => sql<boolean>`
  ${emailOutbox.status} = 'queued'
  and ${emailOutbox.attempts} = 0
`;

export const emailOutboxDispatchableByIdPredicate = (rowId: string) =>
  sql<boolean>`
    ${emailOutbox.id} = ${rowId}
    and ${emailOutboxDispatchablePredicate()}
  `;

export const emailOutboxClaimLeaseExpiry = () => sql<Date>`
  now() + (${EMAIL_OUTBOX_CLAIM_LEASE_MS} * interval '1 millisecond')
`;

export const emailOutboxOwnedClaimPredicate = (
  rowId: string,
  claimLeaseId: string,
) => sql<boolean>`
  ${emailOutbox.id} = ${rowId}
  and ${emailOutbox.status} = 'sending'
  and ${emailOutbox.claimLeaseId} = ${claimLeaseId}
`;

export const emailOutboxAbandonedSendingPredicate = () => sql<boolean>`
  ${emailOutbox.status} = 'sending'
  and (
    ${emailOutbox.claimLeaseId} is null
    or ${emailOutbox.claimLeaseExpiresAt} is null
    or ${emailOutbox.claimLeaseExpiresAt} <= now()
  )
`;

export const emailOutboxOperationalIncidentPredicate = () => sql<boolean>`
  (
    ${emailOutbox.status} in ('failed', 'deliveryUnknown')
    or (${emailOutboxAbandonedSendingPredicate()})
  )
`;

/**
 * Each disjoint status/incident bucket contributes at most one page. Any row
 * outside its bucket's first page cannot belong to the global first page.
 * The status/updatedAt/id index keeps retained sent history out of the final
 * incident sort. Sending eligibility still filters current claims; exact
 * summary counts intentionally aggregate the complete retained outbox.
 */
export const emailOutboxOverviewCandidates = () => {
  const query = new QueryBuilder();
  const bucket = (
    status: typeof emailOutbox.$inferSelect.status,
    incidentRank: 0 | 1,
    predicate?: SQL,
  ) =>
    query
      .select({
        id: emailOutbox.id,
        incidentRank: sql<number>`${incidentRank}::integer`.as('incident_rank'),
        updatedAt: emailOutbox.updatedAt,
      })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, status), predicate))
      .orderBy(desc(emailOutbox.updatedAt), asc(emailOutbox.id))
      .limit(100);

  return unionAll(
    bucket('failed', 0),
    bucket('deliveryUnknown', 0),
    bucket('sending', 0, emailOutboxAbandonedSendingPredicate()),
    bucket('sending', 1, not(emailOutboxAbandonedSendingPredicate())),
    bucket('queued', 1),
    bucket('sent', 1),
    bucket('suppressed', 1),
  )
    .orderBy(({ id, incidentRank, updatedAt }) => [
      asc(incidentRank),
      desc(updatedAt),
      asc(id),
    ])
    .limit(100)
    .as('email_outbox_overview');
};
