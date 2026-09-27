import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lint = new ESLint({ fix: false });

const expectPolicyDiagnostics = async (
  name: string,
  filePath: string,
  code: string,
  expected: number,
) => {
  const results = await lint.lintText(code, { filePath });
  expect(results, name).toHaveLength(1);
  const messages = results[0].messages;
  expect(
    messages.filter((message) => message.fatal),
    name,
  ).toEqual([]);
  expect(
    messages.filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' ||
        message.ruleId === 'no-restricted-imports' ||
        message.ruleId === 'financial-ledger/no-mutation' ||
        message.ruleId === 'postgres-identifiers/explicit-name-length' ||
        message.ruleId === 'effect-boundaries/private-http-options',
    ),
    name,
  ).toHaveLength(expected);
};

const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const secret = '${{ secrets.TEST_KEY }}';
const header = 'name: Probe\non: pull_request\npermissions: {contents: read}\n';
const step = (body: string, env = '') =>
  header +
  env +
  'jobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - ' +
  body +
  '\n';
const workflowCases = [
  ['pinned action', step('uses: actions/checkout@' + sha), 0],
  ['quoted action', step('uses: "actions/checkout@' + sha + '"'), 0],
  ['tag action', step('uses: actions/checkout@v7'), 1],
  ['short action hash', step('uses: actions/checkout@aaaaaaa'), 1],
  [
    'local action',
    step(
      'uses: ./.github/actions/check\n        env:\n          TOKEN: ' + secret,
    ),
    0,
  ],
  [
    'pinned Docker action',
    step('uses: docker://example/image@sha256:' + digest),
    0,
  ],
  ['wrong Docker hash', step('uses: docker://example/image@' + sha), 1],
  [
    'workflow secret',
    step('run: echo okay', 'env:\n  TOKEN: ' + secret + '\n'),
    1,
  ],
  [
    'job secret',
    header +
      'jobs:\n  check:\n    runs-on: ubuntu-latest\n    env: {TOKEN: "' +
      secret +
      '"}\n    steps: [{run: "echo okay"}]\n',
    1,
  ],
  [
    'run-step secret',
    step('run: echo okay\n        env:\n          TOKEN: ' + secret),
    0,
  ],
  [
    'external action secret',
    step(
      'uses: actions/checkout@' +
        sha +
        '\n        env:\n          TOKEN: ' +
        secret,
    ),
    1,
  ],
  [
    'external action input secret',
    step(
      'uses: actions/checkout@' +
        sha +
        '\n        with:\n          token: ' +
        secret,
    ),
    1,
  ],
  [
    'reusable workflow forwarding',
    header +
      'jobs:\n  check:\n    uses: owner/repo/.github/workflows/check.yml@' +
      sha +
      '\n    secrets:\n      TOKEN: ' +
      secret +
      '\n',
    0,
  ],
  [
    'unpinned reusable workflow',
    header +
      'jobs:\n  check:\n    uses: owner/repo/.github/workflows/check.yml@main\n',
    1,
  ],
  [
    'flow notation',
    header +
      'jobs: {check: {runs-on: ubuntu-latest, steps: [{uses: actions/checkout@main}]}}\n',
    1,
  ],
  [
    'no permissions',
    'name: Probe\non: pull_request\njobs: {check: {runs-on: ubuntu-latest, steps: [{run: "echo okay"}]}}\n',
    1,
  ],
  [
    'job permissions',
    'name: Probe\non: pull_request\njobs: {check: {permissions: {}, runs-on: ubuntu-latest, steps: [{run: "echo okay"}]}}\n',
    0,
  ],
  [
    'only one job has permissions',
    'jobs: {a: {permissions: {}, steps: []}, b: {steps: []}}',
    1,
  ],
  [
    'nested permissions input',
    'jobs: {a: {steps: [{with: {permissions: read}}]}}',
    1,
  ],
  [
    'all jobs have permissions',
    'jobs: {a: {permissions: {}, steps: []}, b: {permissions: {}, steps: []}}',
    0,
  ],
  ['self-repository action', step('uses: $/.github/actions/build'), 0],
  [
    'self-repository action with ref',
    step('uses: $/.github/actions/build@v1'),
    1,
  ],
  [
    'self-repository action with commit ref',
    step('uses: $/.github/actions/build@' + sha),
    1,
  ],
  ['empty self-repository path', step('uses: $/'), 1],
  [
    'self-repository action secret',
    step(
      'uses: $/.github/actions/build\n        env:\n          TOKEN: ' + secret,
    ),
    0,
  ],
  [
    'self-repository reusable workflow',
    header + 'jobs:\n  check:\n    uses: $/.github/workflows/deploy.yml\n',
    0,
  ],
  ['uses alias', step('uses: &ref actions/checkout@' + sha), 1],
] as const;

