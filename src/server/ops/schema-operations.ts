import { Effect, Option, Schema } from 'effect';
import { createHash } from 'node:crypto';

const maximumCommandOutputBytes = 4 * 1024 * 1024;
const commandTimeoutMs = 2 * 60 * 1000;
const drizzleExecutable = 'ops/drizzle-kit.cjs';
const drizzleConfig = 'ops/drizzle.config.mjs';
const databasePrerequisitesExecutable =
  'dist/evorto/ops/database-prerequisites.mjs';
const stagingResetExecutable = 'dist/evorto/ops/reset-staging-database.mjs';
const stagingSeedExecutable = 'dist/evorto/ops/seed-staging.mjs';

export const opsCommandDiagnostics = [
  'command-failed',
  'drizzle-output-invalid',
] as const;

export type OpsCommandDiagnostic = (typeof opsCommandDiagnostics)[number];

export interface OpsCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface OpsCommandRunner {
  readonly run: (
    command: readonly string[],
    options?: {
      readonly environment?: Readonly<Record<string, string>>;
    },
  ) => Effect.Effect<OpsCommandResult, OpsCommandError>;
}

export class OpsCommandError extends Schema.TaggedError<OpsCommandError>()(
  'OpsCommandError',
  {
    cause: Schema.optional(Schema.Defect()),
    diagnostic: Schema.Literals(opsCommandDiagnostics),
    message: Schema.String,
  },
) {}

const outputByteLength = (output: string) =>
  new TextEncoder().encode(output).byteLength;

const failOpsCommand = Effect.fn('failOpsCommand')(function* (
  operation: string,
  command: readonly string[],
  result: OpsCommandResult,
) {
  yield* Effect.logError('Ops command failed').pipe(
    Effect.annotateLogs({
      command: command.join(' '),
      exitCode: result.exitCode,
      operation,
      stderrBytes: outputByteLength(result.stderr),
      stdoutBytes: outputByteLength(result.stdout),
    }),
  );
  return yield* OpsCommandError.make({
    diagnostic: 'command-failed',
    message: `${operation} failed (exit ${result.exitCode})`,
  });
});

const commandOutput = async (
  stream: ReadableStream<Uint8Array>,
): Promise<string> => {
  const output = await new Response(stream).arrayBuffer();
  if (output.byteLength > maximumCommandOutputBytes) {
    throw new Error('Ops command output exceeded the configured limit');
  }
  return new TextDecoder().decode(output);
};

export const liveOpsCommandRunner: OpsCommandRunner = {
  run: (command, options) =>
    Effect.tryPromise({
      catch: (cause) =>
        OpsCommandError.make({
          cause,
          diagnostic: 'command-failed',
          message: 'The ops command could not complete',
        }),
      try: async () => {
        const subprocess = Bun.spawn([...command], {
          env: {
            ...process.env,
            ...options?.environment,
          },
          stderr: 'pipe',
          stdout: 'pipe',
        });
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          subprocess.kill();
        }, commandTimeoutMs);

        try {
          const [exitCode, stderr, stdout] = await Promise.all([
            subprocess.exited,
            commandOutput(subprocess.stderr),
            commandOutput(subprocess.stdout),
          ]);
          if (timedOut) {
            throw new Error('Ops command timed out');
          }
          return { exitCode, stderr, stdout };
        } finally {
          clearTimeout(timeout);
        }
      },
    }).pipe(
      Effect.tapError((error) =>
        Effect.logError('Ops command process failed').pipe(
          Effect.annotateLogs({
            cause: String(error.cause),
            command: command.join(' '),
          }),
        ),
      ),
    ),
};

