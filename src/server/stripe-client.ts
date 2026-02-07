import Stripe from 'stripe';

import { getStripeApiEnvironment } from './config/environment';

const { STRIPE_API_KEY: stripeApiKey } = getStripeApiEnvironment();

export const stripe = new Stripe(stripeApiKey);
