import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('database.layer', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unmock('../server/config/environment');
    vi.unmock('@effect/sql-pg/PgClient');
    vi.unmock('drizzle-orm/effect-postgres');
  });

  it('wires PgClient layer with the configured database URL', async () => {
    const pgLayerMock = vi.fn((_config: { url: unknown }) =>
      Symbol('pg-layer'),
    );
    const makeMock = vi.fn(() => Effect.succeed({}));

    vi.doMock('../server/config/environment', () => ({
      getDatabaseEnvironment: () => ({
        DATABASE_URL: 'postgresql://db-user:db-pass@db.example.com/app',
      }),
    }));
    vi.doMock('@effect/sql-pg/PgClient', () => ({
      layer: pgLayerMock,
    }));
    vi.doMock('drizzle-orm/effect-postgres', () => ({
      DefaultServices: Symbol('default-services'),
      EffectLogger: {
        layer: Symbol('effect-logger'),
      },
      make: makeMock,
    }));

    const module = await import('./database.layer');

    expect(makeMock).toHaveBeenCalledWith({
      relations: expect.anything(),
    });
    expect(pgLayerMock).toHaveBeenCalledTimes(1);
    const firstPgLayerCall = pgLayerMock.mock.calls[0];
    if (!firstPgLayerCall) {
      throw new Error('Expected PgClient.layer to be called');
    }
    const layerInput = firstPgLayerCall[0];
    expect(layerInput).toHaveProperty('url');
    expect(String(layerInput.url)).not.toContain(
      'postgresql://db-user:db-pass@db.example.com/app',
    );
    expect(module.databaseLayer).toBe(module.Database.Default);
  });
});