const PostgresDialect = Schema.Literal('postgresql');
const DrizzleNoChangesEnvelope = Schema.Struct({
  dialect: PostgresDialect,
  status: Schema.Literal('no_changes'),
});
const DrizzleHint = Schema.Struct({ hint: Schema.String });
const DrizzleExplainPlanEnvelope = Schema.Struct({
  dialect: PostgresDialect,
  hints: Schema.Array(DrizzleHint),
  statements: Schema.Array(Schema.Unknown),
  status: Schema.Literal('ok'),
});
const DrizzleExplainEnvelope = Schema.Union([
  DrizzleNoChangesEnvelope,
  DrizzleExplainPlanEnvelope,
]);
const DrizzleApplyEnvelope = Schema.Union([
  DrizzleNoChangesEnvelope,
  Schema.Struct({
    dialect: PostgresDialect,
    status: Schema.Literal('ok'),
  }),
]);

type DrizzleExplainEnvelope = typeof DrizzleExplainEnvelope.Type;

// Classification only projects these fields; the digest retains the original plan.
const statementParseOptions = {
  onExcessProperty: 'ignore',
} as const;
const StatementHeader = Schema.Struct({ type: Schema.String });
const TableIdentity = Schema.Struct({
  name: Schema.String,
  schema: Schema.String,
});
const TableMemberIdentity = Schema.Struct({
  schema: Schema.String,
  table: Schema.String,
});
const EnumIdentity = Schema.Struct({
  name: Schema.String,
  schema: Schema.String,
  values: Schema.Array(Schema.String),
});
const ColumnGenerated = Schema.Struct({
  as: Schema.String,
  type: Schema.Literal('stored'),
});
const ColumnIdentity = Schema.Struct({
  cache: Schema.optional(Schema.Number),
  cycle: Schema.optional(Schema.Boolean),
  increment: Schema.optional(Schema.String),
  maxValue: Schema.optional(Schema.String),
  minValue: Schema.optional(Schema.String),
  name: Schema.String,
  startWith: Schema.optional(Schema.String),
  type: Schema.Literals(['always', 'byDefault']),
});
const CreateTableStatement = Schema.Struct({
  table: TableIdentity,
  type: Schema.Literal('create_table'),
});
const CreateEnumStatement = Schema.Struct({
  enum: EnumIdentity,
  type: Schema.Literal('create_enum'),
});
const CreateSchemaStatement = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal('create_schema'),
});
const CreateSequenceStatement = Schema.Struct({
  sequence: Schema.Struct({
    name: Schema.String,
    schema: Schema.String,
  }),
  type: Schema.Literal('create_sequence'),
});
const CreateViewStatement = Schema.Struct({
  type: Schema.Literal('create_view'),
  view: Schema.Struct({
    materialized: Schema.Boolean,
    name: Schema.String,
    schema: Schema.String,
  }),
});
const AddColumnStatement = Schema.Struct({
  column: Schema.Struct({
    default: Schema.optional(Schema.String),
    generated: Schema.optional(ColumnGenerated),
    identity: Schema.optional(ColumnIdentity),
    name: Schema.String,
    notNull: Schema.Boolean,
    schema: Schema.String,
    table: Schema.String,
  }),
  isCompositePK: Schema.Boolean,
  isPK: Schema.Boolean,
  type: Schema.Literal('add_column'),
});
const AlterEnumStatement = Schema.Struct({
  diff: Schema.Array(
    Schema.Struct({
      beforeValue: Schema.optional(Schema.String),
      type: Schema.Literals(['same', 'removed', 'added']),
      value: Schema.String,
    }),
  ),
  from: EnumIdentity,
  to: EnumIdentity,
  type: Schema.Literal('alter_enum'),
});
const CreateIndexStatement = Schema.Struct({
  index: Schema.Struct({
    concurrently: Schema.Boolean,
    isUnique: Schema.Boolean,
    name: Schema.String,
    schema: Schema.String,
    table: Schema.String,
  }),
  type: Schema.Literal('create_index'),
});
const CreateForeignKeyStatement = Schema.Struct({
  fk: TableMemberIdentity,
  type: Schema.Literal('create_fk'),
});
const AddUniqueStatement = Schema.Struct({
  type: Schema.Literal('add_unique'),
  unique: TableMemberIdentity,
});
const AddCheckStatement = Schema.Struct({
  check: TableMemberIdentity,
  type: Schema.Literal('add_check'),
});
const AddPrimaryKeyStatement = Schema.Struct({
  pk: TableMemberIdentity,
  type: Schema.Literal('add_pk'),
});
const ApprovedExpandStatement = Schema.Union([
  AddCheckStatement,
  AddColumnStatement,
  AddPrimaryKeyStatement,
  AddUniqueStatement,
  AlterEnumStatement,
  CreateEnumStatement,
  CreateForeignKeyStatement,
  CreateIndexStatement,
  CreateSchemaStatement,
  CreateSequenceStatement,
  CreateTableStatement,
  CreateViewStatement,
]);
const approvedExpandStatementTypes: ReadonlySet<string> = new Set([
  'add_check',
  'add_column',
  'add_pk',
  'add_unique',
  'alter_enum',
  'create_enum',
  'create_fk',
  'create_index',
  'create_schema',
  'create_sequence',
  'create_table',
  'create_view',
]);

