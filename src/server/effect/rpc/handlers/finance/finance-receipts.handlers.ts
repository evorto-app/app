import {
  RpcBadRequestError,
  RpcForbiddenError,
} from '@shared/errors/rpc-errors';
import { resolveFinanceReimbursementBatch } from '@shared/finance/reimbursement';
import { isCanonicalIban } from '@shared/iban';
import { isCanonicalEmailAddress } from '@shared/notification-email';
import {
  FinanceReceiptNotFoundError,
  FinanceResourceNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/finance.errors';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  TransactionRollbackError,
} from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database, type DatabaseClient } from '../../../../../db';
import {
  eventInstances,
  financeReceipts,
  financeReceiptUploads,
  transactions,
  users,
} from '../../../../../db/schema';
import { enqueueReceiptReviewedEmail } from '../../../../notifications/email-delivery';
import { tenantOutboundUrl } from '../../../../tenant-outbound-url';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  canSubmitEventReceipts,
  canViewEventReceipts,
  databaseEffect,
  ensureValidFinanceReceiptAmounts,
  ensureValidFinanceReceiptCalendarDate,
  financeReceiptView,
  isAllowedReceiptMimeType,
  normalizeFinanceReceiptBaseRecord,
  validateReceiptCountryForTenant,
} from './finance.shared';
import {
  ensureReceiptEvidenceAvailableForApproval,
  hasValidReceiptUploadBinding,
  withoutSignedReceiptPreviewUrl,
  withSignedReceiptPreviewUrl,
  withSignedReceiptPreviewUrls,
} from './receipt-media.service';

const financeDatabaseEffect = <A>(
  operation: (database: DatabaseClient) => Effect.Effect<A, unknown, never>,
): Effect.Effect<
  A,
  | FinanceReceiptNotFoundError
  | FinanceResourceNotFoundError
  | RpcBadRequestError,
  Database
> =>
  Database.use((database) =>
    operation(database).pipe(
      Effect.catch((error) =>
        error instanceof FinanceReceiptNotFoundError ||
        error instanceof FinanceResourceNotFoundError ||
        error instanceof RpcBadRequestError
          ? Effect.fail(error)
          : Effect.die(error),
      ),
    ),
  );

const isTransactionRollbackError = (
  error: unknown,
): error is TransactionRollbackError =>
  error instanceof TransactionRollbackError;

const financeReceiptUploadJoin = and(
  eq(financeReceipts.attachmentUploadId, financeReceiptUploads.id),
  eq(financeReceipts.tenantId, financeReceiptUploads.tenantId),
  eq(financeReceipts.eventId, financeReceiptUploads.eventId),
  eq(financeReceipts.submittedByUserId, financeReceiptUploads.uploadedByUserId),
);

const loadReceiptEvidenceForApproval = Effect.fn(
  'FinanceReceipts.loadReceiptEvidenceForApproval',
)(function* (tenantId: string, receiptId: string) {
  const receiptRows = yield* databaseEffect((database) =>
    database
      .select(financeReceiptView)
      .from(financeReceipts)
      .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
      .where(
        and(
          eq(financeReceipts.id, receiptId),
          eq(financeReceipts.tenantId, tenantId),
        ),
      )
      .limit(1),
  );
  const receipt = receiptRows[0];
  if (!receipt) {
    return yield* new FinanceReceiptNotFoundError({
      id: receiptId,
      message:
        'This receipt could not be found. No review was saved. Return to the receipt list and choose another receipt.',
      resource: 'receipt',
    });
  }
  if (receipt.status !== 'submitted') {
    return yield* new RpcBadRequestError({
      message:
        receipt.status === 'refunded'
          ? 'Refunded receipts cannot be reviewed again.'
          : 'Only receipts awaiting review can be reviewed.',
      reason:
        receipt.status === 'refunded'
          ? 'refundedReceipt'
          : 'receiptAlreadyReviewed',
    });
  }

  return yield* ensureReceiptEvidenceAvailableForApproval(receipt);
});