describe('structural lint diagnostics', () => {
  it('checks workflow pins and secret boundaries independently of YAML formatting', async () => {
    for (const [name, code, expected] of workflowCases) {
      await expectPolicyDiagnostics(
        name,
        '.github/workflows/policy-probe.yml',
        code,
        expected,
      );
    }
  });

  it('keeps handler authorization and audit writes on their explicit boundaries', async () => {
    for (const [code, expected] of [
      ["permissions.includes('events:create')", 1],
      ["context.currentPermissions.includes('events:create')", 1],
      ["user['permissions']['includes']('events:create')", 1],
      ["user.permissions?.includes('events:create')", 1],
      ["includesPermission('events:create', permissions)", 0],
      ["user.roleIds.includes('role-1')", 0],
      ['db.update(platformAuditEntries)', 1],
      ["db['delete'](schema['platformAuditEntries'])", 1],
      ['db.insert(platformAuditEntries)', 0],
      ['db.update(tenants)', 0],
    ] as const) {
      await expectPolicyDiagnostics(
        code,
        'src/server/effect/rpc/handlers/global-admin.handlers.ts',
        code,
        expected,
      );
    }
  });

  it('keeps shared administrator metadata read-only while allowing owned-user lifecycle operations', async () => {
    for (const [code, expected] of [
      ['await auth0.users.update(id, metadata)', 1],
      ["await auth0['users']['update'](id, metadata)", 1],
      ['await client.updateAppMetadata(metadata)', 1],
      ['await updateAppMetadata(metadata)', 1],
      ['await auth0.users.get(id)', 0],
      ['await auth0.users.create(user)', 0],
      ['await auth0.users.delete(id)', 0],
    ] as const) {
      await expectPolicyDiagnostics(
        code,
        'tests/support/fixtures/base-test.ts',
        code,
        expected,
      );
    }
  });

  it('keeps shared browser and documentation capture settings safe', async () => {
    for (const filePath of [
      'playwright.config.ts',
      'tests/support/utils/authenticated-test-page.ts',
      'tests/docs/example.doc.ts',
    ]) {
      for (const [code, expected] of [
        ['const options = { ignoreHTTPSErrors: true };', 1],
        ["const options = { 'ignoreHTTPSErrors': true };", 1],
        ["const options = { ['ignoreHTTPSErrors']: true };", 1],
        ['const options = { ignoreHTTPSErrors: false };', 0],
        [
          'const insecure = true; const options = { ignoreHTTPSErrors: insecure };',
          1,
        ],
        [
          'const secure = false; const options = { ignoreHTTPSErrors: secure };',
          1,
        ],
        ['const options = { ignoreHTTPSErrors: getIgnoreSetting() };', 1],
        ['const options = {};', 0],
        ["const options = { trace: 'off' };", 0],
        ["const mode = 'on'; const options = { trace: mode };", 1],
        ['const options = { trace: makeTraceOptions() };', 1],
        ["const mode = 'on'; const options = { trace: { mode } };", 1],
        ["const options = { trace: { mode: 'off', ...extra } };", 1],
        ["const options = { trace: { mode: 'off', ['mode']: 'on' } };", 1],
        [
          "const key = 'mode'; const options = { trace: { mode: 'off', [key]: 'on' } };",
          1,
        ],
        [
          "const key = 'mode'; const options = { trace: { [key]: 'on', mode: 'off' } };",
          1,
        ],
        [
          "const options = { trace: { ['mode']: 'off', screenshots: false } };",
          0,
        ],
        ['const options = { trace: { screenshots: true } };', 1],
        ["const options = { trace: 'on' };", 1],
        ["const options = { trace: 'retain-on-first-failure' };", 1],
        [
          "const options = { trace: { mode: 'retain-on-failure-and-retries' } };",
          1,
        ],
        ["const options = { ['trace']: 'retain-on-failure' };", 1],
        ["const options = { trace: { mode: 'on-first-retry' } };", 1],
        ["const options = { trace: { mode: 'off' } };", 0],
      ] as const) {
        await expectPolicyDiagnostics(code, filePath, code, expected);
      }
    }
  });

  it('rejects ledger mutations through common aliases and SQL while allowing reads', async () => {
    for (const [code, expected] of [
      [
        "import { registrationAcquisitions } from '@db/schema'; db.update(registrationAcquisitions);",
        1,
      ],
      [
        "import { registrationAcquisitions as history } from '@db/schema'; db['delete'](history);",
        1,
      ],
      [
        "import * as tables from '@db/schema'; db.delete(tables.registrationAcquisitionPayments);",
        1,
      ],
      [
        "import { registrationAcquisitions } from '@db/schema'; const first = registrationAcquisitions; const next = first; db.update(next);",
        1,
      ],
      [
        "import { registrationAcquisitions } from '@db/schema'; let current; current = registrationAcquisitions; db.delete(current);",
        1,
      ],
      [
        "import { registrationAcquisitions } from '@db/schema'; const holder = {}; holder.current = registrationAcquisitions; db.delete(holder.current);",
        1,
      ],
      [
        "holder.current = schema.registrationAcquisitionComponents; db.update(holder['current']);",
        1,
      ],
      [
        "import { platformAuditEntries as audit } from '@db/schema'; db.delete(audit);",
        1,
      ],
      [
        'const table = schema.registrationAcquisitions; db.select().from(table);',
        0,
      ],
      [
        "import { registrationAcquisitions } from '@db/schema'; function change(registrationAcquisitions) { db.update(registrationAcquisitions); }",
        0,
      ],
      [
        'let table; table = transactions; table = registrationAcquisitions; db.update(table);',
        1,
      ],
      [
        "const method = 'delete'!; (db as typeof db)[method]((registrationAcquisitions as typeof registrationAcquisitions)!);",
        1,
      ],
      ["const method = 'update'!; (db as typeof db)[method](transactions);", 0],
      [
        'const query = (db.insert(registrationAcquisitions).values(value))!; (query as typeof query).onConflictDoUpdate(update);',
        1,
      ],
      [
        '(sql.raw as typeof sql.raw)!((`DELETE FROM registration_acquisitions` as const)!);',
        1,
      ],
      [
        '(<typeof db>db).delete(<typeof registrationAcquisitions>registrationAcquisitions);',
        1,
      ],
      ['db.update(transactions);', 0],
      ['db.insert(registrationAcquisitionPayments).values(payment);', 0],
      ["db.execute(sql`UPDATE registration_acquisitions SET id = 'x'`);", 1],
      [
        'db.execute(sql`DELETE FROM ${schema.registrationAcquisitionComponents}`);',
        1,
      ],
      [
        `db.execute(sql.raw('DELETE FROM "public"."registration_acquisition_refund_allocations"'));`,
        1,
      ],
      [
        "import { sql as query } from 'drizzle-orm'; db.execute(query`DELETE FROM ONLY registration_transfer_refund_plan_acquisition_links`);",
        1,
      ],
      ['db.execute(sql.raw(`DELETE FROM registration_acquisitions`));', 1],
      [
        'db.execute(sql.raw(`UPDATE registration_acquisition_payments SET amount = ${amount}`));',
        1,
      ],
      ['db.execute(sql.raw(`SELECT * FROM registration_acquisitions`));', 0],
      ['db.execute(sql`TRUNCATE TABLE registration_acquisitions`);', 1],
      [
        'db.execute(sql`TRUNCATE TABLE transactions, registration_acquisitions`);',
        1,
      ],
      [
        'db.execute(sql`TRUNCATE ONLY public.transactions, ONLY "public"."registration_acquisitions" CASCADE`);',
        1,
      ],
      ['db.execute(sql`TRUNCATE transactions, other_rows`);', 0],
      [
        "const table = 'registration_acquisitions'; sql.raw(`DELETE FROM ${table}`);",
        1,
      ],
      [
        "const name = 'registration_' + 'acquisitions'; const table = name; sql.raw(`UPDATE ${table} SET amount = ${amount}`);",
        1,
      ],
      ["const table = 'transactions'; sql.raw(`DELETE FROM ${table}`);", 0],
      [
        'const query = db.insert(registrationAcquisitions).values(value); query.onConflictDoUpdate(update);',
        1,
      ],
      [
        'const query = db.insert(transactions).values(value); query.onConflictDoUpdate(update);',
        0,
      ],
      [
        'db.execute(sql`WITH ids AS (SELECT 1) DELETE FROM registration_acquisitions`);',
        1,
      ],
      [
        'db.execute(sql`SELECT 1; UPDATE registration_acquisitions SET amount = 1`);',
        1,
      ],
      ["db.execute(sql`SELECT 'DELETE FROM registration_acquisitions'`);", 0],
      [
        'db.execute(sql`SELECT 1 /* DELETE FROM registration_acquisitions */`);',
        0,
      ],
      [
        'db.insert(registrationAcquisitions).values(value).onConflictDoUpdate(update);',
        1,
      ],
      ['db.insert(transactions).values(value).onConflictDoUpdate(update);', 0],
      [
        'db.insert(registrationAcquisitions).values(value).onConflictDoNothing();',
        0,
      ],
      ['db.execute(sql`SELECT * FROM registration_acquisitions`);', 0],
      ["const message = 'UPDATE registration_acquisitions';", 0],
    ] as const) {
      await expectPolicyDiagnostics(
        code,
        'src/server/registrations/ledger-operation.ts',
        code,
        expected,
      );
    }
  });

  it('enforces application import boundaries while allowing shared contracts and supported icons', async () => {
    for (const [code, expected] of [
      ["import type { AppRouter } from '@server/router';", 1],
      ["import { Database } from '@server/database';", 1],
      ["import { AppRpcs } from '@shared/rpc-contracts/app-rpcs';", 0],
      ["import { MatIcon } from '@angular/material/icon';", 1],
      ["import { MatIconModule as Icons } from '@angular/material/icon';", 1],
      ["import * as Icons from '@angular/material/icon';", 1],
      ["import { MatIconRegistry } from '@angular/material/icon';", 0],
      [
        "import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';",
        0,
      ],
    ] as const) {
      await expectPolicyDiagnostics(
        code,
        'src/app/app.component.ts',
        code,
        expected,
      );
    }
  });
});

