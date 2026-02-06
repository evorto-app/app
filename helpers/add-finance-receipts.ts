import type { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { eq } from 'drizzle-orm';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

export const addFinanceReceipts = async (
  database: NeonDatabase<Record<string, never>, typeof relations>,
  options: {
    eventIds: string[];
    tenantId: string;
  },
) => {
  const organizerUserId =
    usersToAuthenticate.find((user) => user.roles === 'organizer')?.id ??
    usersToAuthenticate[0].id;
  const regularUserId =
    usersToAuthenticate.find((user) => user.roles === 'user')?.id ??
    usersToAuthenticate[0].id;
  const reviewerUserId =
    usersToAuthenticate.find((user) => user.roles === 'admin')?.id ??
    usersToAuthenticate[0].id;
  if (options.eventIds.length === 0) {
    return;
  }

  await database
    .update(schema.users)
    .set({
      iban: 'DE00123456781234567890',
      paypalEmail: 'organizer-refunds@example.com',
    })
    .where(eq(schema.users.id, organizerUserId));

  const now = new Date();
  const [eventA, eventB, eventC] = options.eventIds;

  await database.insert(schema.financeReceipts).values([
    {
      alcoholAmount: 0,
      attachmentFileName: 'kitchen-supplies.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 42_000,
      attachmentStorageKey: `seed://${getId()}`,
      depositAmount: 0,
      eventId: eventA,
      hasAlcohol: false,
      hasDeposit: false,
      purchaseCountry: 'DE',
      receiptDate: now,
      status: 'submitted',
      submittedByUserId: organizerUserId,
      taxAmount: 250,
      tenantId: options.tenantId,
      totalAmount: 1500,
    },
    {
      alcoholAmount: 300,
      attachmentFileName: 'venue-deposit.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 48_000,
      attachmentStorageKey: `seed://${getId()}`,
      depositAmount: 1000,
      eventId: eventB ?? eventA,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: now,
      reviewedAt: now,
      reviewedByUserId: reviewerUserId,
      status: 'approved',
      submittedByUserId: organizerUserId,
      taxAmount: 400,
      tenantId: options.tenantId,
      totalAmount: 2500,
    },
    {
      alcoholAmount: 200,
      attachmentFileName: 'transport-ticket.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 21_000,
      attachmentStorageKey: `seed://${getId()}`,
      depositAmount: 0,
      eventId: eventC ?? eventA,
      hasAlcohol: true,
      hasDeposit: false,
      purchaseCountry: 'DE',
      receiptDate: now,
      reviewedAt: now,
      reviewedByUserId: reviewerUserId,
      status: 'approved',
      submittedByUserId: organizerUserId,
      taxAmount: 150,
      tenantId: options.tenantId,
      totalAmount: 950,
    },
    {
      alcoholAmount: 0,
      attachmentFileName: 'profile-receipt.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 30_000,
      attachmentStorageKey: `seed://${getId()}`,
      depositAmount: 0,
      eventId: eventA,
      hasAlcohol: false,
      hasDeposit: false,
      purchaseCountry: 'DE',
      receiptDate: now,
      status: 'submitted',
      submittedByUserId: regularUserId,
      taxAmount: 200,
      tenantId: options.tenantId,
      totalAmount: 1250,
    },
  ]);
};
