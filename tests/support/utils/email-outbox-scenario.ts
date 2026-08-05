import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { relations } from '../../../src/db/relations';
import * as schema from '../../../src/db/schema';

type TestDatabase = NodePgDatabase<typeof relations>;

export interface EmailOutboxScenarioItem {
  id: string;
  recipient: string;
  subject: string;
}

export interface EmailOutboxScenario {
  cleanup: () => Promise<void>;
  failed: EmailOutboxScenarioItem;
  unknown: EmailOutboxScenarioItem;
  sending: EmailOutboxScenarioItem;
  sent: EmailOutboxScenarioItem;
}

const activeClaimExpiry = new Date('2099-01-01T12:10:00.000Z');
const priorAttempt = new Date('2026-01-15T12:00:00.000Z');

export const seedEmailOutboxScenario = async ({
  database,
  tenant,
}: {
  database: TestDatabase;
  tenant: { domain: string; id: string; name: string };
}): Promise<EmailOutboxScenario> => {
  const item = (
    recipientLabel: string,
    subject: string,
  ): EmailOutboxScenarioItem => ({
    id: getId(),
    recipient: `alex.${recipientLabel}@example.org`,
    subject,
  });
  const unknown = item('receipts', 'We could not confirm your receipt update');
  const sending = item('events', 'Your event update is being sent');
  const failed = item('receipts', 'Your receipt update could not be sent');
  const sent = item('events', 'Your event ticket is confirmed');
  const rows = [unknown, sending, failed, sent];

  await database.insert(schema.emailOutbox).values([
    {
      attempts: 1,
      deliveryUnknownAt: priorAttempt,
      html: '<p>We could not confirm your receipt update.</p>',
      id: unknown.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${unknown.id}`,
      kind: 'receiptReviewed',
      lastAttemptAt: priorAttempt,
      lastError: 'Provider accepted the request but its response was lost',
      provider: 'tem',
      status: 'deliveryUnknown',
      subject: unknown.subject,
      tenantId: tenant.id,
      text: 'We could not confirm your receipt update.',
      toEmail: unknown.recipient,
    },
    {
      attempts: 1,
      claimLeaseExpiresAt: activeClaimExpiry,
      claimLeaseId: `lease-${sending.id}`,
      html: '<p>Your event update is being sent.</p>',
      id: sending.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${sending.id}`,
      kind: 'manualApproval',
      lastAttemptAt: priorAttempt,
      status: 'sending',
      subject: sending.subject,
      tenantId: tenant.id,
      text: 'Your event update is being sent.',
      toEmail: sending.recipient,
    },
    {
      attempts: 1,
      html: '<p>Your receipt update could not be sent.</p>',
      id: failed.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${failed.id}`,
      kind: 'receiptReviewed',
      lastAttemptAt: priorAttempt,
      lastError: 'Recipient address was rejected',
      provider: 'tem',
      status: 'failed',
      subject: failed.subject,
      tenantId: tenant.id,
      text: 'Your receipt update could not be sent.',
      toEmail: failed.recipient,
    },
    {
      attempts: 1,
      html: '<p>Your event ticket is confirmed.</p>',
      id: sent.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${sent.id}`,
      kind: 'manualApproval',
      lastAttemptAt: priorAttempt,
      provider: 'fake',
      providerMessageId: `fake-${sent.id}`,
      sentAt: priorAttempt,
      status: 'sent',
      subject: sent.subject,
      tenantId: tenant.id,
      text: 'Your event ticket is confirmed.',
      toEmail: sent.recipient,
    },
  ]);

  return {
    cleanup: async () => {
      await database.delete(schema.emailOutbox).where(
        inArray(
          schema.emailOutbox.id,
          rows.map((row) => row.id),
        ),
      );
    },
    failed,
    unknown,
    sending,
    sent,
  };
};
