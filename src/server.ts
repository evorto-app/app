import { createNodeRequestHandler, isMainModule } from '@angular/ssr/node';

// consola.wrapAll();
import { app } from './server/app';

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
// eslint-disable-next-line unicorn/prevent-abbreviations
export const reqHandler = createNodeRequestHandler(app);
