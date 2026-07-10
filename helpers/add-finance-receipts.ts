import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buildReceiptStorageKey } from '@server/effect/rpc/handlers/finance/receipt-media.service';

import { createId } from '../src/db/create-id';
import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

export const addFinanceReceipts = async (
  database: NodePgDatabase<typeof relations>,
  options: {
    currency: 'AUD' | 'CZK' | 'EUR';
    eventIds: string[];
    tenantId: string;
  },
) => {
  const regularUserId =
    usersToAuthenticate.find((user) => user.roles === 'user')?.id ??
    usersToAuthenticate[0].id;
  const reviewerUserId =
    usersToAuthenticate.find((user) => user.roles === 'admin')?.id ??
    usersToAuthenticate[0].id;
  if (options.eventIds.length === 0) {
    return;
  }

  const reimbursementUserId = createId();
  await database.insert(schema.users).values({
    auth0Id: `local-finance-${reimbursementUserId}`,
    communicationEmail: `finance-${reimbursementUserId}@example.com`,
    email: `finance-${reimbursementUserId}@example.com`,
    firstName: 'Finance',
    iban: 'DE00123456781234567890',
    id: reimbursementUserId,
    lastName: 'Recipient',
    paypalEmail: 'organizer-refunds@example.com',
  });

  const now = new Date();
  const [eventA, eventB, eventC] = options.eventIds;
  const kitchenSuppliesUploadId = getId();
  const venueDepositUploadId = getId();
  const transportTicketUploadId = getId();
  const profileReceiptUploadId = getId();
  const receiptUploads = [
    {
      eventId: eventA,
      fileName: 'kitchen-supplies.pdf',
      id: kitchenSuppliesUploadId,
      sizeBytes: 42_000,
      uploadedByUserId: reimbursementUserId,
    },
    {
      eventId: eventB ?? eventA,
      fileName: 'venue-deposit.pdf',
      id: venueDepositUploadId,
      sizeBytes: 48_000,
      uploadedByUserId: reimbursementUserId,
    },
    {
      eventId: eventC ?? eventA,
      fileName: 'transport-ticket.pdf',
      id: transportTicketUploadId,
      sizeBytes: 21_000,
      uploadedByUserId: reimbursementUserId,
    },
    {
      eventId: eventA,
      fileName: 'profile-receipt.pdf',
      id: profileReceiptUploadId,
      sizeBytes: 30_000,
      uploadedByUserId: regularUserId,
    },
  ].map((upload) => ({
    ...upload,
    consumedAt: now,
    mimeType: 'application/pdf',
    storageUrl: 'local-unavailable://receipt',
    tenantId: options.tenantId,
    uploadedAt: now,
  }));

  await database.insert(schema.financeReceiptUploads).values(
    receiptUploads.map((upload) => ({
      ...upload,
      storageKey: buildReceiptStorageKey({
        eventId: upload.eventId,
        fileName: upload.fileName,
        tenantId: options.tenantId,
        uploadId: upload.id,
        userId: upload.uploadedByUserId,
      }),
    })),
  );

  await database.insert(schema.financeReceipts).values([
    {
      alcoholAmount: 0,
      attachmentFileName: 'kitchen-supplies.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 42_000,
      attachmentUploadId: kitchenSuppliesUploadId,
      currency: options.currency,
      depositAmount: 0,
      eventId: eventA,
      hasAlcohol: false,
      hasDeposit: false,
      purchaseCountry: 'DE',
      receiptDate: now,
      status: 'submitted',
      submittedByUserId: reimbursementUserId,
      taxAmount: 250,
      tenantId: options.tenantId,
      totalAmount: 1500,
    },
    {
      alcoholAmount: 300,
      attachmentFileName: 'venue-deposit.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 48_000,
      attachmentUploadId: venueDepositUploadId,
      currency: options.currency,
      depositAmount: 1000,
      eventId: eventB ?? eventA,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: now,
      reviewedAt: now,
      reviewedByUserId: reviewerUserId,
      status: 'approved',
      submittedByUserId: reimbursementUserId,
      taxAmount: 400,
      tenantId: options.tenantId,
      totalAmount: 2500,
    },
    {
      alcoholAmount: 200,
      attachmentFileName: 'transport-ticket.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 21_000,
      attachmentUploadId: transportTicketUploadId,
      currency: options.currency,
      depositAmount: 0,
      eventId: eventC ?? eventA,
      hasAlcohol: true,
      hasDeposit: false,
      purchaseCountry: 'DE',
      receiptDate: now,
      reviewedAt: now,
      reviewedByUserId: reviewerUserId,
      status: 'approved',
      submittedByUserId: reimbursementUserId,
      taxAmount: 150,
      tenantId: options.tenantId,
      totalAmount: 950,
    },
    {
      alcoholAmount: 0,
      attachmentFileName: 'profile-receipt.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentSizeBytes: 30_000,
      attachmentUploadId: profileReceiptUploadId,
      currency: options.currency,
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
