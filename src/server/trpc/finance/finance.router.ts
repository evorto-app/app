import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, inArray, not } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { authenticatedProcedure, router } from '../trpc-server';

const receiptAttachmentSchema = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  previewImageId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  previewImageUrl: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  sizeBytes: Schema.Number.pipe(Schema.positive()),
  storageKey: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  storageUrl: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

const receiptFieldsSchema = Schema.Struct({
  alcoholAmount: Schema.Number.pipe(Schema.nonNegative()),
  depositAmount: Schema.Number.pipe(Schema.nonNegative()),
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.ValidDateFromSelf,
  stripeTaxRateId: Schema.NonEmptyString,
  totalAmount: Schema.Number.pipe(Schema.nonNegative()),
});

const financeReceiptView = {
  alcoholAmount: schema.financeReceipts.alcoholAmount,
  attachmentFileName: schema.financeReceipts.attachmentFileName,
  attachmentMimeType: schema.financeReceipts.attachmentMimeType,
  createdAt: schema.financeReceipts.createdAt,
  depositAmount: schema.financeReceipts.depositAmount,
  eventId: schema.financeReceipts.eventId,
  hasAlcohol: schema.financeReceipts.hasAlcohol,
  hasDeposit: schema.financeReceipts.hasDeposit,
  id: schema.financeReceipts.id,
  previewImageUrl: schema.financeReceipts.previewImageUrl,
  purchaseCountry: schema.financeReceipts.purchaseCountry,
  receiptDate: schema.financeReceipts.receiptDate,
  refundedAt: schema.financeReceipts.refundedAt,
  refundTransactionId: schema.financeReceipts.refundTransactionId,
  rejectionReason: schema.financeReceipts.rejectionReason,
  reviewedAt: schema.financeReceipts.reviewedAt,
  status: schema.financeReceipts.status,
  stripeTaxRateId: schema.financeReceipts.stripeTaxRateId,
  submittedByUserId: schema.financeReceipts.submittedByUserId,
  totalAmount: schema.financeReceipts.totalAmount,
  updatedAt: schema.financeReceipts.updatedAt,
} as const;

const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  mimeType.startsWith('image/') || mimeType === 'application/pdf';

const canManageEventReceipts = async (
  tenantId: string,
  user: { id: string; permissions: readonly string[] },
  eventId: string,
): Promise<boolean> => {
  if (
    user.permissions.includes('events:organizeAll') ||
    user.permissions.includes('finance:manageReceipts') ||
    user.permissions.includes('finance:approveReceipts') ||
    user.permissions.includes('finance:refundReceipts')
  ) {
    return true;
  }

  const organizerRegistration = await database
    .select({ id: schema.eventRegistrations.id })
    .from(schema.eventRegistrations)
    .innerJoin(
      schema.eventRegistrationOptions,
      eq(
        schema.eventRegistrationOptions.id,
        schema.eventRegistrations.registrationOptionId,
      ),
    )
    .where(
      and(
        eq(schema.eventRegistrations.tenantId, tenantId),
        eq(schema.eventRegistrations.userId, user.id),
        eq(schema.eventRegistrations.eventId, eventId),
        eq(schema.eventRegistrations.status, 'CONFIRMED'),
        eq(schema.eventRegistrationOptions.organizingRegistration, true),
      ),
    )
    .limit(1);

  return organizerRegistration.length > 0;
};

const validateTenantTaxRate = async (
  tenantId: string,
  stripeTaxRateId: string,
): Promise<void> => {
  const tenantTaxRate = await database.query.tenantStripeTaxRates.findFirst({
    where: {
      active: true,
      stripeTaxRateId,
      tenantId,
    },
  });

  if (!tenantTaxRate) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Tax rate is invalid for this tenant',
    });
  }
};

