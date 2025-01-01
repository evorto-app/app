import {
  AngularNodeAppEngine,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import * as trpcExpress from '@trpc/server/adapters/express';
import cookieParser from 'cookie-parser';
import express from 'express';
import { auth, ConfigParams } from 'express-openid-connect';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addTokenContextMiddleware } from './middleware/tenant-context';
import { addUserContextMiddleware } from './middleware/user-context';
import { appRouter } from './trpc/app-router';

const serverDistributionFolder = path.dirname(fileURLToPath(import.meta.url));
const browserDistributionFolder = path.resolve(
  serverDistributionFolder,
  '../browser',
);

const config: ConfigParams = {
  attemptSilentLogin: false,
  auth0Logout: true,
  authorizationParams: {
    response_type: 'code',
  },
  authRequired: false,
};

export const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

if (process.env['PRERENDER']) {
  console.log('Skipping auth middleware for prerendering');
} else {
  app.use(auth(config));
}

app.use(cookieParser());
app.use(addTokenContextMiddleware);
app.use(addUserContextMiddleware);

app.use(
  '/trpc',
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    // createContext,
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
app.use('/**', (request, expressResponse, next) => {
  angularApp
    .handle(request)
    .then((response) =>
      response
        ? writeResponseToNodeResponse(response, expressResponse)
        : next(),
    )
    .catch(next);
});