const decodeStatementHeader = Schema.decodeUnknownOption(
  StatementHeader,
  statementParseOptions,
);
const decodeApprovedExpandStatement = Schema.decodeUnknownOption(
  ApprovedExpandStatement,
  statementParseOptions,
);

const planDigest = (plan: DrizzleExplainEnvelope): string =>
  createHash('sha256').update(JSON.stringify(plan)).digest('hex');

const tableKey = (table: typeof TableIdentity.Type) =>
  `${table.schema}.${table.name}`;

const tableMemberKey = (member: typeof TableMemberIdentity.Type) =>
  `${member.schema}.${member.table}`;

const contractMismatchReason = (index: number, type: string) =>
  `Statement ${index + 1} (${type}) does not match the pinned Drizzle statement contract`;

const unsafeOperationReason = (index: number, type: string) =>
  `Statement ${index + 1} (${type}) is not an approved expand operation`;

const analyzeStatement = (
  statement: unknown,
  index: number,
  createdTables: ReadonlySet<string>,
): string | undefined => {
  const header = Option.getOrUndefined(decodeStatementHeader(statement));
  if (!header) {
    return contractMismatchReason(index, 'invalid_statement');
  }
  const decoded = Option.getOrUndefined(
    decodeApprovedExpandStatement(statement),
  );
  if (!decoded) {
    return approvedExpandStatementTypes.has(header.type)
      ? contractMismatchReason(index, header.type)
      : unsafeOperationReason(index, header.type);
  }

  switch (decoded.type) {
    case 'add_check': {
      return createdTables.has(tableMemberKey(decoded.check))
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
    case 'add_column': {
      if (!decoded.column.notNull) {
        return;
      }
      return decoded.column.default !== undefined ||
        decoded.column.generated !== undefined ||
        decoded.column.identity !== undefined
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
    case 'add_pk': {
      return createdTables.has(tableMemberKey(decoded.pk))
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
    case 'add_unique': {
      return createdTables.has(tableMemberKey(decoded.unique))
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
    case 'alter_enum': {
      return decoded.diff.every((difference) => difference.type === 'added')
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
    case 'create_enum':
    case 'create_schema':
    case 'create_sequence':
    case 'create_table':
    case 'create_view': {
      return;
    }
    case 'create_fk': {
      return createdTables.has(tableMemberKey(decoded.fk))
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
    case 'create_index': {
      if (createdTables.has(tableMemberKey(decoded.index))) {
        return;
      }
      return !decoded.index.isUnique && decoded.index.concurrently
        ? undefined
        : unsafeOperationReason(index, decoded.type);
    }
  }
};

export interface SchemaPlanAnalysis {
  readonly digest: string;
  readonly safe: boolean;
  readonly statementTypes: readonly string[];
  readonly unsafeReasons: readonly string[];
}

export const analyzeSchemaPlan = (
  plan: DrizzleExplainEnvelope,
): SchemaPlanAnalysis => {
  if (plan.status === 'no_changes') {
    return {
      digest: planDigest(plan),
      safe: true,
      statementTypes: [],
      unsafeReasons: [],
    };
  }

  const createdTables = new Set(
    plan.statements.flatMap((statement) => {
      const decoded = Option.getOrUndefined(
        decodeApprovedExpandStatement(statement),
      );
      return decoded?.type === 'create_table' ? [tableKey(decoded.table)] : [];
    }),
  );
  const statementTypes = plan.statements.map(
    (statement) =>
      Option.getOrUndefined(decodeStatementHeader(statement))?.type ??
      'invalid_statement',
  );
  const unsafeReasons = plan.statements.flatMap((statement, index) => {
    const reason = analyzeStatement(statement, index, createdTables);
    return reason ? [reason] : [];
  });
  if (plan.hints.length > 0) {
    unsafeReasons.unshift('Drizzle reported data-loss or confirmation hints');
  }

  return {
    digest: planDigest(plan),
    safe: unsafeReasons.length === 0,
    statementTypes,
    unsafeReasons,
  };
};

const logInvalidDrizzleOutput = (
  command: readonly string[],
  result: OpsCommandResult,
  error: OpsCommandError,
) =>
  Effect.logError('Drizzle output did not match the pinned contract').pipe(
    Effect.annotateLogs({
      command: command.join(' '),
      diagnostic: error.diagnostic,
      exitCode: result.exitCode,
      stderrBytes: outputByteLength(result.stderr),
      stdoutBytes: outputByteLength(result.stdout),
    }),
  );

const parseCommandJson = Effect.fn('parseCommandJson')(function* (
  command: readonly string[],
  result: OpsCommandResult,
) {
  if (result.exitCode !== 0) {
    return yield* failOpsCommand('Drizzle', command, result);
  }
  return yield* Effect.try({
    catch: (cause) => cause,
    try: () => JSON.parse(result.stdout),
  }).pipe(
    Effect.catch((error) =>
      error instanceof SyntaxError
        ? Effect.fail(
            OpsCommandError.make({
              diagnostic: 'drizzle-output-invalid',
              message: 'Drizzle returned invalid JSON output',
            }),
          )
        : Effect.die(error),
    ),
    Effect.tapError((error) => logInvalidDrizzleOutput(command, result, error)),
  );
});

const decodeExplainResult = Effect.fn('decodeExplainResult')(function* (
  command: readonly string[],
  result: OpsCommandResult,
) {
  const parsed = yield* parseCommandJson(command, result);
  return yield* Schema.decodeUnknownEffect(DrizzleExplainEnvelope, {
    errors: 'all',
    onExcessProperty: 'error',
  })(parsed).pipe(
    Effect.mapError(() =>
      OpsCommandError.make({
        diagnostic: 'drizzle-output-invalid',
        message: 'Drizzle explain output changed from the pinned contract',
      }),
    ),
    Effect.tapError((error) => logInvalidDrizzleOutput(command, result, error)),
  );
});

const decodeApplyResult = Effect.fn('decodeApplyResult')(function* (
  command: readonly string[],
  result: OpsCommandResult,
) {
  const parsed = yield* parseCommandJson(command, result);
  return yield* Schema.decodeUnknownEffect(DrizzleApplyEnvelope, {
    errors: 'all',
    onExcessProperty: 'error',
  })(parsed).pipe(
    Effect.mapError(() =>
      OpsCommandError.make({
        diagnostic: 'drizzle-output-invalid',
        message: 'Drizzle apply output changed from the pinned contract',
      }),
    ),
    Effect.tapError((error) => logInvalidDrizzleOutput(command, result, error)),
  );
});

const explainCommand = [
  'bun',
  drizzleExecutable,
  'push',
  '--config',
  drizzleConfig,
  '--explain',
  '--output',
  'json',
] as const;

const applyCommand = [
  'bun',
  drizzleExecutable,
  'push',
  '--config',
  drizzleConfig,
  '--force',
  '--output',
  'json',
] as const;

export const explainSchema = (
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  runner.run(explainCommand).pipe(
    Effect.flatMap((result) => decodeExplainResult(explainCommand, result)),
    Effect.map((plan) => analyzeSchemaPlan(plan)),
  );

export const applySchema = (
  expectedPlanDigest: string,
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  Effect.gen(function* () {
    const plan = yield* explainSchema(runner);
    if (!plan.safe) {
      return {
        applied: false as const,
        digest: plan.digest,
        reason: 'unsafe-plan' as const,
        unsafeReasons: plan.unsafeReasons,
      };
    }
    if (plan.digest !== expectedPlanDigest) {
      return {
        applied: false as const,
        digest: plan.digest,
        reason: 'plan-changed' as const,
        unsafeReasons: [],
      };
    }

    const prerequisites = yield* runner.run([
      'bun',
      databasePrerequisitesExecutable,
    ]);
    if (prerequisites.exitCode !== 0) {
      return yield* failOpsCommand(
        'Database prerequisites',
        ['bun', databasePrerequisitesExecutable],
        prerequisites,
      );
    }

    const result = yield* runner.run(applyCommand);
    const envelope = yield* decodeApplyResult(applyCommand, result);
    return {
      applied: true as const,
      digest: plan.digest,
      status: envelope.status,
      unsafeReasons: [],
    };
  });

const requireSuccessfulBoundedCommand = (
  operation: string,
  command: readonly string[],
  result: OpsCommandResult,
) =>
  result.exitCode === 0
    ? Effect.void
    : failOpsCommand(operation, command, result);

const preflightStagingSeed = Effect.fn('preflightStagingSeed')(function* (
  runner: OpsCommandRunner,
) {
  const command = ['bun', stagingSeedExecutable] as const;
  const result = yield* runner.run(command, {
    environment: { STAGING_SEED_PREFLIGHT_ONLY: 'true' },
  });
  yield* requireSuccessfulBoundedCommand(
    'Staging seed preflight',
    command,
    result,
  );
});

export const seedStaging = (
  confirmation: 'reset-and-seed-staging',
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  Effect.gen(function* () {
    yield* preflightStagingSeed(runner);
    const resetCommand = ['bun', stagingResetExecutable] as const;
    const resetResult = yield* runner.run(resetCommand, {
      environment: { STAGING_RESET_CONFIRMATION: confirmation },
    });
    yield* requireSuccessfulBoundedCommand(
      'Staging reset',
      resetCommand,
      resetResult,
    );

    const prerequisitesCommand = [
      'bun',
      databasePrerequisitesExecutable,
    ] as const;
    const prerequisitesResult = yield* runner.run(prerequisitesCommand);
    yield* requireSuccessfulBoundedCommand(
      'Database prerequisites',
      prerequisitesCommand,
      prerequisitesResult,
    );

    const applyResult = yield* runner.run(applyCommand);
    yield* decodeApplyResult(applyCommand, applyResult);

    const seedCommand = ['bun', stagingSeedExecutable] as const;
    const seedResult = yield* runner.run(seedCommand);
    yield* requireSuccessfulBoundedCommand(
      'Staging seed',
      seedCommand,
      seedResult,
    );

    return { reset: true as const, seeded: true as const };
  });

export const initializeEmptyStaging = (
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  Effect.gen(function* () {
    yield* preflightStagingSeed(runner);
    const seedCommand = ['bun', stagingSeedExecutable] as const;
    const seedResult = yield* runner.run(seedCommand, {
      environment: { STAGING_INITIALIZE_ONLY: 'true' },
    });
    yield* requireSuccessfulBoundedCommand(
      'Empty staging initialization',
      seedCommand,
      seedResult,
    );

    return { initialized: true as const };
  });
