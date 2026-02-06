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

  const taxRate = await database.query.tenantStripeTaxRates.findFirst({
    where: {
      active: true,
      tenantId: options.tenantId,
    },
  });
  if (!taxRate || options.eventIds.length === 0) {
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
      stripeTaxRateId: taxRate.stripeTaxRateId,
      submittedByUserId: organizerUserId,
      tenantId: options.tenantId,
      totalAmount: 15_00,
    },
    {
      alcoholAmount: 3_00,
      attachmentFileName: 'venue-deposit.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 48_000,
      attachmentStorageKey: `seed://${getId()}`,
      depositAmount: 10_00,
      eventId: eventB ?? eventA,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: now,
      reviewedAt: now,
      reviewedByUserId: reviewerUserId,
      status: 'approved',
      stripeTaxRateId: taxRate.stripeTaxRateId,
      submittedByUserId: organizerUserId,
      tenantId: options.tenantId,
      totalAmount: 25_00,
    },
    {
      alcoholAmount: 2_00,
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
      stripeTaxRateId: taxRate.stripeTaxRateId,
      submittedByUserId: organizerUserId,
      tenantId: options.tenantId,
      totalAmount: 9_50,
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
      stripeTaxRateId: taxRate.stripeTaxRateId,
      submittedByUserId: regularUserId,
      tenantId: options.tenantId,
      totalAmount: 12_50,
    },
  ]);
};
