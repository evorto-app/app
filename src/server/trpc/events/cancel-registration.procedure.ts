import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';
import consola from 'consola';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { stripe } from '../../stripe-client';
import { authenticatedProcedure } from '../trpc-server';
import { CancellationReason, isCancellationAllowed } from '../../../types/cancellation';

export const cancelRegistrationProcedure = authenticatedProcedure
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        registrationId: Schema.NonEmptyString,
        reason: Schema.Literal('user-request', 'no-show', 'duplicate', 'admin-action', 'policy-violation', 'other'),
        reasonNote: Schema.optional(Schema.String),
        skipRefund: Schema.optional(Schema.Boolean), // Admin-only option to skip refund
      }),
    ),
  )
  .mutation(async ({ ctx, input }) => {
    const registration = await database.query.eventRegistrations.findFirst({
      where: {
        id: input.registrationId,
        tenantId: ctx.tenant.id,
      },
      with: {
        event: true,
        registrationOption: true,
        transactions: true,
      },
    });

    if (!registration) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Registration not found',
      });
    }

    // Check if user can cancel this registration
    const isOwnRegistration = registration.userId === ctx.user.id;
    const canCancelAny = ctx.user.permissions.includes('events:registrations:cancel:any');
    const canCancelWithoutRefund = ctx.user.permissions.includes('events:registrations:cancelWithoutRefund');

    if (!isOwnRegistration && !canCancelAny) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to cancel this registration',
      });
    }

    // Check if skip refund is requested by non-authorized user
    if (input.skipRefund && !canCancelWithoutRefund) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to cancel without refund',
      });
    }

    // Only allow cancellation of confirmed registrations
    if (registration.status !== 'CONFIRMED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot cancel registration with status: ${registration.status}`,
      });
    }

    // Check effective cancellation policy
    if (!registration.effectiveCancellationPolicy) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No cancellation policy found for this registration',
      });
    }

    const policy = registration.effectiveCancellationPolicy;
    const currentTime = new Date();
    const eventStart = new Date(registration.event!.start);

    // Check if cancellation is allowed by policy and timing
    if (!isCancellationAllowed(policy, eventStart, currentTime)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cancellation not allowed: either disabled by policy or past cutoff time',
      });
    }

    // Calculate refund if this is a paid registration and refund is not skipped
    let refundAmount = 0;
    let refundTransactionId: string | null = null;
    const shouldRefund = registration.registrationOption!.isPaid && !input.skipRefund;

    if (shouldRefund) {
      // Find the successful payment transaction
      const paymentTransaction = registration.transactions.find(
        (tx) => tx.status === 'successful' && tx.method === 'stripe'
      );

      if (paymentTransaction && paymentTransaction.stripeChargeId) {
        try {
          const stripeAccount = ctx.tenant.stripeAccountId;
          if (!stripeAccount) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Stripe account not found',
            });
          }

          // Calculate refund amount based on policy
          const originalAmount = paymentTransaction.amount || 0;
          const appFee = paymentTransaction.appFee || 0;
          const stripeFee = paymentTransaction.stripeFee || 0;

          // Start with the original amount paid by the user
          refundAmount = originalAmount;

          // Add back fees if policy includes them
          if (policy.includeAppFees) {
            refundAmount += appFee;
          }
          if (policy.includeTransactionFees) {
            refundAmount += stripeFee;
          }

          // Create refund in Stripe
          const refund = await stripe.refunds.create(
            {
              charge: paymentTransaction.stripeChargeId,
              amount: refundAmount,
              reason: 'requested_by_customer',
              metadata: {
                registrationId: registration.id,
                tenantId: ctx.tenant.id,
                refundPolicy: JSON.stringify({
                  includeAppFees: policy.includeAppFees,
                  includeTransactionFees: policy.includeTransactionFees,
                }),
              },
            },
            { stripeAccount }
          );

          // Create refund transaction record
          const refundTransactionData = await database
            .insert(schema.transactions)
            .values({
              amount: refundAmount,
              appFee: policy.includeAppFees ? appFee : 0,
              currency: 'EUR', // TODO: Use tenant currency
              method: 'stripe',
              status: 'successful',
              stripeChargeId: refund.id,
              tenantId: ctx.tenant.id,
              type: 'refund',
              eventRegistrationId: registration.id,
            })
            .returning()
            .then((result) => result[0]);

          refundTransactionId = refundTransactionData.id;

          consola.info('Refund created', {
            registrationId: registration.id,
            refundAmount,
            refundId: refund.id,
            includeAppFees: policy.includeAppFees,
            includeTransactionFees: policy.includeTransactionFees,
          });
        } catch (error) {
          consola.error('Failed to create refund', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to process refund',
          });
        }
      }
    }

    // Update registration status and cancellation details
    await database.transaction(async (tx) => {
      await tx
        .update(schema.eventRegistrations)
        .set({
          status: 'CANCELLED',
          cancelledAt: currentTime,
          cancellationReason: input.reason as CancellationReason,
          cancellationReasonNote: input.reasonNote,
          refundTransactionId,
        })
        .where(eq(schema.eventRegistrations.id, registration.id));

      // Update registration option spots
      if (registration.registrationOption) {
        await tx
          .update(schema.eventRegistrationOptions)
          .set({
            confirmedSpots: Math.max(0, (registration.registrationOption.confirmedSpots || 0) - 1),
          })
          .where(eq(schema.eventRegistrationOptions.id, registration.registrationOptionId));
      }
    });

    consola.info('Registration cancelled', {
      registrationId: registration.id,
      userId: registration.userId,
      reason: input.reason,
      refundAmount,
      skipRefund: input.skipRefund,
      actor: ctx.user.id,
    });

    return {
      success: true,
      refundAmount,
      refundIncludesTransactionFees: shouldRefund ? policy.includeTransactionFees : false,
      refundIncludesAppFees: shouldRefund ? policy.includeAppFees : false,
    };
  });