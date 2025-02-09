import { Router } from 'express';

import { stripeRouter } from './stripe';

export const webhookRouter = Router();
webhookRouter.use('/stripe', stripeRouter);
