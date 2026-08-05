import { RpcBadRequestError } from '@shared/errors/rpc-errors';
export { isAllowedReceiptMimeType } from '@shared/finance/receipt-media';
import {
  buildSelectableReceiptCountries,
  normalizeReceiptCountryCode,
  OTHER_RECEIPT_COUNTRY_CODE,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  type FinanceReceiptAmounts,
  isFinanceReceiptCalendarDate,
  validateFinanceReceiptAmounts,
} from '@shared/finance/receipt-values';
import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventRegistrationOptions,
  eventRegistrations,
  financeReceipts,
  financeReceiptUploads,
} from '../../../../../db/schema';
import {
  includesPermission,
  type Permission,
} from '../../../../../shared/permissions/permissions';

interface ReceiptCountryConfigTenant {
  receiptSettings: {
    allowOther: boolean;
    receiptCountries: readonly string[];
  };
}

export const databaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<A, never, Database> =>
  Database.use((database) => operation(database).pipe(Effect.orDie));

export const resolveTenantSelectableReceiptCountries = (
  tenant: ReceiptCountryConfigTenant,
): string[] =>
  buildSelectableReceiptCountries(
    resolveReceiptCountrySettings(tenant.receiptSettings),
  );

export const validateReceiptCountryForTenant = (
  tenant: ReceiptCountryConfigTenant,
  purchaseCountry: string,
): null | string => {
  if (purchaseCountry === OTHER_RECEIPT_COUNTRY_CODE) {
    const receiptCountrySettings = resolveReceiptCountrySettings(
      tenant.receiptSettings,
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

export const ensureValidFinanceReceiptAmounts = Effect.fn(
  'Finance.ensureValidReceiptAmounts',
)(function* (amounts: FinanceReceiptAmounts) {
  const validationError = validateFinanceReceiptAmounts(amounts);
  if (!validationError) {
    return;
  }

  const error = {
    alcoholAmountOutOfRange: {
      message: 'Enter a valid alcohol amount of zero or more.',
      reason: 'invalidAlcoholAmount',
    },
    alcoholFlagContradiction: {
      message:
        'Enter an alcohol amount greater than zero when the receipt includes alcohol; otherwise enter zero.',
      reason: 'alcoholAmountContradiction',
    },
    depositAmountOutOfRange: {
      message: 'Enter a valid deposit amount of zero or more.',
      reason: 'invalidDepositAmount',
    },
    depositAndAlcoholExceedTotal: {
      message:
        'The deposit and alcohol amounts cannot be greater than the receipt total.',
      reason: 'inconsistentAmounts',
    },
    depositFlagContradiction: {
      message:
        'Enter a deposit amount greater than zero when the receipt includes a deposit; otherwise enter zero.',
      reason: 'depositAmountContradiction',
    },
    taxAmountExceedsTotal: {
      message: 'The tax amount cannot be greater than the receipt total.',
      reason: 'taxAmountExceedsTotal',
    },
    taxAmountOutOfRange: {
      message: 'Enter a valid tax amount of zero or more.',
      reason: 'invalidTaxAmount',
    },
    totalAmountOutOfRange: {
      message: 'Enter a valid receipt total greater than zero.',
      reason: 'invalidTotalAmount',
    },
  } as const;

  return yield* new RpcBadRequestError(error[validationError]);
});

export const ensureValidFinanceReceiptCalendarDate = Effect.fn(
  'Finance.ensureValidReceiptCalendarDate',
)(function* (receiptDate: string) {
  if (!isFinanceReceiptCalendarDate(receiptDate)) {
    return yield* new RpcBadRequestError({
      message: 'Enter a valid receipt date.',
      reason: 'invalidReceiptDate',
    });
  }
});

export const financeReceiptView = {
  alcoholAmount: financeReceipts.alcoholAmount,
  attachmentFileName: financeReceipts.attachmentFileName,
  attachmentMimeType: financeReceiptUploads.mimeType,
  attachmentStorageKey: financeReceiptUploads.storageKey,
  attachmentUploadConsumedAt: financeReceiptUploads.consumedAt,
  attachmentUploadedAt: financeReceiptUploads.uploadedAt,
  attachmentUploadedByUserId: financeReceiptUploads.uploadedByUserId,
  attachmentUploadEventId: financeReceiptUploads.eventId,
  attachmentUploadId: financeReceiptUploads.id,
  attachmentUploadStatus: financeReceiptUploads.status,
  attachmentUploadTenantId: financeReceiptUploads.tenantId,
  createdAt: financeReceipts.createdAt,
  currency: financeReceipts.currency,
  depositAmount: financeReceipts.depositAmount,
  eventId: financeReceipts.eventId,
  hasAlcohol: financeReceipts.hasAlcohol,
  hasDeposit: financeReceipts.hasDeposit,
  id: financeReceipts.id,
  purchaseCountry: financeReceipts.purchaseCountry,
  receiptDate: financeReceipts.receiptDate,
  refundedAt: financeReceipts.refundedAt,
  refundTransactionId: financeReceipts.refundTransactionId,
  rejectionReason: financeReceipts.rejectionReason,
  reviewedAt: financeReceipts.reviewedAt,
  status: financeReceipts.status,
  submittedByUserId: financeReceipts.submittedByUserId,
  taxAmount: financeReceipts.taxAmount,
  tenantId: financeReceipts.tenantId,
  totalAmount: financeReceipts.totalAmount,
  updatedAt: financeReceipts.updatedAt,
} as const;

export const normalizeFinanceReceiptBaseRecord = (receipt: {
  alcoholAmount: number;
  attachmentFileName: string;
  attachmentMimeType: string;
  attachmentStorageKey: null | string;
  createdAt: Date;
  currency: 'AUD' | 'CZK' | 'EUR';
  depositAmount: number;
  eventId: string;
  hasAlcohol: boolean;
  hasDeposit: boolean;
  id: string;
  previewImageUrl: null | string;
  purchaseCountry: string;
  receiptDate: string;
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
  currency: receipt.currency,
  depositAmount: receipt.depositAmount,
  eventId: receipt.eventId,
  hasAlcohol: receipt.hasAlcohol,
  hasDeposit: receipt.hasDeposit,
  id: receipt.id,
  previewImageUrl: receipt.previewImageUrl ?? null,
  purchaseCountry: receipt.purchaseCountry,
  receiptDate: receipt.receiptDate,
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
  currency: 'AUD' | 'CZK' | 'EUR';
  id: string;
  method: 'cash' | 'paypal' | 'stripe' | 'transfer';
  status: 'cancelled' | 'pending' | 'successful';
  stripeFee: null | number;
}) => ({
  amount: transaction.amount,
  appFee: transaction.appFee ?? null,
  comment: transaction.comment ?? null,
  createdAt: transaction.createdAt.toISOString(),
  currency: transaction.currency,
  id: transaction.id,
  method: transaction.method,
  status: transaction.status,
  stripeFee: transaction.stripeFee ?? null,
});

export const hasOrganizingRegistrationForEvent = (
  tenantId: string,
  user: { id: string; permissions: readonly Permission[] },
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
          eq(
            eventRegistrationOptions.id,
            eventRegistrations.registrationOptionId,
          ),
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
  user: { id: string; permissions: readonly Permission[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> => {
  if (
    includesPermission('events:organizeAll', user.permissions) ||
    includesPermission('finance:manageReceipts', user.permissions) ||
    includesPermission('finance:approveReceipts', user.permissions) ||
    includesPermission('finance:refundReceipts', user.permissions)
  ) {
    return Effect.succeed(true);
  }

  return hasOrganizingRegistrationForEvent(tenantId, user, eventId);
};

export const canSubmitEventReceipts = (
  tenantId: string,
  user: { id: string; permissions: readonly Permission[] },
  eventId: string,
): Effect.Effect<boolean, never, Database> => {
  if (
    includesPermission('events:organizeAll', user.permissions) ||
    includesPermission('finance:manageReceipts', user.permissions)
  ) {
    return Effect.succeed(true);
  }

  return hasOrganizingRegistrationForEvent(tenantId, user, eventId);
};
