import { emailOutbox } from '@db/schema';
import { asc, desc, sql } from 'drizzle-orm';

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
    ${emailOutbox.claimLeaseExpiresAt} is null
    or ${emailOutbox.claimLeaseExpiresAt} <= now()
  )
`;

export const emailOutboxOperationalIncidentPredicate = () => sql<boolean>`
  (
    ${emailOutbox.status} in ('failed', 'deliveryUnknown')
    or (${emailOutboxAbandonedSendingPredicate()})
  )
`;

export const emailOutboxOverviewOrderBy = () => {
  const incident = emailOutboxOperationalIncidentPredicate();

  return [
    asc(sql<number>`case when ${incident} then 0 else 1 end`),
    desc(emailOutbox.updatedAt),
    asc(emailOutbox.id),
  ] as const;
};