describe('PostgreSQL identifier diagnostics', () => {
  it('measures explicit declaration names in UTF-8 bytes and respects import bindings', async () => {
    const long = JSON.stringify('x'.repeat(64));
    for (const [name, code, expected] of [
      [
        'boundary',
        `import { pgTable } from 'drizzle-orm/pg-core'; pgTable(${JSON.stringify('x'.repeat(63))}, {});`,
        0,
      ],
      [
        'table',
        `import { pgTable } from 'drizzle-orm/pg-core'; pgTable(${long}, {});`,
        1,
      ],
      [
        'table creator requires an explicit declaration',
        `import { pgTableCreator } from 'drizzle-orm/pg-core'; const table = pgTableCreator((name) => name); table(${long}, {});`,
        1,
      ],
      [
        'short transformed table still requires an explicit name',
        "import { pgTableCreator as creator } from 'drizzle-orm/pg-core'; const table = creator((name) => 'prefix_' + name); table('events', {});",
        1,
      ],
      [
        'namespace table creator',
        "import * as pg from 'drizzle-orm/pg-core'; const method = 'pgTableCreator'; pg[method]((name) => name);",
        1,
      ],
      [
        'unrelated creator',
        "const pgTableCreator = (name: string) => name; pgTableCreator('events');",
        0,
      ],
      [
        'angle-bracket name assertion',
        `import { pgTable } from 'drizzle-orm/pg-core'; pgTable(<string>${long}, {});`,
        1,
      ],
      [
        'constant-template table name',
        `import { pgTable } from 'drizzle-orm/pg-core'; const name = ${long}; pgTable(\`${'${name}'}\`, {});`,
        1,
      ],
      [
        'nested constant-template name',
        `import { pgTable } from 'drizzle-orm/pg-core'; const suffix = ${JSON.stringify('x'.repeat(60))}; const name = \`pre_${'${suffix}'}\`; pgTable(\`${'${name}'}\`, {});`,
        1,
      ],
      [
        'numeric template interpolation',
        `import { pgTable } from 'drizzle-orm/pg-core'; const suffix = 12; pgTable(\`${'x'.repeat(62)}${'${suffix}'}\`, {});`,
        1,
      ],
      [
        'short primitive template interpolations',
        "import { pgTable } from 'drizzle-orm/pg-core'; pgTable(`row_${12}_${true}_${null}`, {});",
        0,
      ],
      [
        'computed template schema method',
        `import { pgSchema } from 'drizzle-orm/pg-core'; const schema = pgSchema('app'); const suffix = 'ble'; schema[\`ta${'${suffix}'}\`](${long}, {});`,
        1,
      ],
      [
        'short template name',
        "import { pgTable } from 'drizzle-orm/pg-core'; const suffix = 'events'; pgTable(`app_${suffix}`, {});",
        0,
      ],
      [
        'alias and constant',
        `import { check as constraint } from 'drizzle-orm/pg-core'; const name = ${long}; constraint(name, true);`,
        1,
      ],
      [
        'namespace',
        `import * as pg from 'drizzle-orm/pg-core'; pg.index(${long});`,
        1,
      ],
      [
        'computed namespace factory',
        `import * as pg from 'drizzle-orm/pg-core'; const method = 'pgSequence'; pg[method](${long});`,
        1,
      ],
      [
        'computed schema method',
        `import { pgSchema } from 'drizzle-orm/pg-core'; const schema = pgSchema('app'); const method = 'table'; schema[method](${long}, {});`,
        1,
      ],
      [
        'computed schema method with short name',
        "import { pgSchema } from 'drizzle-orm/pg-core'; const schema = pgSchema('app'); const method = 'table'; schema[method]('events', {});",
        0,
      ],
      [
        'computed foreign key name',
        `import { foreignKey } from 'drizzle-orm/pg-core'; const key = 'name'; foreignKey({ [key]: ${long}, columns: [], foreignColumns: [] });`,
        1,
      ],
      [
        'unrelated computed method',
        `const schema = { table: (name: string) => name }; const method = 'table'; schema[method](${long});`,
        0,
      ],
      [
        'column unique name',
        `import { varchar } from 'drizzle-orm/pg-core'; varchar().unique(${long});`,
        1,
      ],
      [
        'column unique name through builder alias and chain',
        `import * as pg from 'drizzle-orm/pg-core'; const column = pg.text().notNull(); const method = 'unique'; column[method](${long});`,
        1,
      ],
      [
        'enum column unique name',
        `import { pgEnum } from 'drizzle-orm/pg-core'; const value = pgEnum('status', ['ready']); value().unique(${long});`,
        1,
      ],
      [
        'short and implicit column unique names',
        "import { varchar } from 'drizzle-orm/pg-core'; varchar().unique('short_name'); varchar().unique();",
        0,
      ],
      [
        'unrelated unique method',
        `const value = { unique: (name: string) => name }; value.unique(${long});`,
        0,
      ],
      [
        'wrapped schema method and name',
        `import { pgSchema } from 'drizzle-orm/pg-core'; const method = 'table'!; (pgSchema('app') as ReturnType<typeof pgSchema>)[method]((${long} as const)!, {});`,
        1,
      ],
      [
        'non-null factory',
        `import { pgTable } from 'drizzle-orm/pg-core'; pgTable!(${long}, {});`,
        1,
      ],
      ...['pgSequence', 'pgRole', 'pgPolicy'].map(
        (factory) =>
          [
            factory,
            `import { ${factory} } from 'drizzle-orm/pg-core'; ${factory}(${long});`,
            1,
          ] as const,
      ),
      ...['table', 'view', 'materializedView', 'enum', 'sequence'].map(
        (factory) =>
          [
            `schema ${factory}`,
            `import { pgSchema } from 'drizzle-orm/pg-core'; const schema = pgSchema('app'); schema.${factory}(${long}, {});`,
            1,
          ] as const,
      ),
      [
        'schema namespace and constant alias',
        `import * as pg from 'drizzle-orm/pg-core'; const schema = pg.pgSchema('app'); const alias = schema; alias['table'](${long}, {});`,
        1,
      ],
      [
        'existing schema chain',
        `import { pgSchema } from 'drizzle-orm/pg-core'; pgSchema('app').existing().table(${long}, {});`,
        1,
      ],
      [
        'table with RLS',
        `import { pgTable } from 'drizzle-orm/pg-core'; pgTable.withRLS(${long}, {});`,
        1,
      ],
      [
        'schema table with RLS',
        `import { pgSchema } from 'drizzle-orm/pg-core'; pgSchema('app').table.withRLS(${long}, {});`,
        1,
      ],
      [
        'short schema name',
        "import { pgSchema } from 'drizzle-orm/pg-core'; pgSchema('app').table('events', {});",
        0,
      ],
      [
        'unrelated table method',
        `const schema = { table: (name: string) => name }; schema.table(${long});`,
        0,
      ],
      [
        'shadowed schema',
        `import { pgSchema } from 'drizzle-orm/pg-core'; const schema = pgSchema('app'); function run(schema: {table: (name: string) => void}) { schema.table(${long}); }`,
        0,
      ],
      [
        'foreign key',
        `import { foreignKey } from 'drizzle-orm/pg-core'; foreignKey({ name: ${long}, columns: [], foreignColumns: [] });`,
        1,
      ],
      [
        'UTF-8 boundary',
        `import { pgEnum } from 'drizzle-orm/pg-core'; pgEnum(${JSON.stringify('€'.repeat(21))}, ['a']);`,
        0,
      ],
      [
        'UTF-8 overflow',
        `import { pgEnum } from 'drizzle-orm/pg-core'; pgEnum(${JSON.stringify('€'.repeat(22))}, ['a']);`,
        1,
      ],
      [
        'constant composition',
        `import { unique } from 'drizzle-orm/pg-core'; const name = ${JSON.stringify('x'.repeat(32))} + ${JSON.stringify('y'.repeat(32))}; unique(name);`,
        1,
      ],
      [
        'unrelated function',
        `const index = (name: string) => name; index(${long});`,
        0,
      ],
      [
        'shadowed import',
        `import { check } from 'drizzle-orm/pg-core'; function run(check: (name: string) => void) { check(${long}); }`,
        0,
      ],
    ] as const)
      await expectPolicyDiagnostics(
        name,
        'src/db/schema/identifier-probe.ts',
        code,
        expected,
      );
  });
});

