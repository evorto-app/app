import { Effect, Layer } from 'effect';
import { HttpMiddleware } from 'effect/unstable/http';

const untracedOperationalPaths = new Set(['/healthz', '/readyz', '/version']);

export const serverRequestPathname = (url: string): string | undefined => {
  try {
    const pathname = url.startsWith('/')
      ? (() => {
          if (url.startsWith('//')) {
            return;
          }
          const queryIndex = url.indexOf('?');
          const fragmentIndex = url.indexOf('#');
          const pathEnd = Math.min(
            queryIndex === -1 ? url.length : queryIndex,
            fragmentIndex === -1 ? url.length : fragmentIndex,
          );
          return url.slice(0, pathEnd);
        })()
      : new URL(url).pathname;
    return pathname?.replace(/\/+$/u, '') || '/';
  } catch {
    return;
  }
};

export const isUntracedServerRequestUrl = (url: string) => {
  const pathname = serverRequestPathname(url);
  return pathname !== undefined && untracedOperationalPaths.has(pathname);
};

export const withoutServerTracing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.withTracerEnabled(false));

// The built-in outer trace records the original full URL. The response
// middleware creates the application trace from a sanitized route instead.
export const serverTracePolicyLayer = Layer.succeed(
  HttpMiddleware.TracerDisabledWhen,
)(() => true);
