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

const emailOutboxSendingIncidentPredicate = () => sql<boolean>`
  ${emailOutbox.status} = 'sending'
  and (
    ${emailOutbox.lastAttemptAt} is null
    or (${emailOutboxAbandonedSendingPredicate()})
  )
`;

const emailOutboxIncompleteSentPredicate = () => sql<boolean>`
  ${emailOutbox.sentAt} is null
`;

const emailOutboxIncompleteSuppressedPredicate = () => sql<boolean>`
  (${emailOutbox.suppressedAt} is null or ${emailOutbox.lastAttemptAt} is null)
`;

export const emailOutboxOperationalIncidentPredicate = () => sql<boolean>`
  (
    ${emailOutbox.status} in ('failed', 'deliveryUnknown')
    or (${emailOutboxSendingIncidentPredicate()})
    or (
      ${emailOutbox.status} = 'sent'
      and ${emailOutboxIncompleteSentPredicate()}
    )
    or (
      ${emailOutbox.status} = 'suppressed'
      and ${emailOutboxIncompleteSuppressedPredicate()}
    )
  )
`;

/**
 * Each disjoint status/incident bucket contributes at most one page. Any row
 * outside its bucket's first page cannot belong to the global first page.
 * The overview and incomplete-terminal indexes keep routine sent history out
 * of terminal incident scans and the final sort. Sending eligibility still
 * filters current claims; exact summary counts intentionally aggregate the
 * complete retained outbox. Incomplete rows are degraded diagnostic states,
 * not another opportunity to dispatch an email.
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
    bucket('sending', 0, emailOutboxSendingIncidentPredicate()),
    bucket('sending', 1, not(emailOutboxSendingIncidentPredicate())),
    bucket('queued', 1),
    bucket('sent', 0, emailOutboxIncompleteSentPredicate()),
    bucket('sent', 1, not(emailOutboxIncompleteSentPredicate())),
    bucket('suppressed', 0, emailOutboxIncompleteSuppressedPredicate()),
    bucket('suppressed', 1, not(emailOutboxIncompleteSuppressedPredicate())),
  )
    .orderBy(({ id, incidentRank, updatedAt }) => [
      asc(incidentRank),
      desc(updatedAt),
      asc(id),
    ])
    .limit(100)
    .as('email_outbox_overview');
};
