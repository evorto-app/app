import { Effect, Schema } from 'effect';
import { createHash } from 'node:crypto';

const maximumCommandOutputBytes = 4 * 1024 * 1024;
const commandTimeoutMs = 2 * 60 * 1000;
const drizzleExecutable = 'ops/drizzle-kit.cjs';
const drizzleConfig = 'ops/drizzle.config.mjs';
const databasePrerequisitesExecutable =
  'dist/evorto/ops/database-prerequisites.mjs';
const stagingResetExecutable = 'dist/evorto/ops/reset-staging-database.mjs';
const stagingSeedExecutable = 'dist/evorto/ops/seed-staging.mjs';

export const opsCommandFailureKinds = [
  'command-failed',
  'database-authentication-failed',
  'database-configuration-invalid',
  'database-host-resolution-failed',
  'database-not-found',
  'database-permission-denied',
  'database-tls-ca-untrusted',
  'database-tls-certificate-expired',
  'database-tls-certificate-not-yet-valid',
  'database-tls-hostname-mismatch',
  'database-tls-verification-failed',
  'database-unreachable',
  'drizzle-cli-incompatible',
  'runtime-artifact-missing',
] as const;

export type OpsCommandFailureKind = (typeof opsCommandFailureKinds)[number];

export const opsCommandDiagnostics = [
  ...opsCommandFailureKinds,
  'bounded-command-failed',
  'drizzle-application-unconfirmed',
  'drizzle-invalid-json',
  'staging-schema-unconfirmed',
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

export class OpsCommandError extends Schema.TaggedErrorClass<OpsCommandError>()(
  'OpsCommandError',
  {
    diagnostic: Schema.Literals(opsCommandDiagnostics),
    message: Schema.String,
  },
) {}

const commandFailurePatterns: readonly {
  readonly kind: OpsCommandFailureKind;
  readonly patterns: readonly RegExp[];
}[] = [
  {
    kind: 'database-authentication-failed',
    patterns: [
      /password authentication failed/iu,
      /role .* does not exist/iu,
      /sasl.*authentication/iu,
      /scram.*authentication/iu,
    ],
  },
  {
    kind: 'database-host-resolution-failed',
    patterns: [/eai_again/iu, /enotfound/iu, /getaddrinfo/iu],
  },
  {
    kind: 'database-unreachable',
    patterns: [
      /connection terminated unexpectedly/iu,
      /econnrefused/iu,
      /ehostunreach/iu,
      /enetunreach/iu,
      /etimedout/iu,
      /timeout expired/iu,
    ],
  },
  {
    kind: 'database-permission-denied',
    patterns: [/no pg_hba\.conf entry/iu, /permission denied/iu],
  },
  {
    kind: 'database-not-found',
    patterns: [/database .* does not exist/iu],
  },
  {
    kind: 'database-tls-hostname-mismatch',
    patterns: [
      /err_tls_cert_altname_invalid/iu,
      /hostname\/ip does not match/iu,
    ],
  },
  {
    kind: 'database-tls-certificate-expired',
    patterns: [/cert_has_expired/iu, /certificate has expired/iu],
  },
  {
    kind: 'database-tls-certificate-not-yet-valid',
    patterns: [/cert_not_yet_valid/iu, /certificate is not yet valid/iu],
  },
  {
    kind: 'database-tls-ca-untrusted',
    patterns: [
      /depth_zero_self_signed_cert/iu,
      /self_signed_cert_in_chain/iu,
      /self[- ]signed/iu,
      /unable_to_get_issuer_cert/iu,
      /unable_to_verify_leaf_signature/iu,
      /unable to get local issuer/iu,
      /unable to verify/iu,
    ],
  },
  {
    kind: 'database-tls-verification-failed',
    patterns: [
      /certificate/iu,
      /err_tls/iu,
      /ssl (?:connection|error|handshake|routines)/iu,
      /tls (?:connection|error|handshake)/iu,
    ],
  },
  {
    kind: 'database-configuration-invalid',
    patterns: [/database_tls_[a-z_]+ .* required/iu, /database_url must/iu],
  },
  {
    kind: 'runtime-artifact-missing',
    patterns: [
      /cannot find module/iu,
      /enoent/iu,
      /module not found/iu,
      /no such file or directory/iu,
    ],
  },
  {
    kind: 'drizzle-cli-incompatible',
    patterns: [/unknown option/iu, /unrecognized option/iu],
  },
];

export const classifyOpsCommandFailure = (
  result: Pick<OpsCommandResult, 'stderr' | 'stdout'>,
): OpsCommandFailureKind => {
  const output = `${result.stderr}\n${result.stdout}`;
  return (
    commandFailurePatterns.find(({ patterns }) =>
      patterns.some((pattern) => pattern.test(output)),
    )?.kind ?? 'command-failed'
  );
};

const outputByteLength = (output: string) =>
  new TextEncoder().encode(output).byteLength;

const failOpsCommand = Effect.fn('failOpsCommand')(function* (
  operation: string,
  result: OpsCommandResult,
) {
  const failureKind = classifyOpsCommandFailure(result);
  yield* Effect.logError('Ops command failed').pipe(
    Effect.annotateLogs({
      exitCode: result.exitCode,
      failureKind,
      operation,
      stderrBytes: outputByteLength(result.stderr),
      stdoutBytes: outputByteLength(result.stdout),
    }),
  );
  return yield* new OpsCommandError({
    diagnostic: failureKind,
    message: `${operation} failed (${failureKind}; exit ${result.exitCode})`,
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
      catch: () =>
        new OpsCommandError({
          diagnostic: 'bounded-command-failed',
          message: 'The bounded ops command failed',
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
    }),
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(record)
      .toSorted()
      .map((key) => [key, canonicalize(record[key])]),
  );
};

const planDigest = (plan: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(plan)))
    .digest('hex');

const tableIdentity = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return `public.${value}`;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const name =
    typeof record['table'] === 'string'
      ? record['table']
      : typeof record['tableName'] === 'string'
        ? record['tableName']
        : typeof record['name'] === 'string'
          ? record['name']
          : undefined;
  if (!name) {
    return;
  }
  const schema =
    typeof record['schema'] === 'string' ? record['schema'] : 'public';
  return `${schema}.${name}`;
};

const statementTableIdentity = (
  statement: Record<string, unknown>,
): string | undefined => {
  for (const key of [
    'table',
    'column',
    'index',
    'fk',
    'unique',
    'check',
    'pk',
  ]) {
    const identity = tableIdentity(statement[key]);
    if (identity) {
      return identity;
    }
  }
  return;
};

const safeCreateStatementTypes = new Set([
  'create_enum',
  'create_schema',
  'create_sequence',
  'create_table',
  'create_view',
]);

const isSafeAddedColumn = (statement: Record<string, unknown>): boolean => {
  const column = asRecord(statement['column']);
  if (!column || column['notNull'] !== true) {
    return true;
  }
  return (
    (Object.hasOwn(column, 'default') && column['default'] !== null) ||
    column['generated'] !== undefined ||
    column['identity'] !== undefined
  );
};

const isSafeEnumExpansion = (statement: Record<string, unknown>): boolean => {
  const differences = statement['diff'];
  return (
    Array.isArray(differences) &&
    differences.every(
      (difference) => asRecord(difference)?.['type'] === 'added',
    )
  );
};

const isSafeIndexCreation = (
  statement: Record<string, unknown>,
  createdTables: ReadonlySet<string>,
): boolean => {
  const index = asRecord(statement['index']);
  const table = statementTableIdentity(statement);
  if (table && createdTables.has(table)) {
    return true;
  }
  return index?.['isUnique'] !== true && index?.['concurrently'] === true;
};

const isConstraintOnCreatedTable = (
  statement: Record<string, unknown>,
  createdTables: ReadonlySet<string>,
): boolean => {
  const table = statementTableIdentity(statement);
  return table !== undefined && createdTables.has(table);
};

const isSafeStatement = (
  statement: Record<string, unknown>,
  createdTables: ReadonlySet<string>,
): boolean => {
  const type = statement['type'];
  if (typeof type !== 'string') {
    return false;
  }
  if (safeCreateStatementTypes.has(type)) {
    return true;
  }
  switch (type) {
    case 'add_check':
    case 'add_pk':
    case 'add_unique':
    case 'create_fk': {
      return isConstraintOnCreatedTable(statement, createdTables);
    }
    case 'add_column': {
      return isSafeAddedColumn(statement);
    }
    case 'alter_enum': {
      return isSafeEnumExpansion(statement);
    }
    case 'create_index': {
      return isSafeIndexCreation(statement, createdTables);
    }
    default: {
      return false;
    }
  }
};

export interface SchemaPlanAnalysis {
  readonly digest: string;
  readonly rawPlan: unknown;
  readonly safe: boolean;
  readonly statementTypes: readonly string[];
  readonly unsafeReasons: readonly string[];
}

export const analyzeSchemaPlan = (rawPlan: unknown): SchemaPlanAnalysis => {
  const plan = asRecord(rawPlan);
  const status = plan?.['status'];
  if (status === 'no_changes') {
    return {
      digest: planDigest(rawPlan),
      rawPlan,
      safe: true,
      statementTypes: [],
      unsafeReasons: [],
    };
  }

  const statements = Array.isArray(plan?.['statements'])
    ? plan['statements']
    : [];
  const statementRecords = statements.map((statement) => asRecord(statement));
  const createdTables = new Set(
    statementRecords.flatMap((statement) => {
      if (statement?.['type'] !== 'create_table') {
        return [];
      }
      const identity = statementTableIdentity(statement);
      return identity ? [identity] : [];
    }),
  );
  const statementTypes = statementRecords.map((statement) =>
    typeof statement?.['type'] === 'string'
      ? statement['type']
      : 'invalid_statement',
  );
  const unsafeReasons: string[] = [];

  if (status !== 'ok') {
    unsafeReasons.push('Drizzle did not return an applicable plan');
  }
  if (!Array.isArray(plan?.['statements'])) {
    unsafeReasons.push('Drizzle plan omitted its statements');
  }
  if (Array.isArray(plan?.['hints']) && plan['hints'].length > 0) {
    unsafeReasons.push('Drizzle reported data-loss or confirmation hints');
  }
  for (const [index, statement] of statementRecords.entries()) {
    if (!statement || !isSafeStatement(statement, createdTables)) {
      unsafeReasons.push(
        `Statement ${index + 1} (${statementTypes[index] ?? 'unknown'}) is not an approved expand operation`,
      );
    }
  }

  return {
    digest: planDigest(rawPlan),
    rawPlan,
    safe: unsafeReasons.length === 0,
    statementTypes,
    unsafeReasons,
  };
};

const parseCommandJson = (result: OpsCommandResult) =>
  Effect.gen(function* () {
    if (result.exitCode !== 0) {
      return yield* failOpsCommand('Drizzle', result);
    }
    return yield* Effect.try({
      catch: () =>
        new OpsCommandError({
          diagnostic: 'drizzle-invalid-json',
          message: 'Drizzle returned an invalid JSON envelope',
        }),
      try: () => JSON.parse(result.stdout),
    });
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

const hasCommandOutput = (result: OpsCommandResult): boolean =>
  result.stderr.length > 0 || result.stdout.length > 0;

const asSafeTextDiagnosticCommand = (
  command: readonly string[],
): readonly string[] => {
  const diagnosticCommand = command.filter(
    (argument) => argument !== '--force',
  );
  const outputIndex = diagnosticCommand.indexOf('--output');
  if (outputIndex !== -1 && diagnosticCommand[outputIndex + 1] === 'json') {
    diagnosticCommand[outputIndex + 1] = 'text';
  }
  if (!diagnosticCommand.includes('--explain')) {
    diagnosticCommand.push('--explain');
  }
  return diagnosticCommand;
};

const runDrizzleCommand = Effect.fn('runDrizzleCommand')(function* (
  runner: OpsCommandRunner,
  command: readonly string[],
) {
  const result = yield* runner.run(command);
  if (result.exitCode === 0 || hasCommandOutput(result)) {
    return result;
  }

  const diagnosticResult = yield* runner.run(
    asSafeTextDiagnosticCommand(command),
  );
  return {
    exitCode: result.exitCode,
    stderr: diagnosticResult.stderr,
    stdout: diagnosticResult.stdout,
  };
});

export const explainSchema = (
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  runDrizzleCommand(runner, explainCommand).pipe(
    Effect.flatMap((result) => parseCommandJson(result)),
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
      return yield* failOpsCommand('Database prerequisites', prerequisites);
    }

    const result = yield* runDrizzleCommand(runner, applyCommand);
    const envelope = yield* parseCommandJson(result);
    const status = asRecord(envelope)?.['status'];
    if (status !== 'ok' && status !== 'no_changes') {
      return yield* new OpsCommandError({
        diagnostic: 'drizzle-application-unconfirmed',
        message: 'Drizzle did not confirm schema application',
      });
    }
    return {
      applied: true as const,
      digest: plan.digest,
      status,
      unsafeReasons: [],
    };
  });

const requireSuccessfulBoundedCommand = (
  operation: string,
  result: OpsCommandResult,
) => (result.exitCode === 0 ? Effect.void : failOpsCommand(operation, result));

export const seedStaging = (
  confirmation: 'reset-and-seed-staging',
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  Effect.gen(function* () {
    const resetResult = yield* runner.run(['bun', stagingResetExecutable], {
      environment: { STAGING_RESET_CONFIRMATION: confirmation },
    });
    yield* requireSuccessfulBoundedCommand('Staging reset', resetResult);

    const prerequisitesResult = yield* runner.run([
      'bun',
      databasePrerequisitesExecutable,
    ]);
    yield* requireSuccessfulBoundedCommand(
      'Database prerequisites',
      prerequisitesResult,
    );

    const applyResult = yield* runDrizzleCommand(runner, applyCommand);
    const applyEnvelope = yield* parseCommandJson(applyResult);
    const applyStatus = asRecord(applyEnvelope)?.['status'];
    if (applyStatus !== 'ok' && applyStatus !== 'no_changes') {
      return yield* new OpsCommandError({
        diagnostic: 'staging-schema-unconfirmed',
        message: 'Drizzle did not confirm the staging reset schema',
      });
    }

    const seedResult = yield* runner.run(['bun', stagingSeedExecutable]);
    yield* requireSuccessfulBoundedCommand('Staging seed', seedResult);

    return { reset: true as const, seeded: true as const };
  });

export const initializeEmptyStaging = (
  runner: OpsCommandRunner = liveOpsCommandRunner,
) =>
  Effect.gen(function* () {
    const seedResult = yield* runner.run(['bun', stagingSeedExecutable], {
      environment: { STAGING_INITIALIZE_ONLY: 'true' },
    });
    yield* requireSuccessfulBoundedCommand(
      'Empty staging initialization',
      seedResult,
    );

    return { initialized: true as const };
  });
