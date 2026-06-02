import { Context, Effect, Layer } from 'effect';

import { authConfig, type AuthConfig } from './auth-config';
import {
  type CloudflareImagesConfigState,
  cloudflareImagesStateConfig,
} from './cloudflare-images-config';
import { databaseConfig, type DatabaseConfig } from './database-config';
import {
  emailNotificationsConfig,
  type EmailNotificationsConfig,
} from './email-notifications-config';
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
  emailNotifications: EmailNotificationsConfig;
  objectStorage: ObjectStorageConfigState;
  server: ServerConfig;
  stripe: StripeConfig;
  testRuntime: TestRuntimeConfigState;
}

const runtimeConfigEffect = Effect.gen(function* () {
  return {
    auth: yield* authConfig,
    cloudflareImages: yield* cloudflareImagesStateConfig,
    database: yield* databaseConfig,
    emailNotifications: yield* emailNotificationsConfig,
    objectStorage: yield* objectStorageStateConfig,
    server: yield* serverConfig,
    stripe: yield* stripeConfig,
    testRuntime: yield* testRuntimeConfigState,
  } satisfies RuntimeConfigShape;
});

export class RuntimeConfig extends Context.Service<
  RuntimeConfig,
  RuntimeConfigShape
>()('@server/config/RuntimeConfig', {
  make: runtimeConfigEffect,
}) {
  static readonly Default = Layer.effect(RuntimeConfig, RuntimeConfig.make);
}
