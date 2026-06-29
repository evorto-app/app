import { describe, expect, it, vi } from '@effect/vitest';

import { ProviderValidationUnavailableError, validateEsnCard } from './index';

const createFetchMock = (body: unknown, init?: ResponseInit): typeof fetch =>
  vi.fn(async () =>
    Response.json(body, {
      headers: { 'content-type': 'application/json' },
      status: 200,
      ...init,
    }),
  );

describe('validateEsnCard', () => {
  it('validates active cards and preserves provider metadata', async () => {
    const fetchImpl = createFetchMock([
      {
        'expiration-date': '2026-12-31T00:00:00.000Z',
        status: 'active',
      },
    ]);

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
    const fetchImpl = createFetchMock([]);

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'UNKNOWN' }),
    ).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('distinguishes provider failures from invalid cards', async () => {
    const fetchImpl = createFetchMock(
      { error: 'temporarily unavailable' },
      { status: 503 },
    );

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'ESN-123' }),
    ).rejects.toMatchObject({
      name: 'ProviderValidationUnavailableError',
      reason: 'unavailable',
    } satisfies Partial<ProviderValidationUnavailableError>);
  });
});
