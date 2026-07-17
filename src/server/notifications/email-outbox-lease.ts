import { emailOutbox } from '@db/schema';
import { sql } from 'drizzle-orm';

/**
 * Long enough for a normal provider request, while still recovering abandoned
 * claims without operator intervention after a process crash.
 */
export const EMAIL_OUTBOX_CLAIM_LEASE_MS = 10 * 60 * 1000;

export const emailOutboxClaimablePredicate = () => sql<boolean>`
  ${emailOutbox.exhaustedAt} is null
  and (
    (
      ${emailOutbox.status} in ('queued', 'failed')
      and ${emailOutbox.nextAttemptAt} <= now()
      and ${emailOutbox.attempts} < ${emailOutbox.maxAttempts}
    )
    or (
      ${emailOutbox.status} = 'sending'
      and (
        ${emailOutbox.claimLeaseExpiresAt} is null
        or ${emailOutbox.claimLeaseExpiresAt} <= now()
      )
    )
  )
`;

export const emailOutboxClaimableByIdPredicate = (rowId: string) =>
  sql<boolean>`
    ${emailOutbox.id} = ${rowId}
    and ${emailOutboxClaimablePredicate()}
  `;

export const emailOutboxClaimAttempts = () => sql<number>`
  case
    when ${emailOutbox.status} = 'sending' then ${emailOutbox.attempts}
    else ${emailOutbox.attempts} + 1
  end
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

export const emailOutboxStaleSendingPredicate = () => sql<boolean>`
  ${emailOutbox.status} = 'sending'
  and (
    ${emailOutbox.claimLeaseExpiresAt} is null
    or ${emailOutbox.claimLeaseExpiresAt} <= now()
  )
`;