export const financeReceiptsHandlers = {
  'finance.receipts.byEvent': ({ eventId }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const canView = yield* canViewEventReceipts(tenant.id, user, eventId);
      if (!canView) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message:
              'You do not have permission to view receipts for this event.',
            permission: `finance:viewReceipts:${eventId}`,
          }),
        );
      }

      const receipts = yield* databaseEffect((database) =>
        database
          .select({
            ...financeReceiptView,
            submittedByCommunicationEmail: users.communicationEmail,
            submittedByFirstName: users.firstName,
            submittedByLastName: users.lastName,
          })
          .from(financeReceipts)
          .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
          .innerJoin(users, eq(financeReceipts.submittedByUserId, users.id))
          .where(
            and(
              eq(financeReceipts.tenantId, tenant.id),
              eq(financeReceipts.eventId, eventId),
            ),
          )
          .orderBy(desc(financeReceipts.createdAt)),
      );
      const signedReceipts = yield* withSignedReceiptPreviewUrls(receipts);

      return signedReceipts.map((receipt) => ({
        ...normalizeFinanceReceiptBaseRecord(receipt),
        submittedByEmail: receipt.submittedByCommunicationEmail,
        submittedByFirstName: receipt.submittedByFirstName,
        submittedByLastName: receipt.submittedByLastName,
      }));
    }),
  'finance.receipts.createRefund': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('finance:refundReceipts');
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const receiptIds = [...new Set(input.receiptIds)];
      if (receiptIds.length !== input.receiptIds.length) {
        return yield* new RpcBadRequestError({
          message: 'The same receipt was selected more than once.',
          reason: 'duplicateReceiptIds',
        });
      }

      return yield* financeDatabaseEffect((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const receipts = yield* tx
              .select({
                currency: financeReceipts.currency,
                eventId: financeReceipts.eventId,
                id: financeReceipts.id,
                submittedByUserId: financeReceipts.submittedByUserId,
                totalAmount: financeReceipts.totalAmount,
              })
              .from(financeReceipts)
              .where(
                and(
                  eq(financeReceipts.tenantId, tenant.id),
                  inArray(financeReceipts.id, receiptIds),
                  eq(financeReceipts.status, 'approved'),
                ),
              )
              .orderBy(financeReceipts.id)
              .for('update');
            if (receipts.length !== receiptIds.length) {
              return yield* new RpcBadRequestError({
                message:
                  'One or more selected receipts are no longer available. No reimbursement was recorded. Return to the reimbursement list and select the current receipts.',
                reason: 'receiptCountMismatch',
              });
            }

            const reimbursementBatch =
              resolveFinanceReimbursementBatch(receipts);
            if (reimbursementBatch.error) {
              return yield* new RpcBadRequestError(reimbursementBatch.error);
            }
            const {
              currency: receiptCurrency,
              targetUserId,
              totalAmount,
            } = reimbursementBatch;

            const payoutUsers = yield* tx
              .select({
                iban: users.iban,
                id: users.id,
                paypalEmail: users.paypalEmail,
              })
              .from(users)
              .where(eq(users.id, targetUserId))
              .for('share');
            const payoutUser = payoutUsers[0];
            if (!payoutUser) {
              return yield* new FinanceResourceNotFoundError({
                id: targetUserId,
                message:
                  'The person receiving this reimbursement could not be found. No reimbursement was recorded. Return to the reimbursement list and select the current receipts.',
                resource: 'payoutUser',
              });
            }
            if (input.payoutType === 'iban') {
              const iban = payoutUser.iban;
              if (!iban) {
                return yield* new RpcBadRequestError({
                  message:
                    'The person receiving this reimbursement has no IBAN saved.',
                  reason: 'missingIban',
                });
              }
              if (
                !isCanonicalIban(input.payoutReference) ||
                !isCanonicalIban(iban)
              ) {
                return yield* new RpcBadRequestError({
                  message:
                    'The saved IBAN for this reimbursement is not valid.',
                  reason: 'invalidIban',
                });
              }
              if (input.payoutReference !== iban) {
                return yield* new RpcBadRequestError({
                  message:
                    'The payment details changed, so no reimbursement was recorded. Return to the receipt list and review the current payment details before trying again.',
                  reason: 'payoutReferenceMismatch',
                });
              }
            } else {
              const paypalEmail = payoutUser.paypalEmail;
              if (!paypalEmail) {
                return yield* new RpcBadRequestError({
                  message:
                    'The person receiving this reimbursement has no PayPal email address saved.',
                  reason: 'missingPaypal',
                });
              }
              if (
                !isCanonicalEmailAddress(input.payoutReference) ||
                !isCanonicalEmailAddress(paypalEmail)
              ) {
                return yield* new RpcBadRequestError({
                  message:
                    'The saved PayPal email address for this reimbursement is not valid.',
                  reason: 'invalidPaypal',
                });
              }
              if (input.payoutReference !== paypalEmail) {
                return yield* new RpcBadRequestError({
                  message:
                    'The payment details changed, so no reimbursement was recorded. Return to the receipt list and review the current payment details before trying again.',
                  reason: 'payoutReferenceMismatch',
                });
              }
            }

            const uniqueEventIds = [
              ...new Set(receipts.map((receipt) => receipt.eventId)),
            ];
            const eventId =
              uniqueEventIds.length === 1 ? uniqueEventIds[0] : null;
            const insertedTransactions = yield* tx
              .insert(transactions)
              .values({
                amount: -Math.abs(totalAmount),
                comment: `Receipt reimbursement via ${
                  input.payoutType === 'paypal' ? 'PayPal' : 'bank transfer'
                } for ${receiptIds.length} ${
                  receiptIds.length === 1 ? 'receipt' : 'receipts'
                } across ${uniqueEventIds.length} ${
                  uniqueEventIds.length === 1 ? 'event' : 'events'
                }`,
                currency: receiptCurrency,
                eventId,
                executiveUserId: user.id,
                manuallyCreated: true,
                method: input.payoutType === 'paypal' ? 'paypal' : 'transfer',
                status: 'successful',
                targetUserId,
                tenantId: tenant.id,
                type: 'refund',
              })
              .returning({
                id: transactions.id,
              });
            const createdTransaction = insertedTransactions[0];
            if (!createdTransaction) {
              return yield* Effect.die(
                new Error(
                  `Refund transaction insert returned no rows for target user ${targetUserId}`,
                ),
              );
            }

            const updatedReceipts = yield* tx
              .update(financeReceipts)
              .set({
                refundedAt: new Date(),
                refundedByUserId: user.id,
                refundTransactionId: createdTransaction.id,
                status: 'refunded',
              })
              .where(
                and(
                  eq(financeReceipts.tenantId, tenant.id),
                  inArray(financeReceipts.id, receiptIds),
                  eq(financeReceipts.status, 'approved'),
                  eq(financeReceipts.submittedByUserId, targetUserId),
                ),
              )
              .returning({
                id: financeReceipts.id,
              });

            if (updatedReceipts.length !== receiptIds.length) {
              return yield* new RpcBadRequestError({
                message:
                  'The selected receipts changed while this page was open. No reimbursement was recorded. Return to the reimbursement list and review the current selection.',
                reason: 'receiptRefundPreconditionFailed',
              });
            }

            return {
              receiptCount: receiptIds.length,
              totalAmount,
              transactionId: createdTransaction.id,
            };
          }),
        ),
      );
    }),
  'finance.receipts.findOneForApproval': ({ id }, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('finance:approveReceipts');
      const { tenant } = yield* RpcAccess.current();
      const receipts = yield* databaseEffect((database) =>
        database
          .select({
            ...financeReceiptView,
            eventStart: eventInstances.start,
            eventTitle: eventInstances.title,
            submittedByCommunicationEmail: users.communicationEmail,
            submittedByFirstName: users.firstName,
            submittedByLastName: users.lastName,
          })
          .from(financeReceipts)
          .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
          .innerJoin(
            eventInstances,
            eq(financeReceipts.eventId, eventInstances.id),
          )
          .innerJoin(users, eq(financeReceipts.submittedByUserId, users.id))
          .where(
            and(
              eq(financeReceipts.tenantId, tenant.id),
              eq(financeReceipts.id, id),
            ),
          )
          .limit(1),
      );
      const receipt = receipts[0];
      if (!receipt) {
        return yield* Effect.fail(
          new FinanceReceiptNotFoundError({
            id,
            message:
              'This receipt could not be found. No review was saved. Return to the receipt list and choose another receipt.',
          }),
        );
      }

      const signedReceipt = yield* withSignedReceiptPreviewUrl(receipt);

      return {
        ...normalizeFinanceReceiptBaseRecord(signedReceipt),
        eventStart: signedReceipt.eventStart.toISOString(),
        eventTitle: signedReceipt.eventTitle,
        receiptEvidenceAvailable: signedReceipt.receiptEvidenceAvailable,
        submittedByEmail: signedReceipt.submittedByCommunicationEmail,
        submittedByFirstName: signedReceipt.submittedByFirstName,
        submittedByLastName: signedReceipt.submittedByLastName,
      };
    }),
  'finance.receipts.my': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const receipts = yield* databaseEffect((database) =>
        database
          .select({
            ...financeReceiptView,
            eventStart: eventInstances.start,
            eventTitle: eventInstances.title,
          })
          .from(financeReceipts)
          .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
          .innerJoin(
            eventInstances,
            eq(financeReceipts.eventId, eventInstances.id),
          )
          .where(
            and(
              eq(financeReceipts.tenantId, tenant.id),
              eq(financeReceipts.submittedByUserId, user.id),
            ),
          )
          .orderBy(desc(financeReceipts.createdAt)),
      );

      return receipts.map((receipt) => {
        const receiptWithoutPreview = withoutSignedReceiptPreviewUrl(receipt);
        return {
          ...normalizeFinanceReceiptBaseRecord(receiptWithoutPreview),
          eventStart: receiptWithoutPreview.eventStart.toISOString(),
          eventTitle: receiptWithoutPreview.eventTitle,
        };
      });
    }),
  'finance.receipts.pendingApprovalGrouped': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('finance:approveReceipts');
      const { tenant } = yield* RpcAccess.current();
      const pendingReceipts = yield* databaseEffect((database) =>
        database
          .select({
            ...financeReceiptView,
            eventStart: eventInstances.start,
            eventTitle: eventInstances.title,
            submittedByCommunicationEmail: users.communicationEmail,
            submittedByFirstName: users.firstName,
            submittedByLastName: users.lastName,
          })
          .from(financeReceipts)
          .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
          .innerJoin(
            eventInstances,
            eq(financeReceipts.eventId, eventInstances.id),
          )
          .innerJoin(users, eq(financeReceipts.submittedByUserId, users.id))
          .where(
            and(
              eq(financeReceipts.tenantId, tenant.id),
              eq(financeReceipts.status, 'submitted'),
            ),
          )
          .orderBy(desc(eventInstances.start), desc(financeReceipts.createdAt)),
      );

      const groupedByEvent = new Map<
        string,
        {
          eventId: string;
          eventStart: string;
          eventTitle: string;
          receipts: (ReturnType<typeof normalizeFinanceReceiptBaseRecord> & {
            submittedByEmail: string;
            submittedByFirstName: string;
            submittedByLastName: string;
          })[];
        }
      >();

      for (const storedReceipt of pendingReceipts) {
        const receipt = withoutSignedReceiptPreviewUrl(storedReceipt);
        const existing = groupedByEvent.get(receipt.eventId);
        const normalizedReceipt = {
          ...normalizeFinanceReceiptBaseRecord(receipt),
          submittedByEmail: receipt.submittedByCommunicationEmail,
          submittedByFirstName: receipt.submittedByFirstName,
          submittedByLastName: receipt.submittedByLastName,
        };

        if (existing) {
          existing.receipts.push(normalizedReceipt);
          continue;
        }

        groupedByEvent.set(receipt.eventId, {
          eventId: receipt.eventId,
          eventStart: receipt.eventStart.toISOString(),
          eventTitle: receipt.eventTitle,
          receipts: [normalizedReceipt],
        });
      }

      return [...groupedByEvent.values()];
    }),
  'finance.receipts.refundableGroupedByRecipient': (_payload, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('finance:refundReceipts');
      const { tenant } = yield* RpcAccess.current();
      const approvedReceipts = yield* databaseEffect((database) =>
        database
          .select({
            ...financeReceiptView,
            eventStart: eventInstances.start,
            eventTitle: eventInstances.title,
            recipientIban: users.iban,
            recipientPaypalEmail: users.paypalEmail,
            submittedByCommunicationEmail: users.communicationEmail,
            submittedByFirstName: users.firstName,
            submittedByLastName: users.lastName,
          })
          .from(financeReceipts)
          .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
          .innerJoin(
            eventInstances,
            eq(financeReceipts.eventId, eventInstances.id),
          )
          .innerJoin(users, eq(financeReceipts.submittedByUserId, users.id))
          .where(
            and(
              eq(financeReceipts.tenantId, tenant.id),
              eq(financeReceipts.status, 'approved'),
            ),
          )
          .orderBy(
            users.lastName,
            users.firstName,
            desc(financeReceipts.createdAt),
          ),
      );
      const signedApprovedReceipts =
        yield* withSignedReceiptPreviewUrls(approvedReceipts);

      const groupedByUser = new Map<
        string,
        {
          currency: 'AUD' | 'CZK' | 'EUR';
          payout: {
            iban: null | string;
            paypalEmail: null | string;
          };
          receipts: {
            alcoholAmount: number;
            attachmentFileName: string;
            attachmentMimeType: string;
            attachmentStorageKey: null | string;
            createdAt: string;
            currency: 'AUD' | 'CZK' | 'EUR';
            depositAmount: number;
            eventId: string;
            eventStart: string;
            eventTitle: string;
            hasAlcohol: boolean;
            hasDeposit: boolean;
            id: string;
            previewImageUrl: null | string;
            purchaseCountry: string;
            receiptDate: string;
            recipientIban: null | string;
            recipientPaypalEmail: null | string;
            refundedAt: null | string;
            refundTransactionId: null | string;
            rejectionReason: null | string;
            reviewedAt: null | string;
            status: 'approved' | 'refunded' | 'rejected' | 'submitted';
            submittedByEmail: string;
            submittedByFirstName: string;
            submittedByLastName: string;
            submittedByUserId: string;
            taxAmount: number;
            totalAmount: number;
            updatedAt: string;
          }[];
          submittedByEmail: string;
          submittedByFirstName: string;
          submittedByLastName: string;
          submittedByUserId: string;
          totalAmount: number;
        }
      >();

      for (const receipt of signedApprovedReceipts) {
        const normalizedReceipt = {
          ...normalizeFinanceReceiptBaseRecord(receipt),
          eventStart: receipt.eventStart.toISOString(),
          eventTitle: receipt.eventTitle,
          recipientIban: receipt.recipientIban ?? null,
          recipientPaypalEmail: receipt.recipientPaypalEmail ?? null,
          submittedByEmail: receipt.submittedByCommunicationEmail,
          submittedByFirstName: receipt.submittedByFirstName,
          submittedByLastName: receipt.submittedByLastName,
        };

        const groupKey = `${receipt.submittedByUserId}\u{0}${receipt.currency}`;
        const existing = groupedByUser.get(groupKey);
        if (existing) {
          existing.receipts.push(normalizedReceipt);
          existing.totalAmount += receipt.totalAmount;
          continue;
        }

        groupedByUser.set(groupKey, {
          currency: receipt.currency,
          payout: {
            iban: receipt.recipientIban ?? null,
            paypalEmail: receipt.recipientPaypalEmail ?? null,
          },
          receipts: [normalizedReceipt],
          submittedByEmail: receipt.submittedByCommunicationEmail,
          submittedByFirstName: receipt.submittedByFirstName,
          submittedByLastName: receipt.submittedByLastName,
          submittedByUserId: receipt.submittedByUserId,
          totalAmount: receipt.totalAmount,
        });
      }

      return [...groupedByUser.values()];
    }),
  'finance.receipts.review': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('finance:approveReceipts');
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      yield* ensureValidFinanceReceiptAmounts(input);
      yield* ensureValidFinanceReceiptCalendarDate(input.receiptDate);
      const purchaseCountry = validateReceiptCountryForTenant(
        tenant,
        input.purchaseCountry,
      );
      if (!purchaseCountry) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Choose an available purchase country.',
            reason: 'invalidPurchaseCountry',
          }),
        );
      }
      if (input.status === 'rejected' && !input.rejectionReason) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Enter a reason for rejecting this receipt.',
            reason: 'missingRejectionReason',
          }),
        );
      }

      const approvalEvidence =
        input.status === 'approved'
          ? yield* loadReceiptEvidenceForApproval(tenant.id, input.id)
          : null;

      return yield* financeDatabaseEffect((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const receiptRows = yield* tx
              .select({
                attachmentUploadId: financeReceipts.attachmentUploadId,
                eventTitle: eventInstances.title,
                id: financeReceipts.id,
                status: financeReceipts.status,
                submittedByCommunicationEmail: users.communicationEmail,
              })
              .from(financeReceipts)
              .innerJoin(users, eq(financeReceipts.submittedByUserId, users.id))
              .innerJoin(
                eventInstances,
                eq(financeReceipts.eventId, eventInstances.id),
              )
              .where(
                and(
                  eq(financeReceipts.id, input.id),
                  eq(financeReceipts.tenantId, tenant.id),
                ),
              )
              .limit(1)
              .for('update', { of: financeReceipts });
            const receiptRecord = receiptRows[0];
            if (!receiptRecord) {
              return yield* new FinanceReceiptNotFoundError({
                id: input.id,
                message:
                  'This receipt could not be found. No review was saved. Return to the receipt list and choose another receipt.',
                resource: 'receipt',
              });
            }
            if (receiptRecord.status !== 'submitted') {
              return yield* new RpcBadRequestError({
                message:
                  receiptRecord.status === 'refunded'
                    ? 'Refunded receipts cannot be reviewed again.'
                    : 'Only receipts awaiting review can be reviewed.',
                reason:
                  receiptRecord.status === 'refunded'
                    ? 'refundedReceipt'
                    : 'receiptAlreadyReviewed',
              });
            }
            if (
              approvalEvidence &&
              receiptRecord.attachmentUploadId !==
                approvalEvidence.attachmentUploadId
            ) {
              return yield* new RpcBadRequestError({
                message:
                  'The receipt file changed while this page was open. No review was saved. Select Back, then open the receipt again before approving it.',
                reason: 'receiptEvidenceUnavailable',
              });
            }
            if (approvalEvidence) {
              const lockedEvidenceRows = yield* tx
                .select(financeReceiptView)
                .from(financeReceipts)
                .innerJoin(financeReceiptUploads, financeReceiptUploadJoin)
                .where(
                  and(
                    eq(financeReceipts.id, input.id),
                    eq(financeReceipts.tenantId, tenant.id),
                    eq(
                      financeReceipts.attachmentUploadId,
                      approvalEvidence.attachmentUploadId,
                    ),
                  ),
                )
                .limit(1)
                .for('share', { of: financeReceiptUploads });
              const lockedEvidence = lockedEvidenceRows[0];
              if (
                !lockedEvidence ||
                !hasValidReceiptUploadBinding(lockedEvidence) ||
                lockedEvidence.attachmentStorageKey !==
                  approvalEvidence.storageKey
              ) {
                return yield* new RpcBadRequestError({
                  message:
                    'The receipt file changed while this page was open. No review was saved. Select Back, then open the receipt again before approving it.',
                  reason: 'receiptEvidenceUnavailable',
                });
              }
            }

            const updatedRows = yield* tx
              .update(financeReceipts)
              .set({
                alcoholAmount: input.alcoholAmount,
                depositAmount: input.depositAmount,
                hasAlcohol: input.hasAlcohol,
                hasDeposit: input.hasDeposit,
                purchaseCountry,
                receiptDate: input.receiptDate,
                rejectionReason:
                  input.status === 'rejected'
                    ? (input.rejectionReason ?? null)
                    : null,
                reviewedAt: new Date(),
                reviewedByUserId: user.id,
                status: input.status,
                taxAmount: input.taxAmount,
                totalAmount: input.totalAmount,
              })
              .where(
                and(
                  eq(financeReceipts.tenantId, tenant.id),
                  eq(financeReceipts.id, input.id),
                  eq(financeReceipts.status, 'submitted'),
                  approvalEvidence
                    ? eq(
                        financeReceipts.attachmentUploadId,
                        approvalEvidence.attachmentUploadId,
                      )
                    : undefined,
                ),
              )
              .returning({
                id: financeReceipts.id,
                status: financeReceipts.status,
              });
            const updated = updatedRows[0];
            if (!updated) {
              return yield* new RpcBadRequestError({
                message:
                  'The receipt changed while this page was open. No review was saved. Select Back, then open the receipt again before reviewing it.',
                reason: 'receiptReviewPreconditionFailed',
              });
            }
            const receiptUrl = yield* tenantOutboundUrl(
              tenant,
              '/profile/receipts',
            ).pipe(Effect.orDie);

            yield* enqueueReceiptReviewedEmail(tx, {
              eventTitle: receiptRecord.eventTitle,
              receiptId: updated.id,
              receiptUrl,
              rejectionReason:
                input.status === 'rejected'
                  ? (input.rejectionReason ?? null)
                  : null,
              status: input.status,
              tenant,
              to: receiptRecord.submittedByCommunicationEmail,
            });

            return {
              id: updated.id,
              status: updated.status,
            };
          }),
        ),
      );
    }),
  'finance.receipts.submit': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const canSubmit = yield* canSubmitEventReceipts(
        tenant.id,
        user,
        input.eventId,
      );
      if (!canSubmit) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message:
              'You do not have permission to submit receipts for this event.',
            permission: `finance:submitReceipts:${input.eventId}`,
          }),
        );
      }
      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: {
            id: true,
          },
          where: {
            id: input.eventId,
            tenantId: tenant.id,
          },
        }),
      );
      if (!event) {
        return yield* Effect.fail(
          new FinanceResourceNotFoundError({
            id: input.eventId,
            message:
              'This event is no longer available, so the receipt was not submitted. Go back and choose an available event before submitting a receipt.',
            resource: 'event',
          }),
        );
      }

      yield* ensureValidFinanceReceiptAmounts(input.fields);
      yield* ensureValidFinanceReceiptCalendarDate(input.fields.receiptDate);
      const purchaseCountry = validateReceiptCountryForTenant(
        tenant,
        input.fields.purchaseCountry,
      );
      if (!purchaseCountry) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Choose an available purchase country.',
            reason: 'invalid_purchase_country',
          }),
        );
      }
      let submissionFailure: null | RpcBadRequestError = null;
      const created = yield* databaseEffect((database) =>
        database.transaction((tx) =>
          Effect.gen(function* () {
            const uploads = yield* tx
              .select({
                id: financeReceiptUploads.id,
                mimeType: financeReceiptUploads.mimeType,
                sizeBytes: financeReceiptUploads.sizeBytes,
              })
              .from(financeReceiptUploads)
              .where(
                and(
                  eq(financeReceiptUploads.id, input.attachment.uploadId),
                  eq(financeReceiptUploads.tenantId, tenant.id),
                  eq(financeReceiptUploads.eventId, input.eventId),
                  eq(financeReceiptUploads.uploadedByUserId, user.id),
                  eq(financeReceiptUploads.status, 'ready'),
                  isNotNull(financeReceiptUploads.uploadedAt),
                  isNull(financeReceiptUploads.consumedAt),
                ),
              )
              .for('update');
            const upload = uploads[0];
            if (
              !upload ||
              !isAllowedReceiptMimeType(upload.mimeType) ||
              upload.sizeBytes <= 0
            ) {
              submissionFailure = new RpcBadRequestError({
                message:
                  'This receipt file is no longer available. Add the file again.',
                reason: 'receipt_upload_unavailable',
              });
              return yield* tx.rollback();
            }

            const existingReceipts = yield* tx
              .select({ id: financeReceipts.id })
              .from(financeReceipts)
              .where(
                eq(
                  financeReceipts.attachmentUploadId,
                  input.attachment.uploadId,
                ),
              )
              .limit(1);
            if (existingReceipts.length > 0) {
              submissionFailure = new RpcBadRequestError({
                message: 'This receipt file has already been submitted.',
                reason: 'receipt_upload_unavailable',
              });
              return yield* tx.rollback();
            }

            const consumedUploads = yield* tx
              .update(financeReceiptUploads)
              .set({ consumedAt: new Date(), status: 'consumed' })
              .where(
                and(
                  eq(financeReceiptUploads.id, upload.id),
                  eq(financeReceiptUploads.tenantId, tenant.id),
                  eq(financeReceiptUploads.eventId, input.eventId),
                  eq(financeReceiptUploads.uploadedByUserId, user.id),
                  eq(financeReceiptUploads.status, 'ready'),
                  isNotNull(financeReceiptUploads.uploadedAt),
                  isNull(financeReceiptUploads.consumedAt),
                ),
              )
              .returning({ id: financeReceiptUploads.id });
            if (consumedUploads.length !== 1) {
              submissionFailure = new RpcBadRequestError({
                message: 'This receipt file has already been submitted.',
                reason: 'receipt_upload_unavailable',
              });
              return yield* tx.rollback();
            }

            const createdReceipts = yield* tx
              .insert(financeReceipts)
              .values({
                alcoholAmount: input.fields.alcoholAmount,
                attachmentFileName: input.attachment.fileName,
                attachmentUploadId: upload.id,
                currency: tenant.currency,
                depositAmount: input.fields.depositAmount,
                eventId: input.eventId,
                hasAlcohol: input.fields.hasAlcohol,
                hasDeposit: input.fields.hasDeposit,
                purchaseCountry,
                receiptDate: input.fields.receiptDate,
                status: 'submitted',
                submittedByUserId: user.id,
                taxAmount: input.fields.taxAmount,
                tenantId: tenant.id,
                totalAmount: input.fields.totalAmount,
              })
              .returning({
                id: financeReceipts.id,
              });
            const createdReceipt = createdReceipts[0];
            if (!createdReceipt) {
              return yield* Effect.die(
                new Error(
                  `Receipt insert returned no rows for event ${input.eventId}`,
                ),
              );
            }

            return createdReceipt;
          }),
        ),
      ).pipe(
        Effect.catchDefect((defect) => {
          if (!isTransactionRollbackError(defect)) {
            return Effect.die(defect);
          }
          return submissionFailure === null
            ? Effect.die(
                new Error(
                  'Receipt submission rollback triggered without a tracked failure',
                ),
              )
            : Effect.fail(submissionFailure);
        }),
      );

      return {
        id: created.id,
      };
    }),
} satisfies Partial<AppRpcHandlers>;
