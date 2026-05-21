import { describe, expect, it, vi } from '@effect/vitest';

import {
  Adapters,
  ProviderValidationUnavailableError,
  validateEsnCard,
  validateTestEsnCard,
} from './index';

describe('validateEsnCard', () => {
  it('validates active cards and preserves provider metadata', async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => [
        {
          'expiration-date': '2026-12-31T00:00:00.000Z',
          status: 'active',
        },
      ],
      ok: true,
    })) as unknown as typeof fetch;

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'ESN-123' }),
    ).resolves.toMatchObject({
      metadata: {
        'expiration-date': '2026-12-31T00:00:00.000Z',
        status: 'active',
      },
      status: 'verified',
      validTo: new Date('2026-12-31T00:00:00.000Z'),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://esncard.org/services/1.0/card.json?code=ESN-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('treats missing cards as invalid user input', async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => [],
      ok: true,
    })) as unknown as typeof fetch;

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'UNKNOWN' }),
    ).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('distinguishes provider failures from invalid cards', async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({ error: 'temporarily unavailable' }),
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'ESN-123' }),
    ).rejects.toMatchObject({
      name: 'ProviderValidationUnavailableError',
      reason: 'unavailable',
    } satisfies Partial<ProviderValidationUnavailableError>);
  });

  it('maps deterministic test-mode card identifiers without external calls', async () => {
    expect(validateTestEsnCard({ identifier: 'TESTESNVERIFY' })).toEqual({
      metadata: { provider: 'evorto-test-mode', status: 'active' },
      status: 'verified',
      validTo: new Date('2099-12-31T00:00:00.000Z'),
    });
    expect(validateTestEsnCard({ identifier: 'TESTESNEXPIRE' })).toEqual({
      metadata: { provider: 'evorto-test-mode', status: 'expired' },
      status: 'expired',
    });
    expect(validateTestEsnCard({ identifier: 'TESTESNINVALID' })).toEqual({
      metadata: { provider: 'evorto-test-mode', status: 'invalid' },
      status: 'invalid',
    });
    expect(validateTestEsnCard({ identifier: 'TESTESNUNVERIF' })).toEqual({
      metadata: { provider: 'evorto-test-mode', status: 'unverified' },
      status: 'unverified',
    });
    expect(validateTestEsnCard({ identifier: 'UNKNOWN' })).toEqual({
      status: 'invalid',
    });
    expect(() => validateTestEsnCard({ identifier: 'TESTESNDOWN' })).toThrow(
      ProviderValidationUnavailableError,
    );
  });

  it('uses deterministic test mode only when tenant provider config enables it', async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => [],
      ok: true,
    })) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      await expect(
        Adapters.esnCard?.validate({
          config: { validationMode: 'test' },
          identifier: 'TESTESNVERIFY',
        }),
      ).resolves.toMatchObject({
        status: 'verified',
        validTo: new Date('2099-12-31T00:00:00.000Z'),
      });
      expect(fetchImpl).not.toHaveBeenCalled();

      await expect(
        Adapters.esnCard?.validate({
          config: {},
          identifier: 'TESTESNVERIFY',
        }),
      ).resolves.toEqual({ status: 'invalid' });
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://esncard.org/services/1.0/card.json?code=TESTESNVERIFY',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
