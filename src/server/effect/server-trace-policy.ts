import { Effect, Layer } from 'effect';
import { HttpMiddleware } from 'effect/unstable/http';

const untracedOperationalPaths = new Set(['/healthz', '/readyz', '/version']);

const requestPathname = (url: string) => {
  try {
    return (
      new URL(url, 'http://localhost').pathname.replace(/\/+$/u, '') || '/'
    );
  } catch {
    return;
  }
};

export const isUntracedServerRequestUrl = (url: string) => {
  const pathname = requestPathname(url);
  return pathname !== undefined && untracedOperationalPaths.has(pathname);
};

export const withoutServerTracing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.withTracerEnabled(false));

export const serverTracePolicyLayer = Layer.succeed(
  HttpMiddleware.TracerDisabledWhen,
)((request) => isUntracedServerRequestUrl(request.url));
