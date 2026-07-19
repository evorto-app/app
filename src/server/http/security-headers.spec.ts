import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';
import { describe, expect, it } from 'vitest';

import { applySecurityHeaders } from './security-headers';

describe('applySecurityHeaders', () => {
  it('allows the first-party scanner camera and denies unused sensors', () => {
    const response = applySecurityHeaders(HttpServerResponse.text('ok'));

    expect(response.headers['permissions-policy']).toBe(
      'camera=(self), geolocation=(), microphone=()',
    );
  });
});