describe('Effect HTTP boundary diagnostics', () => {
  it('requires explicit private logging options while respecting bindings and spread order', async () => {
    const router =
      "import { HttpRouter as Router } from 'effect/unstable/http';";
    for (const [name, code, expected] of [
      [
        'inline options',
        `${router} Router.serve(app, { disableLogger: true });`,
        0,
      ],
      ['missing options', `${router} Router.toWebHandler(app);`, 1],
      ['template boundary method', router + ' Router[`serve`](app, {});', 1],
      [
        'template method alias',
        router + ' const method = `serve`; Router[method](app, {});',
        1,
      ],
      [
        'constant template interpolation',
        router + ' const suffix = "ve"; Router[`ser${suffix}`](app, {});',
        1,
      ],
      [
        'constant concatenated method',
        router + ' Router["ser" + "ve"](app, {});',
        1,
      ],
      [
        'private template method and option',
        router +
          ' Router[`to${"Web"}Handler`](app, { [`disable${"Logger"}`]: true });',
        0,
      ],
      ['unrelated template member', router + ' Router[`add`](app, {});', 0],
      [
        'angle-bracket router assertion',
        `${router} (<typeof Router>Router).serve(app, {});`,
        1,
      ],
      [
        'non-null computed method',
        `${router} const method = 'serve'!; Router[method](app, {});`,
        1,
      ],
      [
        'cast router alias',
        `${router} const alias = Router as typeof Router; alias.serve(app, {});`,
        1,
      ],
      [
        'satisfies router alias',
        `${router} const alias = Router satisfies typeof Router; alias.toWebHandler(app, {});`,
        1,
      ],
      [
        'non-null boundary function',
        `${router} const serve = Router.serve!; serve(app, {});`,
        1,
      ],
      [
        'wrapped private options',
        `${router} (Router as typeof Router).serve(app, ({ disableLogger: true! } as const)!);`,
        0,
      ],
      [
        'unrelated wrapped method',
        `const other = { serve: (app: object) => app }; (other as typeof other).serve({});`,
        0,
      ],
      [
        'computed boundary method',
        `${router} const method = 'serve'; Router[method](app, {});`,
        1,
      ],
      [
        'computed method alias',
        `${router} const method = 'toWebHandler'; const alias = method; Router[alias](app, { disableLogger: true });`,
        0,
      ],
      [
        'computed option name',
        `${router} const key = 'disableLogger'; Router.serve(app, { [key]: true });`,
        0,
      ],
      [
        'computed unsafe option',
        `${router} const key = 'disableLogger'; Router.serve(app, { [key]: false });`,
        1,
      ],
      [
        'computed non-boundary method',
        `${router} const method = 'get'; Router[method]('/', handler);`,
        0,
      ],
      [
        'enabled logger',
        `${router} Router.serve(app, { disableLogger: false });`,
        1,
      ],
      [
        'named readonly options',
        `${router} const opts = { disableLogger: true } as const; Router.serve(app, opts);`,
        0,
      ],
      [
        'boolean alias',
        `${router} const disabled = true; const opts = { disableLogger: disabled }; Router.serve(app, opts);`,
        0,
      ],
      [
        'safe last override',
        `${router} Router.serve(app, { ...external, disableLogger: true });`,
        0,
      ],
      [
        'unknown last spread',
        `${router} Router.serve(app, { disableLogger: true, ...external });`,
        1,
      ],
      [
        'known last spread',
        `${router} const other = { middleware: handler }; Router.serve(app, { disableLogger: true, ...other });`,
        0,
      ],
      [
        'false last override',
        `${router} const opts = { disableLogger: true }; Router.serve(app, { ...opts, disableLogger: false });`,
        1,
      ],
      [
        'method alias',
        `${router} const serve = Router.serve; serve(app, {});`,
        1,
      ],
      [
        'destructured boundary',
        `${router} const { serve } = Router; serve(app, {});`,
        1,
      ],
      [
        'renamed destructured boundary',
        `${router} const { toWebHandler: handle } = Router; handle(app, {});`,
        1,
      ],
      [
        'destructured namespace',
        "import * as Http from 'effect/unstable/http'; const { HttpRouter: router } = Http; router.serve(app, {});",
        1,
      ],
      [
        'nested destructured namespace',
        "import * as Http from 'effect/unstable/http'; const { HttpRouter: { serve: listen } } = Http; listen(app, {});",
        1,
      ],
      [
        'computed destructured boundary',
        `${router} const key = 'serve'; const { [key]: listen } = Router; listen(app, {});`,
        1,
      ],
      [
        'defaulted destructured boundary',
        `${router} const { serve = fallback } = Router; serve(app, {});`,
        1,
      ],
      [
        'rest namespace boundary',
        `${router} const { get, ...remaining } = Router; remaining.serve(app, {});`,
        1,
      ],
      [
        'private destructured boundary',
        `${router} const { serve } = Router; serve(app, { disableLogger: true });`,
        0,
      ],
      [
        'destructured route constructor',
        `${router} const { get } = Router; get('/', handler);`,
        0,
      ],
      [
        'unrelated destructured method',
        'const other = { serve: (app: object) => app }; const { serve } = other; serve(app, {});',
        0,
      ],
      [
        'direct import',
        "import { serve as listen } from 'effect/unstable/http/HttpRouter'; listen(app, {});",
        1,
      ],
      [
        'namespace import',
        "import * as Router from 'effect/unstable/http/HttpRouter'; Router.toWebHandler(app, {});",
        1,
      ],
      [
        'barrel namespace',
        "import * as Http from 'effect/unstable/http'; Http.HttpRouter.serve(app, {});",
        1,
      ],
      [
        'shadowed import',
        `${router} function start(Router: { serve: (app: object) => void }) { Router.serve({}); }`,
        0,
      ],
      [
        'unrelated serve',
        'declare const other: { serve: (app: object) => void }; other.serve({});',
        0,
      ],
    ] as const)
      await expectPolicyDiagnostics(name, 'src/server.ts', code, expected);
  });
});
