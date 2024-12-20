import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import 'express-async-errors';
import { auth } from 'express-openid-connect';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistributionFolder = path.dirname(fileURLToPath(import.meta.url));
const browserDistributionFolder = path.resolve(
  serverDistributionFolder,
  '../browser',
);

const config = {
  auth0Logout: true,
  authorizationParams: {
    response_type: 'code',
  },
  authRequired: false,
  baseURL: 'http://localhost:4200',
  clientID: 'VBrV9xK1WaSw9tr90gqh69PzIduy7b7m',
  issuerBaseURL: 'https://tumi.eu.auth0.com',
  secret: process.env['CLIENT_SECRET'],
};

const app = express();
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

app.use(auth(config));

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

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * The request handler used by the Angular CLI (dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
