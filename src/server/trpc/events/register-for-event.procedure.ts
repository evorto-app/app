import type Stripe from 'stripe';

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
import { 
  resolvePolicyVariant, 
  createDefaultTenantPolicies, 
  EffectiveCancellationPolicy 
} from '../../../types/cancellation';

/**
 * Resolves the effective cancellation policy for a registration
 */
async function resolveEffectiveCancellationPolicy(
  registrationOption: {
    isPaid: boolean;
    organizingRegistration: boolean;
    useTenantCancellationPolicy: boolean;
    cancellationPolicy: any;
  },
  tenantId: string,
): Promise<EffectiveCancellationPolicy> {
  const variant = resolvePolicyVariant(
    registrationOption.isPaid,
    registrationOption.organizingRegistration,
  );

  if (registrationOption.useTenantCancellationPolicy) {
    // Get tenant default policies
    const tenant = await database.query.tenants.findFirst({
      where: { id: tenantId },
      columns: { cancellationPolicies: true },
    });

    const tenantPolicies = tenant?.cancellationPolicies || createDefaultTenantPolicies();
    const policy = tenantPolicies[variant];

    return {
      ...policy,
      source: 'tenant-default',
      variant,
    };
  } else {
    // Use option override policy
    const policy = registrationOption.cancellationPolicy;
    if (!policy) {
      // Fallback to default if no custom policy
      const defaultPolicies = createDefaultTenantPolicies();
      return {
        ...defaultPolicies[variant],
        source: 'option-override',
        variant,
      };
    }

    return {
      ...policy,
      source: 'option-override',
      variant,
    };
  }
}

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
                start: true,
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

      // Resolve effective cancellation policy
      const effectiveCancellationPolicy = await resolveEffectiveCancellationPolicy(
        registrationOption,
        ctx.tenant.id,
      );

      // Register user for event
      const userRegistration = await tx
        .insert(schema.eventRegistrations)
        .values({
          eventId: input.eventId,
          registrationOptionId: registrationOption.id,
          status: registrationOption.isPaid ? 'PENDING' : 'CONFIRMED',
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
          effectiveCancellationPolicy,
          effectivePolicySource: effectiveCancellationPolicy.source,
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
        // Determine effective price (apply best discount if any)
        let effectivePrice = registrationOption.price;
        // Find verified user cards for tenant
        const cards = await database.query.userDiscountCards.findMany({
          where: {
            status: 'verified',
            tenantId: ctx.tenant.id,
            userId: ctx.user.id,
          },
        });
        if (cards.length > 0) {
          // Only apply discounts for providers enabled on this tenant
          const tenant = await database.query.tenants.findFirst({
            where: { id: ctx.tenant.id },
          });
          const providerConfig = (tenant as any)?.discountProviders ?? {};
          const enabledTypes = new Set(
            Object.entries(providerConfig)
              .filter(([, v]) => (v as any)?.status === 'enabled')
              .map(([k]) => k as string),
          );
          // Fetch event-level discounts for this registration option
          const discounts =
            await database.query.eventRegistrationOptionDiscounts.findMany({
              where: { registrationOptionId: registrationOption.id },
            });
          const eventStart = registrationOption.event?.start ?? new Date();
          const eligible = discounts.filter((d) =>
            cards.some(
              (c) =>
                c.type === d.discountType &&
                enabledTypes.has(c.type) &&
                (!c.validTo || c.validTo > eventStart),
            ),
          );
          if (eligible.length > 0) {
            effectivePrice = Math.min(
              ...eligible.map((e) => e.discountedPrice),
            );
          }
        }

        // Check if discount reduced price to zero or negative - treat as free
        if (effectivePrice <= 0) {
          consola.info(`Effective price ${effectivePrice} <= 0 for registration ${userRegistration.id}, treating as free`);
          
          // Update registration status to confirmed (no payment needed)
          await database
            .update(schema.eventRegistrations)
            .set({ status: 'CONFIRMED' })
            .where(eq(schema.eventRegistrations.id, userRegistration.id));

          // Update registration option spots
          await database
            .update(schema.eventRegistrationOptions)
            .set({
              confirmedSpots: registrationOption.confirmedSpots + 1,
              reservedSpots: Math.max(0, registrationOption.reservedSpots - 1),
            })
            .where(eq(schema.eventRegistrationOptions.id, registrationOption.id));

          return { userRegistration: { ...userRegistration, status: 'CONFIRMED' as const } };
        }

        const applicationFee = Math.round(effectivePrice * 0.035);
        const selectedTaxRateId = registrationOption.stripeTaxRateId || null;

        // Log warning if tax rate exists but may be inactive
        if (selectedTaxRateId) {
          const taxRate = await database.query.tenantStripeTaxRates.findFirst({
            where: {
              tenantId: ctx.tenant.id,
              stripeTaxRateId: selectedTaxRateId,
            },
          });

          if (!taxRate || !taxRate.active || !taxRate.inclusive) {
            consola.warn(`WARN_INACTIVE_TAX_RATE: Tax rate ${selectedTaxRateId} is not active or compatible for registration ${userRegistration.id}`, {
              taxRateId: selectedTaxRateId,
              registrationId: userRegistration.id,
              tenantId: ctx.tenant.id,
              active: taxRate?.active,
              inclusive: taxRate?.inclusive,
            });
            // Continue with checkout but log the warning
          }
        }

        const sessionCreateParameters: Stripe.Checkout.SessionCreateParams = {
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
                unit_amount: effectivePrice,
              },
              // Apply tax rate if configured/selected
              ...(selectedTaxRateId
                ? { tax_rates: [selectedTaxRateId] as string[] }
                : {}),
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
        };

        const session = await stripe.checkout.sessions.create(
          sessionCreateParameters,
          { stripeAccount },
        );

        const transactionResponse = await database
          .insert(schema.transactions)
          .values({
            amount: effectivePrice,
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
