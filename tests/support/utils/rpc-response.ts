import type { Page } from '@playwright/test';

import type { AppRpcHandlers } from '../../../src/server/effect/rpc/handlers/shared/handler-types';

export const waitForAppRpcResponse = (page: Page, tag: keyof AppRpcHandlers) =>
  page.waitForResponse(
    (response) => {
      const request = response.request();
      if (
        request.method() !== 'POST' ||
        new URL(response.url()).pathname !== '/rpc/'
      )
        return false;
      const payload: unknown = request.postDataJSON();
      const messages: readonly unknown[] = Array.isArray(payload)
        ? payload
        : [payload];
      return messages.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          'tag' in message &&
          message.tag === tag,
      );
    },
    { timeout: 20_000 },
  );
