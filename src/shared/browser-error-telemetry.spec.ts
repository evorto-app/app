import { describe, expect, it, vi } from 'vitest';

import {
  MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
  sanitizeBrowserErrorTelemetryPayload,
  serializeBrowserErrorTelemetryPayload,
} from './browser-error-telemetry';

describe('browser error telemetry serialization', () => {
  it.each([
    '/registration-transfers/private-transfer-token',
    '/registration-transfers/private%2Ftransfer-token',
    '/%72egistration-transfers/private-transfer-token',
    '/registration-transfers;source=email/private-transfer-token',
    '/(registration-transfers/private-transfer-token)',
    '/(primary:registration-transfers/private-transfer-token)',
    '/(aux:help//primary:registration-transfers/private-transfer-token)',
    '/(registration-transfers/private-transfer-token//aux:help)',
  ])('redacts the claim credential in %s across telemetry fields', (path) => {
    const safePath = path.replace(
      /private(?:-|%2F)transfer-token/u,
      '[REDACTED_TOKEN]',
    );
    const payload = {
      message: `Could not open ${path}`,
      name: 'Error',
      stack: `at https://tenant.example.com${path}`,
      url: `https://tenant.example.com${path}?from=email#details`,
    };
    const expected = {
      message: `Could not open ${safePath}`,
      name: 'Error',
      stack: `at https://tenant.example.com${safePath}`,
      url: `https://tenant.example.com${safePath}`,
    };

    expect(sanitizeBrowserErrorTelemetryPayload(payload)).toEqual(expected);
    expect(serializeBrowserErrorTelemetryPayload(payload)).toBe(
      JSON.stringify(expected),
    );
    expect(sanitizeBrowserErrorTelemetryPayload(expected)).toEqual(expected);
  });

  it('preserves the transfer entry route and unrelated source-file paths', () => {
    const payload = {
      message: 'Open /registration-transfers to enter a code',
      name: 'Error',
      stack:
        'at https://tenant.example.com/src/app/registration-transfers/claim.component.ts\n at src/registration-transfers/claim.component.ts',
      url: 'https://tenant.example.com/registration-transfers',
    };

    expect(sanitizeBrowserErrorTelemetryPayload(payload)).toEqual(payload);
  });

  it('redacts credentials before either logging or serialization', () => {
    const payload = {
      message: 'Failure at https://user:password@tenant.example.com/events',
      name: 'Error',
      stack: 'at https://encoded%40user:encoded%3Apassword@[::1]:4200/source',
      url: 'https://page-user:page-password@tenant.example.com/events?private=query#fragment',
    };
    const expected = {
      message: 'Failure at https://tenant.example.com/events',
      name: 'Error',
      stack: 'at https://[::1]:4200/source',
      url: 'https://tenant.example.com/events',
    };

    expect(sanitizeBrowserErrorTelemetryPayload(payload)).toEqual(expected);
    expect(serializeBrowserErrorTelemetryPayload(payload)).toBe(
      JSON.stringify(expected),
    );
  });

  it('bounds oversized fields instead of dropping the report', () => {
    const oversizedValue = '"\\\u{0}'.repeat(10_000);

    const body = serializeBrowserErrorTelemetryPayload({
      message: oversizedValue,
      name: oversizedValue,
      stack: oversizedValue,
      url: `https://tenant.example.com/${oversizedValue}`,
    });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
    );
    expect(JSON.parse(body)).toEqual({
      message: '[REDACTED_OVERSIZED_FIELD]',
      name: '[REDACTED_OVERSIZED_FIELD]',
      stack: '[REDACTED_OVERSIZED_FIELD]',
      url: null,
    });
  });

  it('omits oversized secret prefixes and Unicode URLs before regex processing or URL parsing', () => {
    const input = {
      message: `https://private-user:${'private-password'.repeat(1000)}@tenant.example/events`,
      name: `private-person${'.'.repeat(1000)}@example.com`,
      stack: `Bearer ${'private-token'.repeat(1000)}`,
      url: `https://private-user:private-password@tenant.example/${'💚'.repeat(5000)}`,
    };
    const replaceAll = vi.spyOn(String.prototype, 'replaceAll');
    const parseUrl = vi.spyOn(globalThis, 'URL');
    try {
      const sanitized = sanitizeBrowserErrorTelemetryPayload(input);
      expect(replaceAll).not.toHaveBeenCalled();
      expect(parseUrl).not.toHaveBeenCalled();
      expect(sanitized).toEqual({
        message: '[REDACTED_OVERSIZED_FIELD]',
        name: '[REDACTED_OVERSIZED_FIELD]',
        stack: '[REDACTED_OVERSIZED_FIELD]',
        url: null,
      });
      const body = serializeBrowserErrorTelemetryPayload(input);
      expect(body).not.toContain('private-');
      expect(JSON.parse(body)).toEqual(sanitized);
    } finally {
      replaceAll.mockRestore();
      parseUrl.mockRestore();
    }
  });

  it('omits a short raw URL whose canonical path expands past the URL work limit', () => {
    const url = `https://private-user:private-password@tenant.example/${'💚'.repeat(300)}?private=query#fragment`;
    expect(url.length).toBeLessThan(1000);
    const input = {
      message: 'Short diagnostic',
      name: 'Error',
      stack: null,
      url,
    };
    const sanitized = sanitizeBrowserErrorTelemetryPayload(input);
    expect(sanitized).toEqual({ ...input, url: null });
    expect(sanitizeBrowserErrorTelemetryPayload(sanitized)).toEqual(sanitized);
    expect(JSON.parse(serializeBrowserErrorTelemetryPayload(input))).toEqual(
      sanitized,
    );
  });

  it('preserves diagnostic fields at their character limits', () => {
    const origin = 'https://tenant.example/';
    const input = {
      message: 'm'.repeat(2000),
      name: 'n'.repeat(200),
      stack: 's'.repeat(4000),
      url: origin.padEnd(1000, 'p'),
    };
    expect(sanitizeBrowserErrorTelemetryPayload(input)).toEqual(input);
    expect(JSON.parse(serializeBrowserErrorTelemetryPayload(input))).toEqual(
      input,
    );
  });

  it('still bounds escaped JSON bytes after accepting fields within character limits', () => {
    const escaped = '\\"\u{0}'.repeat(1000);
    const body = serializeBrowserErrorTelemetryPayload({
      message: escaped.slice(0, 2000),
      name: escaped.slice(0, 200),
      stack: escaped.slice(0, 4000),
      url: 'https://tenant.example/events',
    });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      MAX_BROWSER_ERROR_TELEMETRY_BODY_SIZE_BYTES,
    );
    expect(body).not.toContain('REDACTED_OVERSIZED_FIELD');
    expect(JSON.parse(body)).toMatchObject({
      url: 'https://tenant.example/events',
    });
  });
});
