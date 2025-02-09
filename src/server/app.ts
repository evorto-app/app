import {
  AngularNodeAppEngine,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import * as Sentry from '@sentry/node';
import * as trpcExpress from '@trpc/server/adapters/express';
import cookieParser from 'cookie-parser';
import { Either, Schema } from 'effect';
import express from 'express';
import { attemptSilentLogin, auth, ConfigParams } from 'express-openid-connect';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '../types/custom/context';
import { addAuthenticationContext } from './middleware/authentication-context';
import { addTenantContext } from './middleware/tenant-context';
import { addUserContextMiddleware } from './middleware/user-context';
import { appRouter } from './trpc/app-router';

const serverDistributionFolder = path.dirname(fileURLToPath(import.meta.url));
const browserDistributionFolder = path.resolve(
  serverDistributionFolder,
  '../browser',
);

const config: ConfigParams = {
  auth0Logout: true,
  authorizationParams: {
    response_type: 'code',
  },
  authRequired: false,
};

export const app = express();
const angularApp = new AngularNodeAppEngine();

if (process.env['PRERENDER']) {
  console.log('Skipping auth middleware for prerendering');
} else {
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
          return Schema.decodeUnknownSync(Context)({
            authentication: { isAuthenticated: false },
            tenant: {
              currency: 'NO_TENANT_PRERENDER',
              domain: 'NO_TENANT_PRERENDER',
              id: 'NO_TENANT_PRERENDER',
              locale: 'NO_TENANT_PRERENDER',
              name: 'NO_TENANT_PRERENDER',
              theme: 'evorto',
              timezone: 'NO_TENANT_PRERENDER',
            },
          });
        } else {
          throw requestContext.left;
        }
      }
      return requestContext.right;
    },
    onError: (options) => {
      const { ctx, error, input, path, req, type } = options;
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
 */
app.use('/**', attemptSilentLogin(), (request, expressResponse, next) => {
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
});

Sentry.setupExpressErrorHandler(app);
