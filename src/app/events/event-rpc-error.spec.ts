import { describe, expect, it } from 'vitest';

import {
  eventReviewActionErrorRequiresRefresh,
  eventRouteErrorPath,
} from './event-rpc-error';

describe('eventRouteErrorPath', () => {
  it.each([
    ['EventNotFoundError', '/404'],
    ['RpcForbiddenError', '/403'],
    ['RpcUnauthorizedError', '/403'],
    ['RpcInternalServerError', '/500'],
  ] as const)('routes %s to %s', (_tag, expectedPath) => {
    expect(eventRouteErrorPath({ _tag })).toBe(expectedPath);
  });

  it('surfaces an untyped transport failure as unavailable', () => {
    expect(eventRouteErrorPath(new Error('Connection failed'))).toBe('/500');
  });
});

describe('eventReviewActionErrorRequiresRefresh', () => {
  it('refreshes only for the typed review conflict', () => {
    expect(
      eventReviewActionErrorRequiresRefresh({
        _tag: 'EventConflictError',
        message: 'copy can change without changing recovery',
      }),
    ).toBe(true);
    expect(
      eventReviewActionErrorRequiresRefresh({
        _tag: 'EventNotFoundError',
        message: 'conflict',
      }),
    ).toBe(false);
    expect(
      eventReviewActionErrorRequiresRefresh(
        new Error('status changed; refresh and try again'),
      ),
    ).toBe(false);
  });
});
