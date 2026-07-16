import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const productionTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(entryPath);
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts')
      ? [entryPath]
      : [];
  });

describe('paid configuration Stripe serialization source guards', () => {
  it('runs the standard event graph inside one database transaction', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-lifecycle.handlers.ts',
    );
    const handlerStart = source.indexOf("'events.create':");
    const handlerEnd = source.indexOf("'events.update':", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('.transaction((transaction) =>');
    expect(handler).toContain(
      'Effect.provideService(Database, transactionalDatabase)',
    );
    expect(handler.indexOf('.transaction')).toBeLessThan(
      handler.indexOf('createEventGraph(input)'),
    );
  });

  it('locks Stripe availability before every event-graph write', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-lifecycle.handlers.ts',
    );
    const graphStart = source.indexOf('export const createEventGraph =');
    const graphEnd = source.indexOf(
      'const isExpectedEventCreateError',
      graphStart,
    );
    const graph = source.slice(graphStart, graphEnd);
    const accountLock = graph.indexOf('lockTenantStripeAccount(');
    const eventInsert = graph.indexOf('.insert(eventInstances)');

    expect(accountLock).toBeGreaterThanOrEqual(0);
    expect(eventInsert).toBeGreaterThan(accountLock);
    for (const table of [
      'eventRegistrationOptions',
      'eventRegistrationOptionDiscounts',
      'eventAddons',
      'addonToEventRegistrationOptions',
      'eventRegistrationQuestions',
    ]) {
      const write = graph.indexOf(`.insert(${table})`);
      if (write !== -1) expect(write).toBeGreaterThan(accountLock);
    }
  });

  it('keeps platform event creation on its outer transaction', () => {
    const source = readSource(
      '../effect/rpc/handlers/platform/platform-events.handlers.ts',
    );
    const handlerStart = source.indexOf("'platform.events.create':");
    const handlerEnd = source.indexOf(
      "'platform.events.getDetail':",
      handlerStart,
    );
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain('database.transaction((transaction) =>');
    expect(handler).toContain('lockTenantStripeAccount(');
    expect(handler).toContain('createEventGraph({');
    expect(handler).toContain(
      'Effect.provideService(Database, transactionalDatabase)',
    );
  });

  it('allows only the two transaction-providing production call sites', () => {
    const serverRoot = fileURLToPath(new URL('../', import.meta.url));
    const callSites = productionTypeScriptFiles(serverRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('createEventGraph(') ? [path] : [];
    });

    expect(
      callSites
        .map((filePath) => path.relative(serverRoot, filePath))
        .toSorted(),
    ).toEqual([
      'effect/rpc/handlers/events/events-lifecycle.handlers.ts',
      'effect/rpc/handlers/platform/platform-events.handlers.ts',
    ]);
    for (const path of callSites) {
      const source = readFileSync(path, 'utf8');
      const call = source.indexOf('createEventGraph(');
      const transaction = source.lastIndexOf('.transaction(', call);
      const nextHandler = source.indexOf("':", call + 1);
      const handlerEnd = nextHandler === -1 ? source.length : nextHandler;
      expect(transaction).toBeGreaterThanOrEqual(0);
      expect(source.slice(call, handlerEnd)).toContain(
        'Effect.provideService(Database, transactionalDatabase)',
      );
    }
  });

  it('locks the tenant before every standard and platform template write', () => {
    const paidConfiguration = readSource('./paid-event-configuration.ts');
    const ensureStart = paidConfiguration.indexOf(
      'export const ensureStripeForPaidEventConfiguration',
    );
    const ensureEnd = paidConfiguration.indexOf(
      'const eventHasPaidConfiguration',
      ensureStart,
    );
    expect(paidConfiguration.slice(ensureStart, ensureEnd)).toContain(
      'lockTenantStripeAccount(',
    );

    const standard = readSource('../effect/rpc/handlers/templates.handlers.ts');
    const platform = readSource(
      '../effect/rpc/handlers/platform/platform-templates.handlers.ts',
    );
    for (const [source, startMarker, endMarker, writeMarker] of [
      [
        standard,
        "'templates.create':",
        "'templates.createSimpleTemplate':",
        'TemplateGraphService.createTemplate(',
      ],
      [
        standard,
        "'templates.createSimpleTemplate':",
        "'templates.findOne':",
        'SimpleTemplateService.createSimpleTemplate(',
      ],
      [
        standard,
        "'templates.update':",
        "'templates.updateSimpleTemplate':",
        'TemplateGraphService.updateTemplate(',
      ],
      [
        standard,
        "'templates.updateSimpleTemplate':",
        'satisfies Partial<AppRpcHandlers>',
        'SimpleTemplateService.updateSimpleTemplate(',
      ],
      [
        platform,
        "'platform.templates.create':",
        "'platform.templates.findOne':",
        'TemplateGraphService.createTemplate(',
      ],
      [
        platform,
        "'platform.templates.update':",
        '\n};',
        'TemplateGraphService.updateTemplate(',
      ],
    ] as const) {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start);
      const handler = source.slice(start, end);
      const transaction = handler.indexOf('.transaction((transaction)');
      const accountLock = handler.indexOf(
        'ensureStripeForPaidEventConfiguration(',
      );
      const write = handler.indexOf(writeMarker);

      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(transaction).toBeGreaterThanOrEqual(0);
      expect(accountLock).toBeGreaterThan(transaction);
      expect(write).toBeGreaterThan(accountLock);
    }
  });
});
