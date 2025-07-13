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
import consola from 'consola';
import cookieParser from 'cookie-parser';
import { Either, Schema } from 'effect';
import express, { ErrorRequestHandler } from 'express';
import { attemptSilentLogin, auth, ConfigParams } from 'express-openid-connect';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '../types/custom/context';
import { addAuthenticationContext } from './middleware/authentication-context';
import { socialCrawlerBypass } from './middleware/crawler-id';
import { prerenderSkip } from './middleware/prerender-skip';
import { addTenantContext } from './middleware/tenant-context';
import { addUserContextMiddleware } from './middleware/user-context';
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

app.use(prerenderSkip);
app.use(socialCrawlerBypass);

app.use('/webhooks', webhookRouter);
app.use('/qr', qrCodeRouter);

if (!process.env['PRERENDER']) {
  app.use(auth(config));
}

app.use(cookieParser());
app.use(addAuthenticationContext);
app.use(addTenantContext);
app.use(addUserContextMiddleware);

app.get('/forward-login', (request, response) => {
  const redirectUrl = request.query['redirectUrl'];
  if (typeof redirectUrl === 'string') {
    response.oidc.login({
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
        if (process.env['PRERENDER'] === 'true') {
          // To make sure we can build our app, we have to handle the prerender
          const context = Schema.decodeUnknownSync(Context)({
            authentication: { isAuthenticated: false },
            tenant: {
              currency: 'EUR',
              domain: 'NO_TENANT_PRERENDER',
              id: 'NO_TENANT_PRERENDER',
              locale: 'NO_TENANT_PRERENDER',
              name: 'NO_TENANT_PRERENDER',
              theme: 'evorto',
              timezone: 'NO_TENANT_PRERENDER',
            },
          });
          return { ...context, request: request.req };
        } else {
          throw requestContext.left;
        }
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

  if (request.isSocialMediaCrawler) {
    // Skip silent login for crawlers
    handleAngular();
  } else {
    // Run silent login for normal users
    attemptSilentLogin()(request, expressResponse, (error) => {
      if (error) return next(error);
      handleAngular();
    });
  }
});

// log any error
const errorLogger: ErrorRequestHandler = (error, request, response, next) => {
  consola.error(error);
  next(error);
};
app.use(errorLogger);

Sentry.setupExpressErrorHandler(app);
