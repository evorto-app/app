import { Effect } from 'effect';

import { authConfig, type AuthConfig } from './auth-config';
import {
  type CloudflareImagesConfigState,
  cloudflareImagesStateConfig,
} from './cloudflare-images-config';
import { databaseConfig, type DatabaseConfig } from './database-config';
import {
  type ObjectStorageConfigState,
  objectStorageStateConfig,
} from './object-storage-config';
import { serverConfig, type ServerConfig } from './server-config';
import { stripeConfig, type StripeConfig } from './stripe-config';
import {
  type TestRuntimeConfigState,
  testRuntimeConfigState,
} from './test-runtime-config';

export interface RuntimeConfigShape {
  auth: AuthConfig;
  cloudflareImages: CloudflareImagesConfigState;
  database: DatabaseConfig;
  objectStorage: ObjectStorageConfigState;
  server: ServerConfig;
  stripe: StripeConfig;
  testRuntime: TestRuntimeConfigState;
}

export class RuntimeConfig extends Effect.Service<RuntimeConfig>()(
  '@server/config/RuntimeConfig',
  {
    accessors: true,
    effect: Effect.gen(function* () {
      return {
        auth: yield* authConfig,
        cloudflareImages: yield* cloudflareImagesStateConfig,
        database: yield* databaseConfig,
        objectStorage: yield* objectStorageStateConfig,
        server: yield* serverConfig,
        stripe: yield* stripeConfig,
        testRuntime: yield* testRuntimeConfigState,
      } satisfies RuntimeConfigShape;
    }),
  },
) {}
