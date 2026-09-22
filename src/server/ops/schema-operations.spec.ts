import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import {
  analyzeSchemaPlan,
  applySchema,
  explainSchema,
  initializeEmptyStaging,
  type OpsCommandRunner,
  seedStaging,
} from './schema-operations';

const result = (value: unknown) => ({
  exitCode: 0,
  stderr: '',
  stdout: JSON.stringify(value),
});

const emptyPlan = () => ({
  dialect: 'postgresql' as const,
  hints: [],
  statements: [],
  status: 'ok' as const,
});

describe('ops schema operations', () => {
  it.each([
    { message: 'Missing STRIPE_TEST_ACCOUNT_ID', operation: 'initialize' },
    { message: 'Missing STRIPE_TEST_ACCOUNT_ID', operation: 'reset' },
    { message: 'Invalid E2E_NOW_ISO value', operation: 'initialize' },
    { message: 'Invalid E2E_NOW_ISO value', operation: 'reset' },
  ])(
    'does not touch staging when $operation seed preflight fails: $message',
    async ({ message, operation }) => {
      const commands: {
        command: readonly string[];
        environment?: Readonly<Record<string, string>>;
      }[] = [];
      const runner: OpsCommandRunner = {
        run: (command, options) => {
          commands.push({ command, environment: options?.environment });
          return Effect.succeed({
            exitCode: 1,
            stderr: message,
            stdout: '',
          });
        },
      };
      const effect =
        operation === 'initialize'
          ? initializeEmptyStaging(runner).pipe(Effect.asVoid)
          : seedStaging('reset-and-seed-staging', runner).pipe(Effect.asVoid);
      const failure = await Effect.runPromise(Effect.flip(effect));

      expect(failure.diagnostic).toBe('command-failed');
      expect(failure.message).toBe('Staging seed preflight failed (exit 1)');
      expect(commands).toEqual([
        {
          command: ['bun', 'dist/evorto/ops/seed-staging.mjs'],
          environment: { STAGING_SEED_PREFLIGHT_ONLY: 'true' },
        },
      ]);
    },
  );

  it.effect(
    'fails the original Drizzle command without a diagnostic rerun',
    () =>
      Effect.gen(function* () {
        const commands: string[][] = [];
        const runner: OpsCommandRunner = {
          run: (command) => {
            commands.push([...command]);
            return Effect.succeed({
              exitCode: 17,
              stderr: 'the real provider failure',
              stdout: '',
            });
          },
        };

        const error = yield* explainSchema(runner).pipe(Effect.flip);

        expect(error.diagnostic).toBe('command-failed');
        expect(error.message).toBe('Drizzle failed (exit 17)');
        expect(commands).toHaveLength(1);
      }),
  );

  it.effect(
    'rejects a changed Drizzle envelope instead of interpreting it',
    () =>
      Effect.gen(function* () {
        const commands: string[][] = [];
        const runner: OpsCommandRunner = {
          run: (command) => {
            commands.push([...command]);
            return Effect.succeed(result({ statements: [], status: 'ok' }));
          },
        };

        const error = yield* explainSchema(runner).pipe(Effect.flip);

        expect(error.diagnostic).toBe('drizzle-output-invalid');
        expect(error.message).toBe(
          'Drizzle explain output changed from the pinned contract',
        );
        expect(commands).toHaveLength(1);
      }),
  );

  it('accepts expand-only plans', () => {
    const analysis = analyzeSchemaPlan({
      dialect: 'postgresql',
      hints: [],
      statements: [
        {
          table: {
            name: 'new_table',
            schema: 'public',
          },
          type: 'create_table',
        },
        {
          column: {
            name: 'optional_note',
            notNull: false,
            schema: 'public',
            table: 'events',
          },
          isCompositePK: false,
          isPK: false,
          type: 'add_column',
        },
      ],
      status: 'ok',
    });

    expect(analysis.safe).toBe(true);
    expect(analysis.unsafeReasons).toEqual([]);
  });

  it('binds the plan digest to supplementary statement metadata', () => {
    const plan = {
      ...emptyPlan(),
      statements: [
        {
          metadata: { source: 'first' },
          table: { name: 'new_table', schema: 'public' },
          type: 'create_table',
        },
      ],
    };
    const first = analyzeSchemaPlan(plan);
    const changed = analyzeSchemaPlan({
      ...plan,
      statements: plan.statements.map((statement) => ({
        ...statement,
        metadata: { source: 'second' },
      })),
    });

    expect(first.safe).toBe(true);
    expect(changed.safe).toBe(true);
    expect(first.digest).not.toBe(changed.digest);
    expect(plan.statements[0]?.metadata).toEqual({ source: 'first' });
  });

  it('rejects legacy statement shapes instead of guessing table identity', () => {
    const analysis = analyzeSchemaPlan({
      dialect: 'postgresql',
      hints: [],
      statements: [{ table: 'events', type: 'create_table' }],
      status: 'ok',
    });

    expect(analysis.safe).toBe(false);
    expect(analysis.unsafeReasons).toEqual([
      'Statement 1 (create_table) does not match the pinned Drizzle statement contract',
    ]);
  });

  it.each([
    ['drop table', { table: { name: 'events' }, type: 'drop_table' }],
    [
      'required column without a default',
      {
        column: {
          name: 'required',
          notNull: true,
          schema: 'public',
          table: 'events',
        },
        isCompositePK: false,
        isPK: false,
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
          schema: 'public',
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
      const commands: string[][] = [];
      const runner: OpsCommandRunner = {
        run: (command) => {
          commands.push([...command]);
          return Effect.succeed(result(emptyPlan()));
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
        const plan = emptyPlan();
        const commands: string[][] = [];
        const runner: OpsCommandRunner = {
          run: (command) => {
            commands.push([...command]);
            return Effect.succeed(
              commands.length === 2
                ? { exitCode: 0, stderr: '', stdout: '' }
                : commands.length === 3
                  ? result({ dialect: 'postgresql', status: 'ok' })
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

  it.effect('runs a failed apply command exactly once', () =>
    Effect.gen(function* () {
      const plan = emptyPlan();
      const commands: string[][] = [];
      const runner: OpsCommandRunner = {
        run: (command) => {
          commands.push([...command]);
          if (commands.length === 1) return Effect.succeed(result(plan));
          if (commands.length === 2) {
            return Effect.succeed({ exitCode: 0, stderr: '', stdout: '' });
          }
          return Effect.succeed({
            exitCode: 1,
            stderr: 'permission denied for schema public',
            stdout: '',
          });
        },
      };

      const error = yield* applySchema(
        analyzeSchemaPlan(plan).digest,
        runner,
      ).pipe(Effect.flip);

      expect(error.message).toBe('Drizzle failed (exit 1)');
      expect(commands).toHaveLength(3);
      expect(commands[2]).toEqual([
        'bun',
        'ops/drizzle-kit.cjs',
        'push',
        '--config',
        'ops/drizzle.config.mjs',
        '--force',
        '--output',
        'json',
      ]);
    }),
  );

  it.effect(
    'initializes staging through the seed executable in non-destructive mode',
    () =>
      Effect.gen(function* () {
        const commands: {
          command: readonly string[];
          environment?: Readonly<Record<string, string>>;
        }[] = [];
        const runner: OpsCommandRunner = {
          run: (command, options) => {
            commands.push({ command, environment: options?.environment });
            return Effect.succeed({ exitCode: 0, stderr: '', stdout: '' });
          },
        };

        const response = yield* initializeEmptyStaging(runner);

        expect(response).toEqual({ initialized: true });
        expect(commands).toEqual([
          {
            command: ['bun', 'dist/evorto/ops/seed-staging.mjs'],
            environment: { STAGING_SEED_PREFLIGHT_ONLY: 'true' },
          },
          {
            command: ['bun', 'dist/evorto/ops/seed-staging.mjs'],
            environment: { STAGING_INITIALIZE_ONLY: 'true' },
          },
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
                ? result({ dialect: 'postgresql', status: 'ok' })
                : { exitCode: 0, stderr: '', stdout: '' },
            );
          },
        };

        const response = yield* seedStaging('reset-and-seed-staging', runner);

        expect(response).toEqual({ reset: true, seeded: true });
        expect(commands).toEqual([
          {
            command: ['bun', 'dist/evorto/ops/seed-staging.mjs'],
            environment: { STAGING_SEED_PREFLIGHT_ONLY: 'true' },
          },
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
