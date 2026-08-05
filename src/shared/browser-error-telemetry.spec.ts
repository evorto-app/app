import { describe, expect, it } from 'vitest';

import {
  MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
  serializeBrowserErrorTelemetryPayload,
} from './browser-error-telemetry';

describe('browser error telemetry serialization', () => {
  it('bounds oversized fields instead of dropping the report', () => {
    const oversizedValue = '"\\\u{0}'.repeat(10_000);

    const body = serializeBrowserErrorTelemetryPayload({
      message: oversizedValue,
      name: oversizedValue,
      stack: oversizedValue,
      url: `https://tenant.example.com/${oversizedValue}`,
    });
    const payload = JSON.parse(body) as {
      message: string;
      name: string;
      stack: string;
      url: string;
    };

    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
    );
    expect(payload.message.length).toBeGreaterThan(0);
    expect(payload.message.length).toBeLessThan(oversizedValue.length);
    expect(payload.name.length).toBeLessThan(oversizedValue.length);
    expect(payload.stack.length).toBeLessThan(oversizedValue.length);
    expect(payload.url.length).toBeLessThan(oversizedValue.length);
  });
});
