import Stripe from 'stripe';

import { loadStripeApiConfigSync } from './config/stripe-config';

const { STRIPE_API_KEY: stripeApiKey } = loadStripeApiConfigSync();

export const stripe = new Stripe(stripeApiKey);
