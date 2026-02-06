import { TRPCError } from '@trpc/server';
import { Schema } from 'effect';

import { database } from '../../../db';
import { authenticatedProcedure } from '../trpc-server';

export const registrationScannedProcedure = authenticatedProcedure
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        registrationId: Schema.NonEmptyString,
      }),
    ),
  )
  .query(async ({ ctx, input }) => {
    const registration = await database.query.eventRegistrations.findFirst({
      where: { id: input.registrationId, tenantId: ctx.tenant.id },

      with: {
        event: true,
        registrationOption: true,
        transactions: {
          columns: {
            amount: true,
          },
          where: {
            type: 'registration',
          },
        },
        user: true,
      },
    });
    if (!registration) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Registration with id ${input.registrationId} not found`,
      });
    }
    const sameUserIssue = registration.userId === ctx.user.id;
    const registrationStatusIssue = registration.status !== 'CONFIRMED';
    const allowCheckin = !registrationStatusIssue && !sameUserIssue;
    const discountedTransaction = registration.transactions.find(
      (transaction) =>
        transaction.amount < registration.registrationOption.price,
    );
    const appliedDiscountedPrice =
      registration.appliedDiscountedPrice ?? discountedTransaction?.amount ?? null;
    const appliedDiscountType =
      registration.appliedDiscountType ??
      (appliedDiscountedPrice === null ? null : ('esnCard' as const));
    const basePriceAtRegistration =
      registration.basePriceAtRegistration ??
      (appliedDiscountedPrice === null
        ? null
        : registration.registrationOption.price);
    const discountAmount =
      registration.discountAmount ??
      (appliedDiscountedPrice === null
        ? null
        : registration.registrationOption.price - appliedDiscountedPrice);
    return {
      ...registration,
      allowCheckin,
      appliedDiscountedPrice,
      appliedDiscountType,
      basePriceAtRegistration,
      discountAmount,
      registrationStatusIssue,
      sameUserIssue,
    };
  });
