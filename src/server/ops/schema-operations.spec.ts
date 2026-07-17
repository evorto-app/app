import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  analyzeSchemaPlan,
  applySchema,
  type OpsCommandRunner,
  seedStaging,
} from './schema-operations';

const result = (value: unknown) => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

describe('ops schema operations', () => {
  it('accepts expand-only plans', () => {
    const analysis = analyzeSchemaPlan({
      dialect: 'postgresql',
      hints: [],
      statements: [
        {
          table: { name: 'new_table', schema: 'public' },
          type: 'create_table',
        },
        {
          column: {
            name: 'optional_note',
            notNull: false,
            table: 'events',
          },
          type: 'add_column',
        },
      ],
      status: 'ok',
    });

    expect(analysis.safe).toBe(true);
    expect(analysis.unsafeReasons).toEqual([]);
  });

  it.each([
    ['drop table', { table: { name: 'events' }, type: 'drop_table' }],
    [
      'required column without a default',
      {
        column: { name: 'required', notNull: true, table: 'events' },
        type: 'add_column',
      },
    ],
    [
      'unique index on a populated table',
      {
        index: {
          concurrently: true,
          isUnique: true,
          name: 'events_slug_unique',
          table: 'events',
        },
        type: 'create_index',
      },
    ],
  ])('rejects %s', (_, statement) => {
    const analysis = analyzeSchemaPlan({
      dialect: 'postgresql',
      hints: [],
      statements: [statement],
      status: 'ok',
    });

    expect(analysis.safe).toBe(false);
    expect(analysis.unsafeReasons).toHaveLength(1);
  });

  it.effect('rechecks the plan digest immediately before applying', () =>
    Effect.gen(function* () {
      const commands: readonly string[][] = [];
      const runner: OpsCommandRunner = {
        run: (command) => {
          (commands as string[][]).push([...command]);
          return Effect.succeed(
            result({
              dialect: 'postgresql',
              hints: [],
              statements: [],
              status: 'ok',
            }),
          );
        },
      };

      const response = yield* applySchema('different-digest', runner);

      expect(response.applied).toBe(false);
      expect(response.reason).toBe('plan-changed');
      expect(commands).toHaveLength(1);
    }),
  );

  it.effect(
    'applies fixed prerequisites before the approved Drizzle plan',
    () =>
      Effect.gen(function* () {
        const plan = {
          dialect: 'postgresql',
          hints: [],
          statements: [],
          status: 'ok',
        };
        const commands: string[][] = [];
        const runner: OpsCommandRunner = {
          run: (command) => {
            commands.push([...command]);
            return Effect.succeed(
              commands.length === 2
                ? { exitCode: 0, stderr: '', stdout: '' }
                : result(plan),
            );
          },
        };

        const response = yield* applySchema(
          analyzeSchemaPlan(plan).digest,
          runner,
        );

        expect(response.applied).toBe(true);
        expect(commands).toHaveLength(3);
        expect(commands[1]).toEqual([
          'bun',
          'dist/evorto/ops/database-prerequisites.mjs',
        ]);
      }),
  );

  it.effect(
    'resets, reapplies, and seeds staging only through fixed commands',
    () =>
      Effect.gen(function* () {
        const commands: {
          command: readonly string[];
          environment?: Readonly<Record<string, string>>;
        }[] = [];
        const runner: OpsCommandRunner = {
          run: (command, options) => {
            commands.push({ command, environment: options?.environment });
            return Effect.succeed(
              command.some((argument) => argument.endsWith('/drizzle-kit.cjs'))
                ? result({ status: 'ok' })
                : { exitCode: 0, stderr: '', stdout: '' },
            );
          },
        };

        const response = yield* seedStaging('reset-and-seed-staging', runner);

        expect(response).toEqual({ reset: true, seeded: true });
        expect(commands).toEqual([
          {
            command: ['bun', 'dist/evorto/ops/reset-staging-database.mjs'],
            environment: {
              STAGING_RESET_CONFIRMATION: 'reset-and-seed-staging',
            },
          },
          {
            command: ['bun', 'dist/evorto/ops/database-prerequisites.mjs'],
            environment: undefined,
          },
          {
            command: [
              'bun',
              'ops/drizzle-kit.cjs',
              'push',
              '--config',
              'ops/drizzle.config.mjs',
              '--force',
              '--output',
              'json',
            ],
            environment: undefined,
          },
          {
            command: ['bun', 'dist/evorto/ops/seed-staging.mjs'],
            environment: undefined,
          },
        ]);
      }),
  );
});
