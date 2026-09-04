import { describe, expect, it, vi } from '@effect/vitest';

import { ProviderValidationUnavailableError, validateEsnCard } from './index';

const createFetchMock = (
  body: unknown,
  init?: ResponseInit,
): NonNullable<Parameters<typeof validateEsnCard>[0]['fetchImpl']> =>
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
        'activation date': '2026-01-01',
        'expiration-date': '2026-12-31',
        status: 'active',
      },
    ]);

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'ESN-123' }),
    ).resolves.toMatchObject({
      metadata: {
        'activation date': '2026-01-01',
        'expiration-date': '2026-12-31',
        status: 'active',
      },
      status: 'verified',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validTo: new Date('2026-12-31T00:00:00.000Z'),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.esncard.org/services/1.0/card.json?code=ESN-123',
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

  it('preserves an expired provider status as an ineligible card state', async () => {
    const fetchImpl = createFetchMock([
      {
        'activation date': '2025-01-01',
        'expiration-date': '2025-12-31',
        status: 'expired',
      },
    ]);

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'EXPIRED-ESN-123' }),
    ).resolves.toMatchObject({
      status: 'expired',
      validFrom: new Date('2025-01-01T00:00:00.000Z'),
      validTo: new Date('2025-12-31T00:00:00.000Z'),
    });
  });

  it('rejects unsupported or incomplete provider payloads', async () => {
    const activation = '2026-01-01';
    const expiration = '2026-12-31';
    const malformedPayloads: unknown[] = [
      {},
      [
        {
          'activation date': activation,
          expiration_date: expiration,
          status: 'active',
        },
      ],
      [
        {
          'activation date': activation,
          'expiration-date': expiration,
        },
      ],
      [
        {
          'activation date': activation,
          'expiration-date': expiration,
          status: 'inactive',
        },
      ],
      [
        {
          'activation date': activation,
          'expiration-date': '2026-02-31',
          status: 'active',
        },
      ],
      [
        {
          'activation date': '2026-01-01T00:00:00.000Z',
          'expiration-date': expiration,
          status: 'active',
        },
      ],
      [
        {
          'activation date': '2027-01-01',
          'expiration-date': expiration,
          status: 'active',
        },
      ],
      [
        {
          'activation date': activation,
          'expiration-date': expiration,
          status: 'active',
        },
        {
          'activation date': activation,
          'expiration-date': expiration,
          status: 'active',
        },
      ],
    ];

    for (const body of malformedPayloads) {
      await expect(
        validateEsnCard({
          fetchImpl: createFetchMock(body),
          identifier: 'ESN-123',
        }),
      ).rejects.toMatchObject({
        name: 'ProviderValidationUnavailableError',
        reason: 'invalidResponse',
      } satisfies Partial<ProviderValidationUnavailableError>);
    }
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

  it('classifies unreadable provider JSON as an invalid response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('not-json', {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );

    await expect(
      validateEsnCard({ fetchImpl, identifier: 'ESN-123' }),
    ).rejects.toMatchObject({
      name: 'ProviderValidationUnavailableError',
      reason: 'invalidResponse',
    } satisfies Partial<ProviderValidationUnavailableError>);
  });
});