export const financeRouter = router({
  receipts: router({
    byEvent: authenticatedProcedure
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            eventId: Schema.NonEmptyString,
          }),
        ),
      )
      .query(async ({ ctx, input }) => {
        const canManage = await canManageEventReceipts(
          ctx.tenant.id,
          ctx.user,
          input.eventId,
        );

        if (!canManage) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to view receipts for this event',
          });
        }

        return database
          .select({
            ...financeReceiptView,
            submittedByEmail: schema.users.email,
            submittedByFirstName: schema.users.firstName,
            submittedByLastName: schema.users.lastName,
          })
          .from(schema.financeReceipts)
          .innerJoin(
            schema.users,
            eq(schema.financeReceipts.submittedByUserId, schema.users.id),
          )
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              eq(schema.financeReceipts.eventId, input.eventId),
            ),
          )
          .orderBy(desc(schema.financeReceipts.createdAt));
      }),

    createRefund: authenticatedProcedure
      .meta({ requiredPermissions: ['finance:refundReceipts'] })
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            payoutReference: Schema.NonEmptyString,
            payoutType: Schema.Literal('iban', 'paypal'),
            receiptIds: Schema.NonEmptyArray(Schema.NonEmptyString),
          }),
        ),
      )
      .mutation(async ({ ctx, input }) => {
        const receipts = await database
          .select({
            eventId: schema.financeReceipts.eventId,
            id: schema.financeReceipts.id,
            submittedByUserId: schema.financeReceipts.submittedByUserId,
            totalAmount: schema.financeReceipts.totalAmount,
          })
          .from(schema.financeReceipts)
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              inArray(schema.financeReceipts.id, input.receiptIds),
              eq(schema.financeReceipts.status, 'approved'),
            ),
          );

        if (receipts.length !== input.receiptIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only approved receipts can be refunded',
          });
        }

        const targetUserId = receipts[0].submittedByUserId;
        if (receipts.some((receipt) => receipt.submittedByUserId !== targetUserId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Refunds must target one recipient at a time',
          });
        }

        const payoutUser = await database.query.users.findFirst({
          columns: {
            iban: true,
            id: true,
            paypalEmail: true,
          },
          where: {
            id: targetUserId,
          },
        });

        if (!payoutUser) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Recipient not found',
          });
        }

        if (input.payoutType === 'iban' && !payoutUser.iban) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Recipient has no IBAN configured',
          });
        }

        if (input.payoutType === 'paypal' && !payoutUser.paypalEmail) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Recipient has no PayPal email configured',
          });
        }

        const totalAmount = receipts.reduce(
          (sum, receipt) => sum + receipt.totalAmount,
          0,
        );
        const uniqueEventIds = [...new Set(receipts.map((r) => r.eventId))];
        const eventId = uniqueEventIds.length === 1 ? uniqueEventIds[0] : null;

        const [transaction] = await database
          .insert(schema.transactions)
          .values({
            amount: -Math.abs(totalAmount),
            comment: `Receipt refund (${input.payoutType} ${input.payoutReference}) for ${receipts.length} receipt(s) across events: ${uniqueEventIds.join(', ')}`,
            currency: ctx.tenant.currency,
            eventId,
            executiveUserId: ctx.user.id,
            manuallyCreated: true,
            method: input.payoutType === 'paypal' ? 'paypal' : 'transfer',
            status: 'successful',
            targetUserId,
            tenantId: ctx.tenant.id,
            type: 'refund',
          })
          .returning();

        await database
          .update(schema.financeReceipts)
          .set({
            refundedAt: new Date(),
            refundedByUserId: ctx.user.id,
            refundTransactionId: transaction.id,
            status: 'refunded',
          })
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              inArray(schema.financeReceipts.id, input.receiptIds),
            ),
          );

        return {
          receiptCount: receipts.length,
          totalAmount,
          transactionId: transaction.id,
        };
      }),

    findOneForApproval: authenticatedProcedure
      .meta({ requiredPermissions: ['finance:approveReceipts'] })
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            id: Schema.NonEmptyString,
          }),
        ),
      )
      .query(async ({ ctx, input }) => {
        const [receipt] = await database
          .select({
            ...financeReceiptView,
            eventStart: schema.eventInstances.start,
            eventTitle: schema.eventInstances.title,
            submittedByEmail: schema.users.email,
            submittedByFirstName: schema.users.firstName,
            submittedByLastName: schema.users.lastName,
          })
          .from(schema.financeReceipts)
          .innerJoin(
            schema.eventInstances,
            eq(schema.financeReceipts.eventId, schema.eventInstances.id),
          )
          .innerJoin(
            schema.users,
            eq(schema.financeReceipts.submittedByUserId, schema.users.id),
          )
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              eq(schema.financeReceipts.id, input.id),
            ),
          )
          .limit(1);

        if (!receipt) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Receipt not found',
          });
        }

        return receipt;
      }),

    my: authenticatedProcedure.query(async ({ ctx }) => {
      return database
        .select({
          ...financeReceiptView,
          eventStart: schema.eventInstances.start,
          eventTitle: schema.eventInstances.title,
        })
        .from(schema.financeReceipts)
        .innerJoin(
          schema.eventInstances,
          eq(schema.financeReceipts.eventId, schema.eventInstances.id),
        )
        .where(
          and(
            eq(schema.financeReceipts.tenantId, ctx.tenant.id),
            eq(schema.financeReceipts.submittedByUserId, ctx.user.id),
          ),
        )
        .orderBy(desc(schema.financeReceipts.createdAt));
    }),

    pendingApprovalGrouped: authenticatedProcedure
      .meta({ requiredPermissions: ['finance:approveReceipts'] })
      .query(async ({ ctx }) => {
        const pendingReceipts = await database
          .select({
            ...financeReceiptView,
            eventStart: schema.eventInstances.start,
            eventTitle: schema.eventInstances.title,
            submittedByEmail: schema.users.email,
            submittedByFirstName: schema.users.firstName,
            submittedByLastName: schema.users.lastName,
          })
          .from(schema.financeReceipts)
          .innerJoin(
            schema.eventInstances,
            eq(schema.financeReceipts.eventId, schema.eventInstances.id),
          )
          .innerJoin(
            schema.users,
            eq(schema.financeReceipts.submittedByUserId, schema.users.id),
          )
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              eq(schema.financeReceipts.status, 'submitted'),
            ),
          )
          .orderBy(
            desc(schema.eventInstances.start),
            desc(schema.financeReceipts.createdAt),
          );

        const groupedByEvent = new Map<
          string,
          {
            eventId: string;
            eventStart: Date;
            eventTitle: string;
            receipts: typeof pendingReceipts;
          }
        >();

        for (const receipt of pendingReceipts) {
          const existing = groupedByEvent.get(receipt.eventId);
          if (existing) {
            existing.receipts.push(receipt);
            continue;
          }
          groupedByEvent.set(receipt.eventId, {
            eventId: receipt.eventId,
            eventStart: receipt.eventStart,
            eventTitle: receipt.eventTitle,
            receipts: [receipt],
          });
        }

        return [...groupedByEvent.values()];
      }),

    refundableGroupedByRecipient: authenticatedProcedure
      .meta({ requiredPermissions: ['finance:refundReceipts'] })
      .query(async ({ ctx }) => {
        const approvedReceipts = await database
          .select({
            ...financeReceiptView,
            eventStart: schema.eventInstances.start,
            eventTitle: schema.eventInstances.title,
            recipientIban: schema.users.iban,
            recipientPaypalEmail: schema.users.paypalEmail,
            submittedByEmail: schema.users.email,
            submittedByFirstName: schema.users.firstName,
            submittedByLastName: schema.users.lastName,
          })
          .from(schema.financeReceipts)
          .innerJoin(
            schema.eventInstances,
            eq(schema.financeReceipts.eventId, schema.eventInstances.id),
          )
          .innerJoin(
            schema.users,
            eq(schema.financeReceipts.submittedByUserId, schema.users.id),
          )
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              eq(schema.financeReceipts.status, 'approved'),
            ),
          )
          .orderBy(
            schema.users.lastName,
            schema.users.firstName,
            desc(schema.financeReceipts.createdAt),
          );

        const groupedByUser = new Map<
          string,
          {
            payout: {
              iban: null | string;
              paypalEmail: null | string;
            };
            receipts: typeof approvedReceipts;
            submittedByEmail: string;
            submittedByFirstName: string;
            submittedByLastName: string;
            submittedByUserId: string;
            totalAmount: number;
          }
        >();

        for (const receipt of approvedReceipts) {
          const existing = groupedByUser.get(receipt.submittedByUserId);
          if (existing) {
            existing.receipts.push(receipt);
            existing.totalAmount += receipt.totalAmount;
            continue;
          }

          groupedByUser.set(receipt.submittedByUserId, {
            payout: {
              iban: receipt.recipientIban,
              paypalEmail: receipt.recipientPaypalEmail,
            },
            receipts: [receipt],
            submittedByEmail: receipt.submittedByEmail,
            submittedByFirstName: receipt.submittedByFirstName,
            submittedByLastName: receipt.submittedByLastName,
            submittedByUserId: receipt.submittedByUserId,
            totalAmount: receipt.totalAmount,
          });
        }

        return [...groupedByUser.values()];
      }),

    review: authenticatedProcedure
      .meta({ requiredPermissions: ['finance:approveReceipts'] })
      .input(
        Schema.standardSchemaV1(
          Schema.extend(
            Schema.Struct({
              id: Schema.NonEmptyString,
              rejectionReason: Schema.optional(
                Schema.NullOr(Schema.NonEmptyString),
              ),
              status: Schema.Literal('approved', 'rejected'),
            }),
            receiptFieldsSchema,
          ),
        ),
      )
      .mutation(async ({ ctx, input }) => {
        const receipt = await database.query.financeReceipts.findFirst({
          where: {
            id: input.id,
            tenantId: ctx.tenant.id,
          },
        });

        if (!receipt) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Receipt not found',
          });
        }

        if (receipt.status === 'refunded') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Refunded receipts cannot be reviewed',
          });
        }

        const depositAmount = input.hasDeposit ? input.depositAmount : 0;
        const alcoholAmount = input.hasAlcohol ? input.alcoholAmount : 0;

        if (depositAmount + alcoholAmount > input.totalAmount) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Deposit and alcohol amounts cannot exceed total amount',
          });
        }

        await validateTenantTaxRate(ctx.tenant.id, input.stripeTaxRateId);

        if (input.status === 'rejected' && !input.rejectionReason) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A rejection reason is required',
          });
        }

        const [updated] = await database
          .update(schema.financeReceipts)
          .set({
            alcoholAmount,
            depositAmount,
            hasAlcohol: input.hasAlcohol,
            hasDeposit: input.hasDeposit,
            purchaseCountry: input.purchaseCountry,
            receiptDate: input.receiptDate,
            rejectionReason:
              input.status === 'rejected' ? (input.rejectionReason ?? null) : null,
            reviewedAt: new Date(),
            reviewedByUserId: ctx.user.id,
            status: input.status,
            stripeTaxRateId: input.stripeTaxRateId,
            totalAmount: input.totalAmount,
          })
          .where(
            and(
              eq(schema.financeReceipts.tenantId, ctx.tenant.id),
              eq(schema.financeReceipts.id, input.id),
            ),
          )
          .returning();

        return updated;
      }),

    submit: authenticatedProcedure
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            attachment: receiptAttachmentSchema,
            eventId: Schema.NonEmptyString,
            fields: receiptFieldsSchema,
          }),
        ),
      )
      .mutation(async ({ ctx, input }) => {
        const canManage = await canManageEventReceipts(
          ctx.tenant.id,
          ctx.user,
          input.eventId,
        );

        if (!canManage) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to submit receipts for this event',
          });
        }

        if (!isAllowedReceiptMimeType(input.attachment.mimeType)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only image and PDF receipts are supported',
          });
        }

        const event = await database.query.eventInstances.findFirst({
          columns: { id: true },
          where: {
            id: input.eventId,
            tenantId: ctx.tenant.id,
          },
        });

        if (!event) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Event not found',
          });
        }

        const depositAmount = input.fields.hasDeposit ? input.fields.depositAmount : 0;
        const alcoholAmount = input.fields.hasAlcohol ? input.fields.alcoholAmount : 0;

        if (depositAmount + alcoholAmount > input.fields.totalAmount) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Deposit and alcohol amounts cannot exceed total amount',
          });
        }

        await validateTenantTaxRate(ctx.tenant.id, input.fields.stripeTaxRateId);

        const [created] = await database
          .insert(schema.financeReceipts)
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
            previewImageId: input.attachment.previewImageId ?? null,
            previewImageUrl: input.attachment.previewImageUrl ?? null,
            purchaseCountry: input.fields.purchaseCountry,
            receiptDate: input.fields.receiptDate,
            status: 'submitted',
            stripeTaxRateId: input.fields.stripeTaxRateId,
            submittedByUserId: ctx.user.id,
            tenantId: ctx.tenant.id,
            totalAmount: input.fields.totalAmount,
          })
          .returning();

        return created;
      }),
  }),

  transactions: router({
    findMany: authenticatedProcedure
      .input(
        Schema.standardSchemaV1(
          Schema.Struct({
            limit: Schema.Number,
            offset: Schema.Number,
          }),
        ),
      )
      .query(async ({ ctx, input }) => {
        const transactionCountResult = await database
          .select({ count: count() })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.tenantId, ctx.tenant.id),
              not(eq(schema.transactions.status, 'cancelled')),
            ),
          );
        const total = transactionCountResult[0].count;

        const transactions = await database
          .select()
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.tenantId, ctx.tenant.id),
              not(eq(schema.transactions.status, 'cancelled')),
            ),
          )
          .limit(input.limit)
          .offset(input.offset)
          .orderBy(desc(schema.transactions.createdAt));

        return { data: transactions, total };
      }),
  }),
});
