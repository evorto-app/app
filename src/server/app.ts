/**
 * Main Express app for Evorto server.
 *
 * - Sets up middleware for authentication, tenant/user context, and social crawler detection.
 * - Handles static file serving and all other requests by rendering the Angular app.
 * - For suspected social media crawlers, skips silent login to avoid unnecessary authentication.
 */

import {
  AngularNodeAppEngine,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import * as Sentry from '@sentry/node';
import * as trpcExpress from '@trpc/server/adapters/express';
import compression from 'compression';
import consola from 'consola';
import cookieParser from 'cookie-parser';
import { Either, Schema } from 'effect';
import express, { ErrorRequestHandler } from 'express';
import { auth, ConfigParams } from 'express-openid-connect';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '../types/custom/context';
import { addAuthenticationContext } from './middleware/authentication-context';
import { addTenantContext } from './middleware/tenant-context';
import { addUserContext } from './middleware/user-context';
import { qrCodeRouter } from './routers/qr-code.router';
import { appRouter } from './trpc/app-router';
import { webhookRouter } from './webhooks';

const serverDistributionFolder = path.dirname(fileURLToPath(import.meta.url));
const browserDistributionFolder = path.resolve(
  serverDistributionFolder,
  '../browser',
);

const config: ConfigParams = {
  auth0Logout: true,
  authRequired: false,
};

export const app = express();
const angularApp = new AngularNodeAppEngine();

// Trust upstream proxy (Fly.io, etc.)
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

app.use('/qr', qrCodeRouter);

app.use(auth(config));

app.use(cookieParser());
app.use(addAuthenticationContext);
app.use(addTenantContext);
app.use(addUserContext);

// Apply basic rate limiting to webhooks
app.use(
  '/webhooks',
  rateLimit({
    legacyHeaders: false,
    limit: 60,
    standardHeaders: true,
    windowMs: 60_000,
  }),
);
app.use('/webhooks', webhookRouter);

app.get('/forward-login', async (request, response) => {
  const redirectUrl = request.query['redirectUrl'];
  if (typeof redirectUrl === 'string') {
    await response.oidc.login({
      returnTo: redirectUrl,
    });
  } else {
    response.redirect('/login');
  }
});

app.use(
  '/trpc',
  trpcExpress.createExpressMiddleware({
    createContext: (request) => {
      const requestContext = Schema.decodeUnknownEither(Context)(request.req);
      if (Either.isLeft(requestContext)) {
        throw requestContext.left;
      }
      return { ...requestContext.right, request: request.req };
    },
    onError: (options) => {
      const { error } = options;
      console.error('Error:', error);
      if (error.code === 'INTERNAL_SERVER_ERROR') {
        Sentry.captureException(error);
      }
    },
    router: appRouter,
  }),
);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistributionFolder, {
    index: false,
    maxAge: '1y',
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 * For social media crawlers, skip attemptSilentLogin to avoid unnecessary authentication.
 */
app.use('/{*splat}', (request, expressResponse, next) => {
  const handleAngular = () => {
    const requestContext = Schema.decodeUnknownEither(Context)(request);
    if (Either.isLeft(requestContext)) {
      next(requestContext.left);
      return;
    }
    angularApp
      .handle(request, requestContext.right)
      .then((response) =>
        response
          ? writeResponseToNodeResponse(response, expressResponse)
          : next(),
      )
      .catch(next);
  };

  handleAngular();
});

// log any error
const errorLogger: ErrorRequestHandler = (error, request, response, next) => {
  consola.error(error);
  next(error);
};
app.use(errorLogger);

Sentry.setupExpressErrorHandler(app);

// Final error handler: redirect to /500 for HTML requests
// Must be the last handler
const finalErrorHandler: ErrorRequestHandler = (error, request, response) => {
  try {
    consola.error(error);
    if (response.headersSent) return;
    const accept = request.headers['accept'] ?? '';
    if (typeof accept === 'string' && accept.includes('text/html')) {
      response.status(500).redirect('/500');
    } else {
      response.status(500).json({ error: 'Internal Server Error' });
    }
  } catch (handlerError) {
    consola.error('Error in error handler', handlerError);
    if (!response.headersSent) response.status(500).end();
  }
};
app.use(finalErrorHandler);
