import { Context, Effect, Layer } from 'effect';

import { authConfig, type AuthConfig } from './auth-config';
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
  database: DatabaseConfig;
  objectStorage: ObjectStorageConfigState;
  server: ServerConfig;
  stripe: StripeConfig;
  testRuntime: TestRuntimeConfigState;
}

const runtimeConfigEffect = Effect.gen(function* () {
  return {
    auth: yield* authConfig,
    database: yield* databaseConfig,
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
