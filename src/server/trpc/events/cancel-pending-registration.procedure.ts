import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { stripe } from '../../stripe-client';
import { authenticatedProcedure } from '../trpc-server';

export const cancelPendingRegistrationProcedure = authenticatedProcedure
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({ registrationId: Schema.NonEmptyString }),
    ),
  )
  .mutation(async ({ ctx, input }) => {
    const registration = await database.query.eventRegistrations.findFirst({
      where: {
        id: input.registrationId,
        status: 'PENDING',
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
      },
      with: {
        registrationOption: true,
        transactions: true,
      },
    });

    if (!registration) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Pending registration not found',
      });
    }

    await database.transaction(async (tx) => {
      await tx
        .update(schema.eventRegistrations)
        .set({
          status: 'CANCELLED',
        })
        .where(eq(schema.eventRegistrations.id, registration.id));

      await tx
        .update(schema.eventRegistrationOptions)
        .set({
          // TODO: Fix once drizzle fixes this type
          reservedSpots: registration.registrationOption!.reservedSpots - 1,
        })
        .where(
          eq(
            schema.eventRegistrationOptions.id,
            registration.registrationOptionId,
          ),
        );

      const transaction = registration.transactions.find(
        (transaction) =>
          transaction.status === 'pending' && transaction.method === 'stripe',
      );

      if (transaction) {
        await tx
          .update(schema.transactions)
          .set({
            status: 'cancelled',
          })
          .where(eq(schema.transactions.id, transaction.id));

        if (transaction.stripeCheckoutSessionId) {
          const stripeAccount = ctx.tenant.stripeAccountId;
          if (!stripeAccount) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Stripe account not found',
            });
          }
          try {
            await stripe.checkout.sessions.expire(
              transaction.stripeCheckoutSessionId,
              undefined,
              {
                stripeAccount,
              },
            );
          } catch (error) {
            console.error('Error expiring checkout session', error);
          }
        }
      }
    });

    return { success: true };
  });
