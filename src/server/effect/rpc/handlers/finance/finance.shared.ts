import {
  buildSelectableReceiptCountries,
  normalizeReceiptCountryCode,
  OTHER_RECEIPT_COUNTRY_CODE,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventRegistrationOptions,
  eventRegistrations,
  financeReceipts,
} from '../../../../../db/schema';

interface ReceiptCountryConfigTenant {
  receiptSettings?:
    | null
    | undefined
    | {
        allowOther?: boolean | undefined;
        receiptCountries?: readonly string[] | undefined;
      };
}

export const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.pipe(Effect.flatMap((database) => operation(database).pipe(Effect.orDie)));

export const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

export const resolveTenantSelectableReceiptCountries = (
  tenant: ReceiptCountryConfigTenant,
): string[] =>
  buildSelectableReceiptCountries(
    resolveReceiptCountrySettings(tenant.receiptSettings ?? undefined),
  );

export const validateReceiptCountryForTenant = (
  tenant: ReceiptCountryConfigTenant,
  purchaseCountry: string,
): null | string => {
  if (purchaseCountry === OTHER_RECEIPT_COUNTRY_CODE) {
    const receiptCountrySettings = resolveReceiptCountrySettings(
      tenant.receiptSettings ?? undefined,
    );
    return receiptCountrySettings.allowOther
      ? OTHER_RECEIPT_COUNTRY_CODE
      : null;
  }

  const normalizedCountry = normalizeReceiptCountryCode(purchaseCountry);
  if (!normalizedCountry) {
    return null;
  }

  const allowedCountries = resolveTenantSelectableReceiptCountries(tenant);
  return allowedCountries.includes(normalizedCountry)
    ? normalizedCountry
    : null;
};

export const financeReceiptView = {
  alcoholAmount: financeReceipts.alcoholAmount,
  attachmentFileName: financeReceipts.attachmentFileName,
  attachmentMimeType: financeReceipts.attachmentMimeType,
  attachmentStorageKey: financeReceipts.attachmentStorageKey,
  createdAt: financeReceipts.createdAt,
  depositAmount: financeReceipts.depositAmount,
  eventId: financeReceipts.eventId,
  hasAlcohol: financeReceipts.hasAlcohol,
  hasDeposit: financeReceipts.hasDeposit,
  id: financeReceipts.id,
  previewImageUrl: financeReceipts.previewImageUrl,
  purchaseCountry: financeReceipts.purchaseCountry,
  receiptDate: financeReceipts.receiptDate,
  refundedAt: financeReceipts.refundedAt,
  refundTransactionId: financeReceipts.refundTransactionId,
  rejectionReason: financeReceipts.rejectionReason,
  reviewedAt: financeReceipts.reviewedAt,
  status: financeReceipts.status,
  submittedByUserId: financeReceipts.submittedByUserId,
  taxAmount: financeReceipts.taxAmount,
  totalAmount: financeReceipts.totalAmount,
  updatedAt: financeReceipts.updatedAt,
} as const;

export const normalizeFinanceReceiptBaseRecord = (receipt: {
  alcoholAmount: number;
  attachmentFileName: string;
  attachmentMimeType: string;
  attachmentStorageKey: null | string;
  createdAt: Date;
  depositAmount: number;
  eventId: string;
  hasAlcohol: boolean;
  hasDeposit: boolean;
  id: string;
  previewImageUrl: null | string;
  purchaseCountry: string;
  receiptDate: Date;
  refundedAt: Date | null;
  refundTransactionId: null | string;
  rejectionReason: null | string;
  reviewedAt: Date | null;
  status: 'approved' | 'refunded' | 'rejected' | 'submitted';
  submittedByUserId: string;
  taxAmount: number;
  totalAmount: number;
  updatedAt: Date;
}) => ({
  alcoholAmount: receipt.alcoholAmount,
  attachmentFileName: receipt.attachmentFileName,
  attachmentMimeType: receipt.attachmentMimeType,
  attachmentStorageKey: receipt.attachmentStorageKey ?? null,
  createdAt: receipt.createdAt.toISOString(),
  depositAmount: receipt.depositAmount,
  eventId: receipt.eventId,
  hasAlcohol: receipt.hasAlcohol,
  hasDeposit: receipt.hasDeposit,
  id: receipt.id,
  previewImageUrl: receipt.previewImageUrl ?? null,
  purchaseCountry: receipt.purchaseCountry,
  receiptDate: receipt.receiptDate.toISOString(),
  refundedAt: receipt.refundedAt?.toISOString() ?? null,
  refundTransactionId: receipt.refundTransactionId ?? null,
  rejectionReason: receipt.rejectionReason ?? null,
  reviewedAt: receipt.reviewedAt?.toISOString() ?? null,
  status: receipt.status,
  submittedByUserId: receipt.submittedByUserId,
  taxAmount: receipt.taxAmount,
  totalAmount: receipt.totalAmount,
  updatedAt: receipt.updatedAt.toISOString(),
});

export const normalizeFinanceTransactionRecord = (transaction: {
  amount: number;
  appFee: null | number;
  comment: null | string;
  createdAt: Date;
  id: string;
  method: 'cash' | 'paypal' | 'stripe' | 'transfer';
  status: 'cancelled' | 'pending' | 'successful';
  stripeFee: null | number;
}) => ({
  amount: transaction.amount,
  appFee: transaction.appFee ?? null,
  comment: transaction.comment ?? null,
  createdAt: transaction.createdAt.toISOString(),
  id: transaction.id,
  method: transaction.method,
  status: transaction.status,
  stripeFee: transaction.stripeFee ?? null,
});

export const hasOrganizingRegistrationForEvent = (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> =>
  Effect.gen(function* () {
    const organizerRegistration = yield* databaseEffect((database) =>
      database
        .select({
          id: eventRegistrations.id,
        })
        .from(eventRegistrations)
        .innerJoin(
          eventRegistrationOptions,
          eq(eventRegistrationOptions.id, eventRegistrations.registrationOptionId),
        )
        .where(
          and(
            eq(eventRegistrations.tenantId, tenantId),
            eq(eventRegistrations.userId, user.id),
            eq(eventRegistrations.eventId, eventId),
            eq(eventRegistrations.status, 'CONFIRMED'),
            eq(eventRegistrationOptions.organizingRegistration, true),
          ),
        )
        .limit(1),
    );

    return organizerRegistration.length > 0;
  });

export const canViewEventReceipts = (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> => {
  if (
    user.permissions.includes('events:organizeAll') ||
    user.permissions.includes('finance:manageReceipts') ||
    user.permissions.includes('finance:approveReceipts') ||
    user.permissions.includes('finance:refundReceipts')
  ) {
    return Effect.succeed(true);
  }

  return hasOrganizingRegistrationForEvent(tenantId, user, eventId);
};

export const canSubmitEventReceipts = (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> => {
  if (
    user.permissions.includes('events:organizeAll') ||
    user.permissions.includes('finance:manageReceipts')
  ) {
    return Effect.succeed(true);
  }

  return hasOrganizingRegistrationForEvent(tenantId, user, eventId);
};
