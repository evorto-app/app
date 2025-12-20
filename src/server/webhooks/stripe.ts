import consola from 'consola';
import { eq } from 'drizzle-orm';
import express, { Router } from 'express';

import { database } from '../../db';
import * as schema from '../../db/schema';
import { stripe } from '../stripe-client';

export const stripeRouter = Router();
stripeRouter.post(
  '/',
  express.raw({ limit: '200kb', type: 'application/json' }),
  async (request, response) => {
    const sig = request.headers['stripe-signature'];

    if (!sig) {
      response.status(400).send('No signature');
      return;
    }

    const endpointSecret = process.env['STRIPE_WEBHOOK_SECRET']!;

    let event;

    try {
      event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (error) {
      consola.error(error);
      response.status(400).send(`Webhook Error: ${error}`);
    }

    if (!event) {
      response.status(400).send('Invalid event');
      return;
    }

    consola.debug('Stripe webhook event:', event.type);

    switch (event.type) {
      case 'charge.updated': {
        const eventCharge = event.data.object;

        const appTransaction = await database.query.transactions.findFirst({
          where: { stripeChargeId: eventCharge.id },
        });
        if (!appTransaction) {
          response.status(400).send('Transaction not found');
          return;
        }

        const stripeAccount = await database.query.tenants
          .findFirst({
            columns: { stripeAccountId: true },
            where: { id: appTransaction.tenantId },
          })
          .then((tenant) => tenant?.stripeAccountId);

        if (!stripeAccount) {
          response.status(400).send('Stripe account not found');
          return;
        }

        const charge = await stripe.charges.retrieve(
          eventCharge.id,
          {
            expand: ['balance_transaction'],
          },
          { stripeAccount },
        );

        const balanceTransaction = charge.balance_transaction;
        if (typeof balanceTransaction !== 'object' || !balanceTransaction) {
          response.status(400).send('Balance transaction not found');
          return;
        }
        const appFee =
          balanceTransaction.fee_details.find((fee) => fee.type === 'application_fee')?.amount ?? 0;
        const stripeFee =
          balanceTransaction.fee_details.find((fee) => fee.type === 'stripe_fee')?.amount ?? 0;
        const netValue = balanceTransaction.net;

        consola.debug(balanceTransaction);

        await database
          .update(schema.transactions)
          .set({
            amount: netValue,
            appFee,
            stripeFee,
          })
          .where(eq(schema.transactions.stripeChargeId, eventCharge.id));
        response.status(200).send('Success');
        return;
      }
      case 'checkout.session.completed': {
        const eventSession = event.data.object;
        const { registrationId, tenantId, transactionId } = eventSession.metadata ?? {};
        if (!registrationId || !transactionId || !tenantId) {
          response.status(400).send('Missing metadata');
          return;
        }

        const stripeAccount = await database.query.tenants
          .findFirst({
            columns: { stripeAccountId: true },
            where: { id: tenantId },
          })
          .then((tenant) => tenant?.stripeAccountId);

        if (!stripeAccount) {
          response.status(400).send('Stripe account not found');
          return;
        }

        // Get session from stripe to verify status
        const session = await stripe.checkout.sessions.retrieve(
          eventSession.id,
          { expand: ['payment_intent'] },
          { stripeAccount },
        );
        if (session.status !== 'complete') {
          console.info(`Session ${session.id} not completed, skipping`);
          response.status(200).send('Session not completed, skipping');
          return;
        }
        consola.debug('Session completed:', session);
        const stripePaymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id;
        const stripeChargeId =
          typeof session.payment_intent === 'object' &&
          typeof session.payment_intent?.latest_charge === 'string'
            ? session.payment_intent?.latest_charge
            : undefined;

        await database.transaction(async (tx) => {
          await tx
            .update(schema.transactions)
            .set({
              status: 'successful',
              stripeChargeId,
              stripePaymentIntentId,
            })
            .where(eq(schema.transactions.id, transactionId));
          await tx
            .update(schema.eventRegistrations)
            .set({ status: 'CONFIRMED' })
            .where(eq(schema.eventRegistrations.id, registrationId));
        });
        response.status(200).send('Success');
        return;
      }
      case 'checkout.session.expired': {
        const eventSession = event.data.object;
        const { registrationId, tenantId, transactionId } = eventSession.metadata ?? {};
        if (!registrationId || !transactionId || !tenantId) {
          response.status(400).send('Missing metadata');
          return;
        }
        const stripeAccount = await database.query.tenants
          .findFirst({
            columns: { stripeAccountId: true },
            where: { id: tenantId },
          })
          .then((tenant) => tenant?.stripeAccountId);

        if (!stripeAccount) {
          response.status(400).send('Stripe account not found');
          return;
        }

        // Get session from stripe to verify status
        const session = await stripe.checkout.sessions.retrieve(eventSession.id, undefined, {
          stripeAccount,
        });
        if (session.status !== 'expired') {
          console.info(`Session ${session.id} not expired, skipping`);
          response.status(200).send('Session not expired, skipping');
          return;
        }
        // Cancel registration
        consola.debug('Cancelling registration:', registrationId);
        await database.transaction(async (tx) => {
          await tx
            .update(schema.transactions)
            .set({ status: 'cancelled' })
            .where(eq(schema.transactions.id, transactionId));
          await tx
            .update(schema.eventRegistrations)
            .set({ status: 'CANCELLED' })
            .where(eq(schema.eventRegistrations.id, registrationId));
        });
        response.status(200).send('Success');
        return;
      }
    }
  },
);
