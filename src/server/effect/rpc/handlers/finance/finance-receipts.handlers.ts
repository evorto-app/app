import { and, desc, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import {
  eventInstances,
  financeReceipts,
  transactions,
  users,
} from '../../../../../db/schema';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  canSubmitEventReceipts,
  canViewEventReceipts,
  databaseEffect,
  financeReceiptView,
  isAllowedReceiptMimeType,
  normalizeFinanceReceiptBaseRecord,
  validateReceiptCountryForTenant,
} from './finance.shared';
import {
  withSignedReceiptPreviewUrl,
  withSignedReceiptPreviewUrls,
} from './receipt-media.service';

export const financeReceiptsHandlers = {
'finance.receipts.byEvent': ({ eventId }, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();
        const canView = yield* canViewEventReceipts(tenant.id, user, eventId);
        if (!canView) {
          return yield* Effect.fail('FORBIDDEN' as const);
        }

        const receipts = yield* databaseEffect((database) =>
          database
            .select({
              ...financeReceiptView,
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
            .innerJoin(users, eq(financeReceipts.submittedByUserId, users.id))
            .where(
              and(
                eq(financeReceipts.tenantId, tenant.id),
                eq(financeReceipts.eventId, eventId),
              ),
            )
            .orderBy(desc(financeReceipts.createdAt)),
        );
        const signedReceipts = yield* withSignedReceiptPreviewUrls(
          receipts,
        );

        return signedReceipts.map((receipt) => ({
          ...normalizeFinanceReceiptBaseRecord(receipt),
          submittedByEmail: receipt.submittedByEmail,
          submittedByFirstName: receipt.submittedByFirstName,
          submittedByLastName: receipt.submittedByLastName,
        }));
      }),
'finance.receipts.createRefund': (input, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('finance:refundReceipts');
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();
        const receipts = yield* databaseEffect((database) =>
          database
            .select({
              eventId: financeReceipts.eventId,
              id: financeReceipts.id,
              submittedByUserId: financeReceipts.submittedByUserId,
              totalAmount: financeReceipts.totalAmount,
            })
            .from(financeReceipts)
            .where(
              and(
                eq(financeReceipts.tenantId, tenant.id),
                inArray(financeReceipts.id, input.receiptIds),
                eq(financeReceipts.status, 'approved'),
              ),
            ),
        );
        if (receipts.length !== input.receiptIds.length) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const targetUserId = receipts[0]?.submittedByUserId;
        if (!targetUserId) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        if (
          receipts.some((receipt) => receipt.submittedByUserId !== targetUserId)
        ) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const payoutUser = yield* databaseEffect((database) =>
          database.query.users.findFirst({
            columns: {
              iban: true,
              id: true,
              paypalEmail: true,
            },
            where: {
              id: targetUserId,
            },
          }),
        );
        if (!payoutUser) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }
        if (input.payoutType === 'iban' && !payoutUser.iban) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        if (input.payoutType === 'paypal' && !payoutUser.paypalEmail) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const expectedPayoutReference =
          input.payoutType === 'paypal'
            ? payoutUser.paypalEmail
            : payoutUser.iban;
        if (
          !expectedPayoutReference ||
          input.payoutReference !== expectedPayoutReference
        ) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const totalAmount = receipts.reduce(
          (sum, receipt) => sum + receipt.totalAmount,
          0,
        );
        const uniqueEventIds = [
          ...new Set(receipts.map((receipt) => receipt.eventId)),
        ];
        const eventId = uniqueEventIds.length === 1 ? uniqueEventIds[0] : null;

        const createdTransaction = yield* databaseEffect((database) =>
          database.transaction((tx) =>
            Effect.gen(function* () {
              const insertedTransactions = yield* tx
                .insert(transactions)
                .values({
                  amount: -Math.abs(totalAmount),
                  comment: `Receipt refund (${input.payoutType} ${expectedPayoutReference}) for ${receipts.length} receipt(s) across events: ${uniqueEventIds.join(', ')}`,
                  currency: tenant.currency,
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
              const transaction = insertedTransactions[0];
              if (!transaction) {
                return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
              }

              const updatedReceipts = yield* tx
                .update(financeReceipts)
                .set({
                  refundedAt: new Date(),
                  refundedByUserId: user.id,
                  refundTransactionId: transaction.id,
                  status: 'refunded',
                })
                .where(
                  and(
                    eq(financeReceipts.tenantId, tenant.id),
                    inArray(financeReceipts.id, input.receiptIds),
                    eq(financeReceipts.status, 'approved'),
                    eq(financeReceipts.submittedByUserId, targetUserId),
                  ),
                )
                .returning({
                  id: financeReceipts.id,
                });

              if (updatedReceipts.length !== input.receiptIds.length) {
                return yield* Effect.fail('BAD_REQUEST' as const);
              }

              return transaction;
            }),
          ),
        ).pipe(
          Effect.catchAll((error) =>
            error === 'BAD_REQUEST'
              ? Effect.fail('BAD_REQUEST' as const)
              : Effect.fail('INTERNAL_SERVER_ERROR' as const),
          ),
        );

        return {
          receiptCount: receipts.length,
          totalAmount,
          transactionId: createdTransaction.id,
        };
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
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
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
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const signedReceipt = yield* withSignedReceiptPreviewUrl(
          receipt,
        );

        return {
          ...normalizeFinanceReceiptBaseRecord(signedReceipt),
          eventStart: signedReceipt.eventStart.toISOString(),
          eventTitle: signedReceipt.eventTitle,
          submittedByEmail: signedReceipt.submittedByEmail,
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

        return receipts.map((receipt) => ({
          ...normalizeFinanceReceiptBaseRecord(receipt),
          eventStart: receipt.eventStart.toISOString(),
          eventTitle: receipt.eventTitle,
        }));
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
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
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
            .orderBy(
              desc(eventInstances.start),
              desc(financeReceipts.createdAt),
            ),
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

        for (const receipt of pendingReceipts) {
          const existing = groupedByEvent.get(receipt.eventId);
          const normalizedReceipt = {
            ...normalizeFinanceReceiptBaseRecord(receipt),
            submittedByEmail: receipt.submittedByEmail,
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
              submittedByEmail: users.email,
              submittedByFirstName: users.firstName,
              submittedByLastName: users.lastName,
            })
            .from(financeReceipts)
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
          yield* withSignedReceiptPreviewUrls(
            approvedReceipts,
          );

        const groupedByUser = new Map<
          string,
          {
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
            submittedByEmail: receipt.submittedByEmail,
            submittedByFirstName: receipt.submittedByFirstName,
            submittedByLastName: receipt.submittedByLastName,
          };

          const existing = groupedByUser.get(receipt.submittedByUserId);
          if (existing) {
            existing.receipts.push(normalizedReceipt);
            existing.totalAmount += receipt.totalAmount;
            continue;
          }

          groupedByUser.set(receipt.submittedByUserId, {
            payout: {
              iban: receipt.recipientIban ?? null,
              paypalEmail: receipt.recipientPaypalEmail ?? null,
            },
            receipts: [normalizedReceipt],
            submittedByEmail: receipt.submittedByEmail,
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
        const receipt = yield* databaseEffect((database) =>
          database.query.financeReceipts.findFirst({
            columns: {
              id: true,
              status: true,
            },
            where: {
              id: input.id,
              tenantId: tenant.id,
            },
          }),
        );
        if (!receipt) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }
        if (receipt.status === 'refunded') {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const depositAmount = input.hasDeposit ? input.depositAmount : 0;
        const alcoholAmount = input.hasAlcohol ? input.alcoholAmount : 0;
        const purchaseCountry = validateReceiptCountryForTenant(
          tenant,
          input.purchaseCountry,
        );
        if (!purchaseCountry) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        if (depositAmount + alcoholAmount > input.totalAmount) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        if (input.status === 'rejected' && !input.rejectionReason) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const receiptDate = new Date(input.receiptDate);
        if (Number.isNaN(receiptDate.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const updatedReceipts = yield* databaseEffect((database) =>
          database
            .update(financeReceipts)
            .set({
              alcoholAmount,
              depositAmount,
              hasAlcohol: input.hasAlcohol,
              hasDeposit: input.hasDeposit,
              purchaseCountry,
              receiptDate,

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
              ),
            )
            .returning({
              id: financeReceipts.id,
              status: financeReceipts.status,
            }),
        );
        const updated = updatedReceipts[0];
        if (!updated) {
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        return {
          id: updated.id,
          status: updated.status,
        };
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
          return yield* Effect.fail('FORBIDDEN' as const);
        }
        if (!isAllowedReceiptMimeType(input.attachment.mimeType)) {
          return yield* Effect.fail('BAD_REQUEST' as const);
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
          return yield* Effect.fail('NOT_FOUND' as const);
        }

        const depositAmount = input.fields.hasDeposit
          ? input.fields.depositAmount
          : 0;
        const alcoholAmount = input.fields.hasAlcohol
          ? input.fields.alcoholAmount
          : 0;
        const purchaseCountry = validateReceiptCountryForTenant(
          tenant,
          input.fields.purchaseCountry,
        );
        if (!purchaseCountry) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }
        if (depositAmount + alcoholAmount > input.fields.totalAmount) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const receiptDate = new Date(input.fields.receiptDate);
        if (Number.isNaN(receiptDate.getTime())) {
          return yield* Effect.fail('BAD_REQUEST' as const);
        }

        const createdReceipts = yield* databaseEffect((database) =>
          database
            .insert(financeReceipts)
            .values({
              alcoholAmount,
              attachmentFileName: input.attachment.fileName,
              attachmentMimeType: input.attachment.mimeType,
              attachmentSizeBytes: input.attachment.sizeBytes,
              attachmentStorageKey: input.attachment.storageKey ?? null,
              attachmentStorageUrl: input.attachment.storageUrl ?? null,
              depositAmount,
              eventId: input.eventId,
              hasAlcohol: input.fields.hasAlcohol,
              hasDeposit: input.fields.hasDeposit,
              purchaseCountry,
              receiptDate,
              status: 'submitted',
              submittedByUserId: user.id,
              taxAmount: input.fields.taxAmount,
              tenantId: tenant.id,
              totalAmount: input.fields.totalAmount,
            })
            .returning({
              id: financeReceipts.id,
            }),
        );
        const created = createdReceipts[0];
        if (!created) {
          return yield* Effect.fail('INTERNAL_SERVER_ERROR' as const);
        }

        return {
          id: created.id,
        };
      }),
} satisfies Partial<AppRpcHandlers>;
