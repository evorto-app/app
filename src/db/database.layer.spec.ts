import { ConfigProvider, Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('database.layer', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unmock('../server/config/database-config');
    vi.unmock('@effect/sql-pg/PgClient');
    vi.unmock('drizzle-orm/effect-postgres');
  });

  it('wires PgClient layer with the configured database URL', async () => {
    const pgLayerMock = vi.fn((_config: { url: unknown }) =>
      Layer.empty,
    );
    const makeMock = vi.fn(() => Effect.succeed({}));

    vi.doMock('@effect/sql-pg/PgClient', () => ({
      layer: pgLayerMock,
    }));
    vi.doMock('drizzle-orm/effect-postgres', () => ({
      DefaultServices: Layer.empty,
      EffectLogger: {
        layer: Layer.empty,
      },
      make: makeMock,
    }));

    const module = await import('./database.layer');
    const provider = ConfigProvider.fromMap(
      new Map([
        ['DATABASE_URL', 'postgresql://db-user:db-pass@db.example.com/app'],
      ]),
    );

    await Effect.runPromise(
      module.Database.pipe(
        Effect.provide(module.databaseLayer),
        Effect.provide(Layer.setConfigProvider(provider)),
      ),
    );

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
