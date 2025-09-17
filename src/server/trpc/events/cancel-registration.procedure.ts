import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import {
  CancelRegistrationInputSchema,
  CancellationResultSchema,
} from '../../../shared/schemas/cancellation';
import type { CancellationPolicy, PolicyVariant } from '../../../types/cancellation';
import { stripe } from '../../stripe-client';
import { authenticatedProcedure } from '../trpc-server';

function calculateCutoffTime(policy: CancellationPolicy, eventStart: Date): Date {
  const cutoffTime = new Date(eventStart);
  cutoffTime.setDate(cutoffTime.getDate() - policy.cutoffDays);
  cutoffTime.setHours(cutoffTime.getHours() - policy.cutoffHours);
  return cutoffTime;
}

function getPolicyVariant(isPaid: boolean, organizingRegistration: boolean): PolicyVariant {
  if (isPaid && organizingRegistration) return 'paid-organizer';
  if (isPaid && !organizingRegistration) return 'paid-regular';
  if (!isPaid && organizingRegistration) return 'free-organizer';
  return 'free-regular';
}

export const cancelRegistrationProcedure = authenticatedProcedure
  .input(Schema.standardSchemaV1(CancelRegistrationInputSchema))
  .mutation(async ({ ctx, input }) => {
    // Find the registration with all needed relations
    const registration = await database.query.eventRegistrations.findFirst({
      where: {
        id: input.registrationId,
        tenantId: ctx.tenant.id,
      },
      with: {
        registrationOption: true,
        transactions: true,
        event: {
          columns: { start: true },
        },
      },
    });

    if (!registration) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Registration not found',
      });
    }

    // Check if registration is already cancelled
    if (registration.status === 'CANCELLED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Registration is already cancelled',
      });
    }

    // Check permissions for cancelling other users' registrations
    const isOwnRegistration = registration.userId === ctx.user.id;
    if (!isOwnRegistration) {
      // TODO: Check if user has 'events:registrations:cancel:any' permission
      // For now, only allow users to cancel their own registrations
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only cancel your own registrations',
      });
    }

    // Get effective cancellation policy
    let effectivePolicy = registration.effectiveCancellationPolicy;
    
    // If no effective policy is stored (legacy registration), calculate it
    if (!effectivePolicy) {
      const tenant = await database.query.tenants.findFirst({
        columns: { cancellationPolicies: true },
        where: { id: ctx.tenant.id },
      });

      const registrationOption = registration.registrationOption!;
      
      if (registrationOption.useTenantCancellationPolicy && tenant?.cancellationPolicies) {
        const variant = getPolicyVariant(registrationOption.isPaid, registrationOption.organizingRegistration);
        effectivePolicy = tenant.cancellationPolicies[variant] || null;
      } else if (registrationOption.cancellationPolicy) {
        effectivePolicy = registrationOption.cancellationPolicy;
      }
    }

    // If no policy found, use default (no cancellation allowed)
    if (!effectivePolicy || !effectivePolicy.allowCancellation) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cancellation is not allowed for this registration',
      });
    }

    // Check if cancellation is within the allowed window
    const cutoffTime = calculateCutoffTime(effectivePolicy, registration.event.start);
    const now = new Date();
    
    if (now > cutoffTime) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The cancellation deadline has passed',
      });
    }

    // Find the latest successful payment transaction
    const paymentTransaction = registration.transactions.find(
      (t) => t.status === 'successful' && t.type === 'registration'
    );

    let refundAmount = 0;
    let refunded = false;
    let includesTransactionFees = false;
    let includesAppFees = false;

    // Handle refund for paid registrations
    if (registration.registrationOption!.isPaid && paymentTransaction && !input.noRefund) {
      // Calculate refund amount based on policy
      refundAmount = paymentTransaction.amount;
      includesTransactionFees = effectivePolicy.includeTransactionFees;
      includesAppFees = effectivePolicy.includeAppFees;

      // If not including fees, subtract them from refund
      if (!includesTransactionFees && paymentTransaction.stripeFee) {
        refundAmount -= paymentTransaction.stripeFee;
      }
      if (!includesAppFees && paymentTransaction.appFee) {
        refundAmount -= paymentTransaction.appFee;
      }

      // Ensure refund amount is not negative
      refundAmount = Math.max(0, refundAmount);

      // Initiate Stripe refund if there's an amount to refund
      if (refundAmount > 0 && paymentTransaction.stripePaymentIntentId) {
        const stripeAccount = ctx.tenant.stripeAccountId;
        if (stripeAccount) {
          try {
            await stripe.refunds.create(
              {
                payment_intent: paymentTransaction.stripePaymentIntentId,
                amount: refundAmount,
                reason: 'requested_by_customer',
              },
              { stripeAccount }
            );
            refunded = true;
          } catch (error) {
            console.error('Stripe refund failed:', error);
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to process refund',
            });
          }
        }
      }
    }

    // Update registration status and add cancellation details
    await database.transaction(async (tx) => {
      await tx
        .update(schema.eventRegistrations)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: input.reason || 'user',
          cancellationReasonNote: input.reasonNote || null,
        })
        .where(eq(schema.eventRegistrations.id, registration.id));

      // Update spot counts
      await tx
        .update(schema.eventRegistrationOptions)
        .set({
          confirmedSpots: registration.registrationOption!.confirmedSpots - 1,
        })
        .where(eq(schema.eventRegistrationOptions.id, registration.registrationOptionId));
    });

    return {
      cancelled: true,
      refunded,
      refundAmount,
      includesTransactionFees,
      includesAppFees,
    };
  });