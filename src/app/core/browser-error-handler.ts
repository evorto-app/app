import { isPlatformBrowser } from '@angular/common';
import { ErrorHandler, inject, Injectable, PLATFORM_ID } from '@angular/core';
import consola from 'consola/browser';

const logger = consola.withTag('app/browser-error');
const telemetryPath = '/telemetry/browser-errors';

const asErrorPayload = (error: unknown) => {
  const normalized =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Unknown browser error');

  return {
    message: normalized.message,
    name: normalized.name,
    stack: normalized.stack ?? null,
    url: globalThis.location?.href ?? null,
  };
};

@Injectable()
export class BrowserErrorHandler implements ErrorHandler {
  private readonly platformId = inject(PLATFORM_ID);

  handleError(error: unknown): void {
    logger.error(error);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const body = JSON.stringify(asErrorPayload(error));
    if (new TextEncoder().encode(body).byteLength > 8 * 1024) {
      return;
    }

    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        telemetryPath,
        new Blob([body], { type: 'application/json' }),
      );
      return;
    }

    void fetch(telemetryPath, {
      body,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    });
  }
}
