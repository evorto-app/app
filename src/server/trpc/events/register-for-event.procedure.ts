import { TRPCError } from '@trpc/server';
import consola from 'consola';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';
import { DateTime } from 'luxon';

import { database } from '../../../db';
import { createId } from '../../../db/create-id';
import * as schema from '../../../db/schema';
import { stripe } from '../../stripe-client';
import { authenticatedProcedure } from '../trpc-server';

export const registerForEventProcedure = authenticatedProcedure
  .input(
    Schema.standardSchemaV1(
      Schema.Struct({
        eventId: Schema.NonEmptyString,
        registrationOptionId: Schema.NonEmptyString,
      }),
    ),
  )
  .mutation(async ({ ctx, input }) => {
    const databaseReturns = await database.transaction(async (tx) => {
      // Check if user is already registered for this event
      const existingRegistration = await tx.query.eventRegistrations.findFirst({
        where: {
          eventId: input.eventId,
          status: { NOT: 'CANCELLED' },
          userId: ctx.user.id,
        },
      });
      if (existingRegistration) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'User is already registered for this event',
        });
      }

      // Check if event is full
      const registrationOption =
        await tx.query.eventRegistrationOptions.findFirst({
          where: { eventId: input.eventId, id: input.registrationOptionId },
          with: {
            event: {
              columns: {
                title: true,
              },
            },
          },
        });
      if (!registrationOption) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Registration option not found',
        });
      }
      if (
        registrationOption.confirmedSpots + registrationOption.reservedSpots >=
        registrationOption.spots
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Event is full',
        });
      }

      // Register user for event
      const userRegistration = await tx
        .insert(schema.eventRegistrations)
        .values({
          eventId: input.eventId,
          registrationOptionId: registrationOption.id,
          status: registrationOption.isPaid ? 'PENDING' : 'CONFIRMED',
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
        })
        .returning()
        .then((result) => result[0]);

      // Update registration option
      await tx
        .update(schema.eventRegistrationOptions)
        .set(
          registrationOption.isPaid
            ? { reservedSpots: registrationOption.reservedSpots + 1 }
            : {
                confirmedSpots: registrationOption.confirmedSpots + 1,
              },
        )
        .where(
          and(
            eq(schema.eventRegistrationOptions.id, registrationOption.id),
            eq(schema.eventRegistrationOptions.eventId, input.eventId),
          ),
        );

      return { registrationOption, userRegistration };
    });
    const { registrationOption, userRegistration } = databaseReturns;
    if (registrationOption.isPaid) {
      try {
        const transactionId = createId();
        const eventUrl = `${ctx.request.protocol}://${ctx.request.headers.host}/events/${input.eventId}`;
        consola.debug(
          `Creating Stripe session for event ${input.eventId} with URL ${eventUrl}`,
        );
        const stripeAccount = ctx.tenant.stripeAccountId;
        if (!stripeAccount) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Stripe account not found',
          });
        }
        const applicationFee = Math.round(registrationOption.price * 0.035);
        const session = await stripe.checkout.sessions.create(
          {
            cancel_url: `${eventUrl}?registrationStatus=cancel`,
            customer_email: ctx.user.email,
            expires_at: Math.ceil(
              DateTime.local().plus({ minutes: 30 }).toSeconds(),
            ),
            line_items: [
              {
                price_data: {
                  currency: ctx.tenant.currency,
                  product_data: {
                    // TODO: Fix once drizzle fixes this type
                    name: `Registration fee for ${registrationOption.event!.title}`,
                  },
                  unit_amount: registrationOption.price,
                },
                quantity: 1,
              },
            ],
            metadata: {
              registrationId: userRegistration.id,
              tenantId: ctx.tenant.id,
              transactionId,
            },
            mode: 'payment',
            payment_intent_data: {
              application_fee_amount: applicationFee,
            },
            success_url: `${eventUrl}?registrationStatus=success`,
          },
          { stripeAccount },
        );

        const transactionResponse = await database
          .insert(schema.transactions)
          .values({
            amount: registrationOption.price,
            // TODO: Fix once drizzle fixes this type
            comment: `Registration for event ${registrationOption.event!.title} ${registrationOption.eventId}`,
            currency: ctx.tenant.currency,
            eventId: registrationOption.eventId,
            eventRegistrationId: userRegistration.id,
            executiveUserId: ctx.user.id,
            id: transactionId,
            method: 'stripe',
            status: 'pending',
            stripeCheckoutSessionId: session.id,
            stripeCheckoutUrl: session.url,
            stripePaymentIntentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : session.payment_intent?.id,
            targetUserId: ctx.user.id,
            tenantId: ctx.tenant.id,
            type: 'registration',
          })
          .returning();

        return { transaction: transactionResponse[0], userRegistration };
      } catch (error) {
        await database.transaction(async (tx) => {
          const registrationOption =
            await tx.query.eventRegistrationOptions.findFirst({
              where: {
                eventId: input.eventId,
                id: input.registrationOptionId,
              },
            });
          if (!registrationOption) {
            throw new TRPCError({
              cause: error,
              code: 'NOT_FOUND',
              message: 'Registration option not found during rollback',
            });
          }
          await tx
            .update(schema.eventRegistrationOptions)
            .set({
              reservedSpots: registrationOption.reservedSpots - 1,
            })
            .where(
              and(
                eq(schema.eventRegistrationOptions.id, registrationOption.id),
                eq(schema.eventRegistrationOptions.eventId, input.eventId),
              ),
            );

          await tx
            .delete(schema.eventRegistrations)
            .where(eq(schema.eventRegistrations.id, userRegistration.id));
        });
        consola.error(error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create Stripe session`,
        });
      }
    }
    return { userRegistration };
  });
