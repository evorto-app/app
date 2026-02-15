import { createRequestHandler } from '@angular/ssr';
import { HttpLayerRouter, KeyValueStore, Path } from '@effect/platform';
import { BunFileSystem, BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Effect, Context as EffectContext, Layer } from 'effect';

import { getServerPort } from './server/config/environment';
import { routesLayer, withSsrFallback } from './server/http/routes-layer';
import { webhookRateLimitLayer } from './server/http/webhook-rate-limit';

const keyValueStoreDirectory = '.cache/evorto/server-kv';

const keyValueStoreLayer = KeyValueStore.layerFileSystem(
  keyValueStoreDirectory,
).pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, Path.layer)));

const handlerRuntimeLayer = Layer.mergeAll(
  BunHttpServer.layerContext,
  BunFileSystem.layer,
  Path.layer,
  keyValueStoreLayer,
  webhookRateLimitLayer,
);

const handlerAppLayer = routesLayer.pipe(
  Layer.provideMerge(handlerRuntimeLayer),
);

const { handler: serverHandler } = HttpLayerRouter.toWebHandler(
  handlerAppLayer,
  {
    middleware: withSsrFallback,
  },
);

const handlerContext = EffectContext.empty() as Parameters<
  typeof serverHandler
>[1];

const requestHandler = createRequestHandler((request) =>
  serverHandler(request, handlerContext),
);

export { requestHandler as reqHandler };

const serveEffect = Effect.gen(function* () {
  const port = getServerPort();

  const serverLayer = HttpLayerRouter.serve(routesLayer, {
    middleware: withSsrFallback,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        BunHttpServer.layer({ port }),
        BunFileSystem.layer,
        Path.layer,
        keyValueStoreLayer,
        webhookRateLimitLayer,
      ),
    ),
  );

  yield* Effect.sync(() => {
    console.log(`Bun Effect server listening on http://localhost:${port}`);
  });

  yield* Layer.launch(serverLayer);
});

if (import.meta.main) {
  BunRuntime.runMain(serveEffect);
}
