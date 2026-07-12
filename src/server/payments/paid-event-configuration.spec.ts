import { describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';

import {
  eventAddons,
  eventInstances,
  eventRegistrationOptions,
  templateEventAddons,
  templateRegistrationOptions,
} from '../../db/schema';
import {
  ensureStripeForPaidEventConfiguration,
  ensureStripeForStoredEventConfiguration,
  eventConfigurationHasPaidItems,
  tenantHasPaidEventConfiguration,
} from './paid-event-configuration';

const selectResult = (rows: readonly Record<string, unknown>[]) => {
  const query = {
    for: vi.fn(() => Effect.succeed(rows)),
    from: vi.fn(() => query),
    innerJoin: vi.fn(() => query),
    limit: vi.fn(() => Effect.succeed(rows)),
    where: vi.fn(() => query),
  };
  return query;
};

describe('paid event configuration', () => {
  it('treats both paid flags and positive stored prices as paid configuration', () => {
    expect(
      eventConfigurationHasPaidItems({
        addOns: [],
        registrationOptions: [{ isPaid: true, price: 0 }],
      }),
    ).toBe(true);
    expect(
      eventConfigurationHasPaidItems({
        addOns: [{ isPaid: false, price: 1 }],
        registrationOptions: [],
      }),
    ).toBe(true);
    expect(
      eventConfigurationHasPaidItems({
        addOns: [{ isPaid: false, price: 0 }],
        registrationOptions: [{ isPaid: false, price: 0 }],
      }),
    ).toBe(false);
  });

  it.effect('rejects a paid write using the locked tenant Stripe state', () =>
    Effect.gen(function* () {
      const select = vi.fn(() => selectResult([{ stripeAccountId: null }]));

      const error = yield* ensureStripeForPaidEventConfiguration(
        { select } as never,
        'tenant-1',
        {
          addOns: [],
          registrationOptions: [{ isPaid: true, price: 1000 }],
        },
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        reason: 'stripeRequiredForPaidEventConfiguration',
      });
      expect(select).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect(
    'rejects review approval for a tenant-scoped paid event without Stripe',
    () =>
      Effect.gen(function* () {
        const select = vi.fn((selection: Record<string, unknown>) => {
          if (Reflect.has(selection, 'stripeAccountId')) {
            return selectResult([{ stripeAccountId: null }]);
          }
          if (selection.id === eventInstances.id) {
            return selectResult([{ id: 'event-1' }]);
          }
          if (selection.id === eventRegistrationOptions.id) {
            return selectResult([{ id: 'option-1' }]);
          }
          throw new Error('Unexpected paid event configuration query');
        });

        const error = yield* ensureStripeForStoredEventConfiguration(
          { select } as never,
          'tenant-1',
          'event-1',
        ).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'stripeRequiredForPaidEventConfiguration',
        });
        expect(select).toHaveBeenCalledTimes(3);
      }),
  );

  it.effect(
    'does not inspect configuration when the event is outside the tenant boundary',
    () =>
      Effect.gen(function* () {
        const select = vi.fn((selection: Record<string, unknown>) => {
          if (Reflect.has(selection, 'stripeAccountId')) {
            return selectResult([{ stripeAccountId: null }]);
          }
          if (selection.id === eventInstances.id) {
            return selectResult([]);
          }
          throw new Error('Cross-tenant configuration must not be queried');
        });

        yield* ensureStripeForStoredEventConfiguration(
          { select } as never,
          'tenant-1',
          'event-outside-tenant',
        );

        expect(select).toHaveBeenCalledTimes(2);
      }),
  );

  it.effect(
    'detects every paid event and template registration option or add-on shape',
    () =>
      Effect.gen(function* () {
        const scenarios = [
          {
            expectedSelectCount: 1,
            selectedId: eventRegistrationOptions.id,
          },
          { expectedSelectCount: 2, selectedId: eventAddons.id },
          {
            expectedSelectCount: 3,
            selectedId: templateRegistrationOptions.id,
          },
          { expectedSelectCount: 4, selectedId: templateEventAddons.id },
        ] as const;

        for (const scenario of scenarios) {
          const select = vi.fn((selection: Record<string, unknown>) =>
            selectResult(
              selection.id === scenario.selectedId
                ? [{ id: 'paid-configuration-1' }]
                : [],
            ),
          );

          const hasPaidConfiguration = yield* tenantHasPaidEventConfiguration(
            { select } as never,
            'tenant-1',
          );

          expect(hasPaidConfiguration).toBe(true);
          expect(select).toHaveBeenCalledTimes(scenario.expectedSelectCount);
        }
      }),
  );

  it.effect('allows Stripe removal after every stored price is free', () =>
    Effect.gen(function* () {
      const select = vi.fn(() => selectResult([]));

      const hasPaidConfiguration = yield* tenantHasPaidEventConfiguration(
        { select } as never,
        'tenant-1',
      );

      expect(hasPaidConfiguration).toBe(false);
      expect(select).toHaveBeenCalledTimes(4);
    }),
  );
});
