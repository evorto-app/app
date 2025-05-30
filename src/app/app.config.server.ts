import { provideServerRendering, provideServerRouting } from '@angular/ssr';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';

import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(), provideServerRouting(serverRoutes)],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
