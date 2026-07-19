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
  exhausted: EmailOutboxScenarioItem;
  queued: EmailOutboxScenarioItem;
  retry: EmailOutboxScenarioItem;
  sending: EmailOutboxScenarioItem;
  sent: EmailOutboxScenarioItem;
}

const futureAttempt = new Date('2099-01-01T12:00:00.000Z');
const activeClaimExpiry = new Date('2099-01-01T12:10:00.000Z');
const priorAttempt = new Date('2026-01-15T12:00:00.000Z');

export const seedEmailOutboxScenario = async ({
  database,
  tenant,
}: {
  database: TestDatabase;
  tenant: { domain: string; id: string; name: string };
}): Promise<EmailOutboxScenario> => {
  const scope = tenant.id.slice(-8);
  const item = (label: string): EmailOutboxScenarioItem => ({
    id: getId(),
    recipient: `outbox-${label.toLocaleLowerCase()}-${scope}@example.org`,
    subject: `${label} delivery ${scope}`,
  });
  const queued = item('Queued');
  const retry = item('Retry');
  const sending = item('Sending');
  const exhausted = item('Exhausted');
  const sent = item('Sent');
  const rows = [queued, retry, sending, exhausted, sent];

  await database.insert(schema.emailOutbox).values([
    {
      fromEmail: 'no-reply@notifications.evorto.app',
      fromName: 'Evorto',
      html: '<p>Queued operational test email</p>',
      id: queued.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${queued.id}`,
      kind: 'manualApproval',
      maxAttempts: 8,
      nextAttemptAt: futureAttempt,
      status: 'queued',
      subject: queued.subject,
      tenantId: tenant.id,
      text: 'Queued operational test email',
      toEmail: queued.recipient,
    },
    {
      attempts: 2,
      fromEmail: 'no-reply@notifications.evorto.app',
      fromName: 'Evorto',
      html: '<p>Scheduled retry operational test email</p>',
      id: retry.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${retry.id}`,
      kind: 'receiptReviewed',
      lastAttemptAt: priorAttempt,
      lastError: 'Temporary provider timeout',
      maxAttempts: 8,
      nextAttemptAt: futureAttempt,
      status: 'queued',
      subject: retry.subject,
      tenantId: tenant.id,
      text: 'Scheduled retry operational test email',
      toEmail: retry.recipient,
    },
    {
      attempts: 1,
      claimLeaseExpiresAt: activeClaimExpiry,
      claimLeaseId: `lease-${sending.id}`,
      fromEmail: 'no-reply@notifications.evorto.app',
      fromName: 'Evorto',
      html: '<p>Sending operational test email</p>',
      id: sending.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${sending.id}`,
      kind: 'manualApproval',
      lastAttemptAt: priorAttempt,
      maxAttempts: 8,
      nextAttemptAt: futureAttempt,
      status: 'sending',
      subject: sending.subject,
      tenantId: tenant.id,
      text: 'Sending operational test email',
      toEmail: sending.recipient,
    },
    {
      attempts: 8,
      exhaustedAt: priorAttempt,
      fromEmail: 'no-reply@notifications.evorto.app',
      fromName: 'Evorto',
      html: '<p>Exhausted operational test email</p>',
      id: exhausted.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${exhausted.id}`,
      kind: 'receiptReviewed',
      lastAttemptAt: priorAttempt,
      lastError: 'Recipient address was rejected',
      maxAttempts: 8,
      nextAttemptAt: futureAttempt,
      status: 'failed',
      subject: exhausted.subject,
      tenantId: tenant.id,
      text: 'Exhausted operational test email',
      toEmail: exhausted.recipient,
    },
    {
      attempts: 1,
      fromEmail: 'no-reply@notifications.evorto.app',
      fromName: 'Evorto',
      html: '<p>Sent operational test email</p>',
      id: sent.id,
      idempotencyKey: `outbox-docs/${tenant.id}/${sent.id}`,
      kind: 'manualApproval',
      lastAttemptAt: priorAttempt,
      maxAttempts: 8,
      nextAttemptAt: futureAttempt,
      provider: 'fake',
      providerMessageId: `fake-${sent.id}`,
      sentAt: priorAttempt,
      status: 'sent',
      subject: sent.subject,
      tenantId: tenant.id,
      text: 'Sent operational test email',
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
    exhausted,
    queued,
    retry,
    sending,
    sent,
  };
};
