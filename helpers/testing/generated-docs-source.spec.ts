import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { PERMISSION_GROUPS } from '../../src/shared/permissions/permissions';
import { documentationConsumerGuideCatalog } from './documentation-publication-contract';
import { generatedGuideImplementationTerms } from './generated-docs-language';

// Source guard: generated documentation is product-facing, so these checks keep
// the docs tied to implemented flows instead of stale aspirational copy.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const documentationSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return documentationSources(entryPath);
    return entry.isFile() && entry.name.endsWith('.doc.ts') ? [entryPath] : [];
  });

const attachedMarkdownBodies = (source: string): string[] =>
  [...source.matchAll(/body:\s*`(?<body>(?:\\[\s\S]|[^`])*)`/gu)].map(
    (match) => match.groups?.['body'] ?? '',
  );

const generatedFixtureResidueTerms =
  /Choose the advanced organizer category that matches your tenant role\.?|Organizer\/helper registration|Organizer\/helper signup journey|Advanced organizer application journey|A free extra for the sign-up flow\.?/giu;

const temporaryOrganizationIdentityTerms = /\bE2E\b|\blocalhost\b/giu;

interface AuthoredDocumentationCopy {
  kind: 'caption' | 'section title' | 'guide title';
  line: number;
  text: string;
}

const parseDocumentationSource = (sourcePath: string, source: string) =>
  ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

const staticAuthoredText = (initializer: ts.Expression): string | undefined => {
  if (ts.isStringLiteralLike(initializer)) return initializer.text;
  if (ts.isTemplateExpression(initializer)) {
    return [
      initializer.head.text,
      ...initializer.templateSpans.map(({ literal }) => literal.text),
    ].join(' ');
  }
  return;
};

const authoredLiteralText = (
  sourcePath: string,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = parseDocumentationSource(sourcePath, source);
  const copy: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const text = ts.isExpression(node) ? staticAuthoredText(node) : undefined;
    if (text !== undefined) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      copy.push({ line: line + 1, text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const authoredPropertyText = (
  sourcePath: string,
  propertyNames: ReadonlySet<string>,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = parseDocumentationSource(sourcePath, source);
  const copy: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const propertyName = ts.isIdentifier(node.name)
        ? node.name.text
        : ts.isStringLiteralLike(node.name)
          ? node.name.text
          : undefined;
      const text = staticAuthoredText(node.initializer);
      if (
        propertyName &&
        propertyNames.has(propertyName) &&
        text !== undefined
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.initializer.getStart(sourceFile),
        );
        copy.push({ line: line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const authoredDocumentationCopy = (
  sourcePath: string,
  source: string,
): AuthoredDocumentationCopy[] => {
  const sourceFile = parseDocumentationSource(sourcePath, source);
  const copy: AuthoredDocumentationCopy[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const { expression } = node;
      const firstArgument = node.arguments[0];
      const isGuideTitle =
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'describe' &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'test';
      const isSectionTitle =
        ts.isIdentifier(expression) && expression.text === 'test';
      const isScreenshot =
        ts.isIdentifier(expression) && expression.text === 'takeScreenshot';
      const visibleArgument = isScreenshot ? node.arguments[3] : firstArgument;
      const kind = isScreenshot
        ? 'caption'
        : isGuideTitle
          ? 'guide title'
          : isSectionTitle
            ? 'section title'
            : undefined;

      if (kind && visibleArgument && ts.isStringLiteralLike(visibleArgument)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          visibleArgument.getStart(sourceFile),
        );
        copy.push({ kind, line: line + 1, text: visibleArgument.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const screenshotCaptionViolations = (
  sourcePath: string,
  source: string,
): string[] => {
  const sourceFile = parseDocumentationSource(sourcePath, source);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      const caption = node.arguments[3];
      if (
        !caption ||
        !ts.isStringLiteralLike(caption) ||
        !caption.text.trim()
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        violations.push(
          `${path.relative(repositoryRoot, sourcePath)}:${line + 1}: screenshot needs a non-empty literal caption`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
};

describe('generated docs source current behavior', () => {
  it('keeps implementation language out of generated guide copy', () => {
    const docsRoot = path.join(repositoryRoot, 'tests/docs');
    const violations = documentationSources(docsRoot).flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');
      const bodyViolations = attachedMarkdownBodies(source).flatMap((body) => {
        const prose = body
          .replaceAll(/\$\{[\s\S]*?\}/gu, '')
          .replaceAll(/\]\([^)]+\)/gu, ']');
        return [...prose.matchAll(generatedGuideImplementationTerms)].map(
          (match) =>
            `${path.relative(repositoryRoot, sourcePath)}: guide prose: ${match[0]}`,
        );
      });
      const titleAndCaptionViolations = authoredDocumentationCopy(
        sourcePath,
        source,
      ).flatMap((entry) =>
        [...entry.text.matchAll(generatedGuideImplementationTerms)].map(
          (match) =>
            `${path.relative(repositoryRoot, sourcePath)}:${entry.line}: ${entry.kind}: ${match[0]}`,
        ),
      );
      return [...bodyViolations, ...titleAndCaptionViolations];
    });

    expect(violations).toEqual([]);
  });

  it('requires a plain-language caption for every generated screenshot', () => {
    const docsRoot = path.join(repositoryRoot, 'tests/docs');
    const violations = documentationSources(docsRoot).flatMap((sourcePath) =>
      screenshotCaptionViolations(sourcePath, readFileSync(sourcePath, 'utf8')),
    );

    expect(violations).toEqual([]);
  });

  it('keeps seeded event and template copy in product language', () => {
    const templateSeedRoot = path.join(repositoryRoot, 'helpers/templates');
    const seedCopySources = [
      ...readdirSync(templateSeedRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => path.join(templateSeedRoot, entry.name)),
      path.join(repositoryRoot, 'helpers/add-events.ts'),
      path.join(
        repositoryRoot,
        'tests/docs/events/registration-cancellation.doc.ts',
      ),
      path.join(repositoryRoot, 'tests/support/utils/email-outbox-scenario.ts'),
      path.join(
        repositoryRoot,
        'tests/support/utils/organizer-signup-scenario.ts',
      ),
      path.join(
        repositoryRoot,
        'tests/support/utils/paid-registration-transfer-scenario.ts',
      ),
      path.join(
        repositoryRoot,
        'tests/support/utils/post-registration-addon-purchase-scenario.ts',
      ),
      path.join(repositoryRoot, 'tests/support/utils/profile-event-cards.ts'),
      path.join(
        repositoryRoot,
        'tests/support/utils/seed-registration-addons.ts',
      ),
      path.join(
        repositoryRoot,
        'tests/support/utils/user-role-assignment-scenario.ts',
      ),
    ];
    const publicPropertyNames = new Set([
      'description',
      'html',
      'name',
      'planningTips',
      'registeredDescription',
      'subject',
      'text',
      'title',
    ]);
    const violations = seedCopySources.flatMap((sourcePath) =>
      authoredPropertyText(sourcePath, publicPropertyNames).flatMap(
        ({ line, text }) =>
          [
            ...text.matchAll(generatedGuideImplementationTerms),
            ...text.matchAll(generatedFixtureResidueTerms),
          ].map(
            (match) =>
              `${path.relative(repositoryRoot, sourcePath)}:${line}: ${match[0]}`,
          ),
      ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps visible organization fixture identities publication-ready', () => {
    const identitySourcePath = path.join(
      repositoryRoot,
      'tests/support/fixtures/tenant-identity.ts',
    );
    const databaseSetupPath = path.join(
      repositoryRoot,
      'tests/setup/database.setup.ts',
    );
    const parallelFixturePath = path.join(
      repositoryRoot,
      'tests/support/fixtures/parallel-test.ts',
    );
    const visibleIdentityProperties = new Set(['domain', 'name']);
    const identityCopy = [
      ...authoredLiteralText(identitySourcePath).map((entry) => ({
        ...entry,
        sourcePath: identitySourcePath,
      })),
      ...authoredPropertyText(databaseSetupPath, new Set(['name'])).map(
        (entry) => ({ ...entry, sourcePath: databaseSetupPath }),
      ),
      ...authoredPropertyText(
        parallelFixturePath,
        visibleIdentityProperties,
      ).map((entry) => ({ ...entry, sourcePath: parallelFixturePath })),
    ];
    const violations = identityCopy.flatMap(({ line, sourcePath, text }) =>
      [...text.matchAll(temporaryOrganizationIdentityTerms)].map(
        (match) =>
          `${path.relative(repositoryRoot, sourcePath)}:${line}: ${match[0]}`,
      ),
    );
    const databaseSetup = readSource('tests/setup/database.setup.ts');
    const parallelFixture = readSource(
      'tests/support/fixtures/parallel-test.ts',
    );
    const discountGuide = readSource('tests/docs/profile/discounts.doc.ts');

    expect(violations).toEqual([]);
    expect(discountGuide).not.toContain('TEST-ESN');
    expect(parallelFixture).not.toContain('TEST-ESN');
    expect(databaseSetup).toContain("domain: 'localhost'");
    expect(databaseSetup).toContain('name: fixtureOrganizationName');
    expect(parallelFixture).toContain(
      'domain: parallelOrganizationDomain(runId)',
    );
    expect(parallelFixture).toContain('name: fixtureOrganizationName');
  });

  it('keeps internal and local addresses out of generated screenshots', () => {
    const appearanceSource = readSource(
      'tests/docs/admin/general-settings.doc.ts',
    );
    const appearanceScreenshot = appearanceSource.indexOf(
      "'Theme, logo, tab icon, and search preview text'",
    );
    const uploadedLogoPath = appearanceSource.indexOf('/logo/.+');
    const uploadedFaviconPath = appearanceSource.indexOf('/favicon/.+');
    const publicLogoFill = appearanceSource.indexOf(
      'await logoUrlInput.fill(documentedLogoUrl)',
      uploadedLogoPath,
    );
    const publicFaviconFill = appearanceSource.indexOf(
      'await faviconUrlInput.fill(documentedFaviconUrl)',
      uploadedFaviconPath,
    );

    expect(appearanceSource).toMatch(
      /const documentedLogoUrl\s*=\s*'https:\/\/[^']+'/u,
    );
    expect(appearanceSource).toMatch(
      /const documentedFaviconUrl\s*=\s*'https:\/\/[^']+'/u,
    );
    expect(uploadedLogoPath).toBeGreaterThanOrEqual(0);
    expect(uploadedFaviconPath).toBeGreaterThan(uploadedLogoPath);
    expect(publicLogoFill).toBeGreaterThan(uploadedLogoPath);
    expect(publicFaviconFill).toBeGreaterThan(uploadedFaviconPath);
    expect(appearanceScreenshot).toBeGreaterThan(publicLogoFill);
    expect(appearanceScreenshot).toBeGreaterThan(publicFaviconFill);

    const transferDialog = readSource(
      'src/app/events/event-active-registration/event-registration-transfer-dialog.component.html',
    );
    expect(transferDialog).not.toContain('[value]="data.claimPageUrl"');
    expect(transferDialog).toContain(
      `(click)="copy(data.claimPageUrl, 'page')"`,
    );
  });

  it('keeps publication metadata and shared permission copy plain', () => {
    const publicCopy = [
      ...documentationConsumerGuideCatalog.flatMap(({ id, slug, title }) => [
        `guide id ${id}`,
        `guide slug ${slug}`,
        `guide title ${title}`,
      ]),
      ...PERMISSION_GROUPS.flatMap((group) => [
        `permission group ${group.label}`,
        ...group.permissions.flatMap(({ description, label }) => [
          `permission label ${label}`,
          `permission description ${description ?? ''}`,
        ]),
      ]),
    ];
    const violations = publicCopy.flatMap((copy) =>
      [...copy.matchAll(generatedGuideImplementationTerms)].map(
        (match) => `${copy}: ${match[0]}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('uses real ellipses in generated guide prose', () => {
    const docsRoot = path.join(repositoryRoot, 'tests/docs');
    const violations = documentationSources(docsRoot).flatMap((sourcePath) =>
      attachedMarkdownBodies(readFileSync(sourcePath, 'utf8'))
        .filter((body) => body.includes('...'))
        .map((body) => {
          const excerpt = body.match(/.{0,30}\.\.\..{0,30}/u)?.[0] ?? '...';
          return `${path.relative(repositoryRoot, sourcePath)}: ${excerpt}`;
        }),
    );

    expect(violations).toEqual([]);
  });

  it('uses exact profile navigation links when event names contain Profile', () => {
    const profileSource = readSource('tests/docs/profile/user-profile.doc.ts');
    const receiptSource = readSource(
      'tests/docs/finance/receipt-submission.doc.ts',
    );

    for (const [source, expectedCount] of [
      [profileSource, 1],
      [receiptSource, 2],
    ] as const) {
      const profileLinkLocators = source.match(
        /getByRole\(\s*'link',\s*\{[^}]*name:\s*'Profile'[^}]*\},?\s*\)/gu,
      );

      expect(profileLinkLocators).toHaveLength(expectedCount);
      for (const locator of profileLinkLocators ?? []) {
        expect(locator).toMatch(/exact:\s*true/u);
      }
    }
  });

  it('seeds cancellation users without a multi-user foreign-key lock cycle', () => {
    const source = readSource(
      'tests/docs/events/registration-cancellation.doc.ts',
    );
    const scenarioStart = source.indexOf(
      "test('Cancel a confirmed free ticket and release its places'",
    );
    const scenarioEnd = source.indexOf(
      "test('Cancel a paid ticket with add-ons and resolve a refund problem'",
      scenarioStart,
    );
    const scenarioSeed = source.slice(scenarioStart, scenarioEnd);

    expect(scenarioStart).toBeGreaterThanOrEqual(0);
    expect(scenarioEnd).toBeGreaterThan(scenarioStart);
    expect(
      scenarioSeed.match(
        /database\.insert\(schema\.eventRegistrations\)\.values\(\{/gu,
      ),
    ).toHaveLength(2);
    expect(scenarioSeed).not.toContain(
      'database.insert(schema.eventRegistrations).values([',
    );
    expect(scenarioSeed).not.toContain('.transaction(');
  });

  it('keeps waitlist availability docs backed by the recipient follow-up journey', () => {
    const source = readSource(
      'tests/docs/events/registration-cancellation.doc.ts',
    );
    const scenarioStart = source.indexOf(
      "test('Cancel a confirmed free ticket and release its places'",
    );
    const scenarioEnd = source.indexOf(
      "test('Cancel a paid ticket with add-ons and resolve a refund problem'",
      scenarioStart,
    );
    const scenario = source.slice(scenarioStart, scenarioEnd);

    expect(scenarioStart).toBeGreaterThanOrEqual(0);
    expect(scenarioEnd).toBeGreaterThan(scenarioStart);
    expect(scenario).toContain('storageState: adminStateFile');
    expect(scenario).toContain('const eventPath = waitlistEmail?.text.match');
    expect(scenario).toContain(
      "getByText('You are currently on the waitlist')",
    );
    expect(scenario).toContain("name: 'Leave the waitlist?'");
    expect(scenario).toContain(
      "getByRole('button', { exact: true, name: 'Sign up' })",
    );
    expect(scenario).toContain("status: 'CONFIRMED'");
    expect(scenario).toContain("kind: 'registrationConfirmed'");
    expect(scenario).toContain(
      'The earlier email does not reserve a place; sign-up succeeds only if a place is still available',
    );
  });

  it('keeps Stripe add-on cancellation docs backed by allocation and refund-recovery evidence', () => {
    const source = readSource(
      'tests/docs/events/registration-cancellation.doc.ts',
    );
    const addOnScenarioSource = readSource(
      'tests/support/utils/post-registration-addon-purchase-scenario.ts',
    );
    const webhookSource = readSource(
      'tests/support/utils/registration-checkout-webhook.ts',
    );
    const journeyTitle =
      "test('Cancel a paid ticket with add-ons and resolve a refund problem'";
    const journeyStart = source.indexOf(journeyTitle);
    const nextJourneyStart = source.indexOf(
      "test('Understand when you can no longer cancel your ticket'",
      journeyStart,
    );

    expect(journeyStart).toBeGreaterThanOrEqual(0);
    expect(nextJourneyStart).toBeGreaterThan(journeyStart);
    const journey = source.slice(journeyStart, nextJourneyStart);

    expect(journey).toContain('paidIncludedQuantity: 1');
    expect(journey).toContain("title: 'Weekend creative workshop'");
    expect(journey).not.toContain('Workshop kit cancellation and refund');
    expect(journey).toContain('scenario.beginPaidCheckout(2)');
    expect(journey).toContain('scenario.completeCheckout()');
    expect(journey.match(/scenario\.redeemPaidAddon\(/gu)).toHaveLength(2);
    expect(addOnScenarioSource).toContain('redeemRegistrationAddon({');
    expect(addOnScenarioSource).toContain('Effect.provide(scenarioLayer)');
    const scenarioCleanupStart = addOnScenarioSource.indexOf(
      'const cleanup = async () => {',
    );
    const scenarioCleanupEnd = addOnScenarioSource.indexOf(
      '\n  return {',
      scenarioCleanupStart,
    );
    expect(scenarioCleanupStart).toBeGreaterThanOrEqual(0);
    expect(scenarioCleanupEnd).toBeGreaterThan(scenarioCleanupStart);
    const scenarioCleanup = addOnScenarioSource.slice(
      scenarioCleanupStart,
      scenarioCleanupEnd,
    );
    const acquisitionRefundCleanup = scenarioCleanup.indexOf(
      '.delete(schema.registrationAcquisitionRefundAllocations)',
    );
    const acquisitionComponentCleanup = scenarioCleanup.indexOf(
      '.delete(schema.registrationAcquisitionComponents)',
    );
    const acquisitionPaymentCleanup = scenarioCleanup.indexOf(
      '.delete(schema.registrationAcquisitionPayments)',
    );
    const acquisitionCleanup = scenarioCleanup.indexOf(
      '.delete(schema.registrationAcquisitions)',
    );
    const fulfillmentCleanup = scenarioCleanup.indexOf(
      '.delete(schema.eventRegistrationAddonFulfillmentEvents)',
    );
    const refundCleanup = scenarioCleanup.indexOf(
      '.delete(schema.transactions)',
      fulfillmentCleanup,
    );
    const purchaseLotCleanup = scenarioCleanup.indexOf(
      '.delete(schema.eventRegistrationAddonPurchaseLots)',
    );
    expect(acquisitionRefundCleanup).toBeGreaterThanOrEqual(0);
    expect(acquisitionComponentCleanup).toBeGreaterThan(
      acquisitionRefundCleanup,
    );
    expect(acquisitionPaymentCleanup).toBeGreaterThan(acquisitionRefundCleanup);
    expect(acquisitionCleanup).toBeGreaterThan(acquisitionRefundCleanup);
    expect(fulfillmentCleanup).toBeGreaterThan(acquisitionRefundCleanup);
    expect(refundCleanup).toBeGreaterThan(fulfillmentCleanup);
    expect(purchaseLotCleanup).toBeGreaterThan(refundCleanup);
    expect(scenarioCleanup).toContain(
      'schema.eventRegistrationAddonFulfillmentEvents.registrationId,\n            registrationId',
    );
    expect(scenarioCleanup).toContain(
      'schema.eventRegistrationAddonFulfillmentEvents.tenantId,\n            input.tenant.id',
    );
    expect(scenarioCleanup).toContain(
      'eq(schema.transactions.eventRegistrationId, registrationId)',
    );
    expect(scenarioCleanup).toContain(
      'eq(schema.transactions.tenantId, input.tenant.id)',
    );
    expect(scenarioCleanup).toContain("eq(schema.transactions.type, 'refund')");

    expect(journey).toContain("name: 'Cancel ticket'");
    expect(journey).toContain('eventRegistrationAddonFulfillmentAllocations');
    expect(journey).toContain('registrationAcquisitions.findFirst');
    expect(journey).toContain("orderBy: { ordinal: 'desc' }");
    expect(journey).toContain('registrationAcquisitionPayments.findMany');
    expect(journey).toContain('registrationAcquisitionComponents.findMany');
    expect(journey).toContain('registrationAcquisitionRefundAllocations');
    expect(journey).not.toContain('eventRegistrationAddonRefundAllocations');
    expect(journey).toContain('expect(cancellationAllocations).toEqual([');
    expect(journey).toContain('expect(refundAllocations).toEqual([');
    const refundAllocationAssertion = journey.slice(
      journey.indexOf('expect(refundAllocations).toEqual(['),
      journey.indexOf('expect(refundClaim).toMatchObject({'),
    );
    expect(refundAllocationAssertion).toContain(
      'acquisitionId: currentAcquisition.id',
    );
    expect(refundAllocationAssertion).toContain(
      'acquisitionPaymentId: acquisitionPayment.id',
    );
    expect(refundAllocationAssertion).toContain(
      'componentId: paidAcquisitionComponent.id',
    );
    expect(refundAllocationAssertion).toContain(
      'refundAmount: expectedRefundAmounts.grossAmount',
    );
    expect(refundAllocationAssertion).toContain(
      'stripeFeeAmount: expectedRefundAmounts.stripeFeeAmount',
    );
    expect(journey).toContain('allocateAcquisitionComponentQuantity({');
    expect(journey).toContain('expect(expectedRefundAmounts).toMatchObject({');
    expect(journey).toContain('grossAmount: 500');
    expect(journey).toContain('netAmount: 468');
    expect(journey).toContain(').toBe(expectedRefundAmounts.grossAmount);');
    expect(journey).toContain('currency: tenant.currency');
    expect(journey).toContain(
      'expect(refundClaim.stripeAccountId).toBe(sourceTransaction.stripeAccountId)',
    );
    expect(journey).toContain("source: 'included'");
    expect(journey).toContain("source: 'purchased'");
    expect(journey).toContain('refundAllocatedPurchasedQuantity: 0');
    expect(journey).not.toContain('refundAllocatedPurchasedQuantity: 1');
    expect(journey).not.toContain('refundAllocatedQuantity: 1');
    expect(journey).toContain("refundDisposition: 'claims_created'");
    expect(journey).toContain('amount: -expectedRefundAmounts.grossAmount');
    expect(journey).toContain('stripeRefundApplicationFee: true');
    expect(journey).toContain('database.query.transactions.findMany({');
    expect(journey).toContain('expect(refundClaims).toHaveLength(1)');
    expect(journey).toContain(
      'expect(stockBeforeCancellation).toEqual({ totalAvailableQuantity: 3 })',
    );
    expect(journey).toContain(
      'expect(stockAfterCancellation).toEqual({ totalAvailableQuantity: 4 })',
    );

    const refundWebhookStart = webhookSource.indexOf(
      'export const deliverRegistrationRefundWebhook',
    );
    expect(refundWebhookStart).toBeGreaterThanOrEqual(0);
    const refundWebhookSource = webhookSource.slice(refundWebhookStart);
    expect(refundWebhookSource).toContain(
      'Stripe.webhooks.generateTestHeaderString',
    );
    expect(refundWebhookSource).toContain("request.fetch('/webhooks/stripe'");
    expect(refundWebhookSource).toContain("'stripe-signature': signature");
    expect(refundWebhookSource).toContain(
      'refundGeneration: String(refundGeneration)',
    );
    expect(refundWebhookSource).toContain(
      "status: 'failed' | 'requires_action' | 'succeeded'",
    );
    expect(refundWebhookSource).toContain(
      "type: status === 'failed' ? 'refund.failed' : 'refund.updated'",
    );
    const refundWebhookCalls = [
      ...journey.matchAll(
        /await deliverRegistrationRefundWebhook\(\{[\s\S]*?^\s*\}\);/gmu,
      ),
    ].map(([call]) => call);
    expect(refundWebhookCalls).toHaveLength(3);
    const [
      actionRequiredRefundWebhook,
      failedRefundWebhook,
      succeededRefundWebhook,
    ] = refundWebhookCalls;
    if (
      !actionRequiredRefundWebhook ||
      !failedRefundWebhook ||
      !succeededRefundWebhook
    ) {
      throw new Error(
        'Expected requires-action, failed, and succeeded refund webhook calls',
      );
    }
    expect(actionRequiredRefundWebhook).toMatch(
      /amount:\s*expectedRefundAmounts\.grossAmount,/u,
    );
    expect(actionRequiredRefundWebhook).toMatch(
      /currency:\s*tenant\.currency,/u,
    );
    expect(actionRequiredRefundWebhook).toMatch(/refundGeneration:\s*0,/u);
    expect(actionRequiredRefundWebhook).toMatch(
      /refundId:\s*generationZeroRefundId,/u,
    );
    expect(actionRequiredRefundWebhook).toMatch(
      /status:\s*'requires_action',/u,
    );
    expect(failedRefundWebhook).toMatch(
      /amount:\s*expectedRefundAmounts\.grossAmount,/u,
    );
    expect(failedRefundWebhook).toMatch(/currency:\s*tenant\.currency,/u);
    expect(failedRefundWebhook).toMatch(/refundGeneration:\s*0,/u);
    expect(failedRefundWebhook).toMatch(/refundId:\s*generationZeroRefundId,/u);
    expect(failedRefundWebhook).toMatch(/status:\s*'failed',/u);
    expect(succeededRefundWebhook).toMatch(
      /amount:\s*expectedRefundAmounts\.grossAmount,/u,
    );
    expect(succeededRefundWebhook).toMatch(/currency:\s*tenant\.currency,/u);
    expect(succeededRefundWebhook).toMatch(/refundGeneration:\s*1,/u);
    expect(succeededRefundWebhook).toMatch(/status:\s*'succeeded',/u);
    expect(journey).toContain("new Intl.NumberFormat('de-DE', {");
    expect(journey).toContain('currency: tenant.currency');
    expect(journey).toContain('**${refundAmountLabel}**');

    expect(journey).toContain('waitForScannerAddonFulfillment');
    expect(journey).toContain(
      '`/scan/registration/${scenario.registrationId}`',
    );
    expect(journey).toContain('const cancelledScannerAlert');
    expect(journey).toContain(
      'Do not ask the attendee to pay or sign up again',
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refund in progress', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refund needs review', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refund needs attention', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refunded', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toContain('openProfileEventCard(page, scenario.title)');
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Refund delayed\//u,
    );
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Contact the organizer\//u,
    );
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Contact the organizer\//u,
    );
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Refund complete\//u,
    );

    expect(journey).toContain('storageState: gaStateFile');
    expect(journey).toContain("name: 'Review finance'");
    expect(journey).toContain('const providerActionTransactionRow');
    expect(journey).toContain("hasText: 'Payment action needed'");
    expect(journey).toContain("name: 'Refunds needing attention'");
    expect(journey).toContain("name: 'Review refund'");
    expect(journey).toContain("name: 'Continue refund'");
    expect(journey).toContain("name: 'Try failed refund again'");
    expect(journey).toContain(
      'stripeRefundAttempts: refundClaim.stripeRefundMaxAttempts',
    );
    expect(journey).toContain(
      'stripeRefundMaxAttempts: refundClaim.stripeRefundMaxAttempts',
    );
    expect(journey).not.toContain(
      '`attempts ${terminalRefundClaim.stripeRefundAttempts}/${terminalRefundClaim.stripeRefundMaxAttempts}`',
    );
    expect(journey).not.toContain(
      '`generation ${terminalRefundClaim.stripeRefundGeneration}`',
    );
    expect(journey).toContain('not.toContainText(refundClaim.id)');
    expect(journey).toContain('not.toContainText(scenario.registrationId)');
    expect(journey).toContain("getByLabel('Reason for this action')");
    expect(journey).toContain("name: 'Try failed refund again'");
    expect(journey.match(/mode: 'resumeGeneration'/gu)).toHaveLength(2);
    expect(journey.match(/mode: 'newGeneration'/gu)).toHaveLength(2);
    expect(journey).toContain('stripeRefundId: generationZeroRefundId');
    expect(journey).toContain("status: 'requires_action'");
    expect(journey).toContain('requiresActionWebhookEventId');
    expect(journey).toContain('stripeRefundGeneration: 1');
    expect(journey).toContain('stripeRefundHistory: [');
    expect(journey).toContain("action: 'refundClaim.requeue'");
    expect(journey).toContain("status: 'successful'");
    expect(journey).toContain("toEqual({ status: 'CANCELLED' })");
    expect(journey).toContain(
      'The money may not have reached your account yet',
    );
    expect(journey).toContain(
      'Treat a refund as complete only when Evorto shows **Refund complete**.',
    );
    expect(addOnScenarioSource).toContain(
      'paidIncludedQuantity > initialStock - paidPurchaseQuantity',
    );

    expect(journey).toContain(
      'registerDatabaseCleanup(() => scenario.cleanup())',
    );
    const journeyCleanupStart = journey.indexOf(
      'registerDatabaseCleanup(async (cleanupDatabase) => {',
    );
    const journeyCleanupEnd = journey.indexOf(
      'const settledCheckout = await scenario.beginPaidCheckout(2);',
      journeyCleanupStart,
    );
    expect(journeyCleanupStart).toBeGreaterThanOrEqual(0);
    expect(journeyCleanupEnd).toBeGreaterThan(journeyCleanupStart);
    const journeyCleanup = journey.slice(
      journeyCleanupStart,
      journeyCleanupEnd,
    );
    expect(journeyCleanup).toContain('.delete(schema.platformAuditEntries)');
    expect(journeyCleanup).toContain('.delete(schema.stripeWebhookEvents)');
    const journeyAcquisitionRefundCleanup = journeyCleanup.indexOf(
      '.delete(schema.registrationAcquisitionRefundAllocations)',
    );
    const journeyFulfillmentCleanup = journeyCleanup.indexOf(
      '.delete(schema.eventRegistrationAddonFulfillmentEvents)',
    );
    const journeyRefundCleanup = journeyCleanup.indexOf(
      '.delete(schema.transactions)',
      journeyFulfillmentCleanup,
    );
    expect(journeyAcquisitionRefundCleanup).toBeGreaterThanOrEqual(0);
    expect(journeyFulfillmentCleanup).toBeGreaterThan(
      journeyAcquisitionRefundCleanup,
    );
    expect(journeyRefundCleanup).toBeGreaterThan(
      journeyAcquisitionRefundCleanup,
    );
    expect(journeyCleanup).toContain(
      '.delete(schema.eventRegistrationAddonFulfillmentEvents)',
    );
    expect(journeyCleanup).toContain(
      'schema.eventRegistrationAddonFulfillmentEvents.registrationId,\n              scenario.registrationId',
    );
    expect(journeyCleanup).toContain(
      'schema.eventRegistrationAddonFulfillmentEvents.tenantId,\n              tenant.id',
    );
    expect(journeyCleanup).toMatch(
      /eq\(\s*schema\.transactions\.eventRegistrationId,\s*scenario\.registrationId/u,
    );
    expect(journeyCleanup).toMatch(
      /eq\(\s*schema\.transactions\.tenantId,\s*tenant\.id/u,
    );

    const freeJourneyStart = source.indexOf(
      "test('Cancel a confirmed free ticket and release its places'",
    );
    expect(freeJourneyStart).toBeGreaterThanOrEqual(0);
    const freeJourney = source.slice(freeJourneyStart, journeyStart);
    expect(freeJourney).toContain('expect(refunds).toEqual([])');
    expect(freeJourney).not.toContain("method: 'cash'");
    expect(freeJourney).not.toContain('Manual refund pending');
    expect(source).not.toContain("method: 'cash'");
    expect(source).not.toContain('A supported non-Stripe source');
    expect(source).not.toContain('source of truth');
    expect(source).not.toContain('focused by default');
    expect(source).not.toContain('receives focus');
    expect(source).toContain('## Cancel from the organizer overview');
    expect(source).toContain('## After the organizer cancels');
    expect(source).not.toContain('### Cancel from the organizer overview');
    expect(source).not.toContain('### After the organizer cancels');
    expect(source).not.toContain(
      '### When you can no longer cancel your ticket',
    );
  });

  it('keeps focused organization settings docs aligned with routes, permissions, and ownership', () => {
    const source = readSource('tests/docs/admin/general-settings.doc.ts');

    expect(source).toContain('Settings are divided into five pages');
    expect(source).toContain('**Organization settings**');
    expect(source).toContain('**Sign-up rules**');
    expect(source).toContain('**Appearance**');
    expect(source).toContain('**Legal pages**');
    expect(source).toContain('**Payments**');
    expect(source).toContain('Separate **Manage payments** access is required');
    expect(source).toContain(
      'Each page has its own **Save** action. Saving one page does not change settings on another page.',
    );
    expect(source).toContain(
      'Joining a waitlist does not count toward this limit',
    );
    expect(source).toContain("page.locator('app-organization-settings')");
    expect(source).toContain("page.locator('app-registration-settings')");
    expect(source).toContain("page.locator('app-appearance-settings')");
    expect(source).toContain("page.locator('app-legal-settings')");
    expect(source).toContain("page.locator('app-payment-provider-settings')");
    expect(source).toContain(
      'Organization name, reply email, location, and time zone',
    );
    expect(source).toContain(
      'Active sign-up limit and transfer and cancellation deadlines',
    );
    expect(source).toContain('Theme, logo, tab icon, and search preview text');
    expect(source).toContain(
      'Imprint and terms settings with a link to privacy setup',
    );
    expect(source).toContain(
      'Payment readiness, currency, refunds, receipts, and discounts',
    );
    expect(source).toContain("name: 'Save organization settings'");
    expect(source).toContain("name: 'Save sign-up rules'");
    expect(source).toContain("name: 'Save appearance settings'");
    expect(source).toContain("name: 'Save legal pages'");
    expect(source).toContain("name: 'Save payment settings'");
    expect(source).not.toContain('canonicalRootUrl');
    expect(source).not.toContain('Canonical root URL');
    expect(source).not.toContain('**Formatting locale**');
    expect(source).toContain('documentedEmailSenderName');
    expect(source).toContain('documentedEmailSenderEmail');
    expect(source).not.toContain('documentedStripeAccountId');
    expect(source).not.toContain('stripeAccountId');
    expect(source).toContain('documentedRegistrationLimit');
    expect(source).toContain('documentedTransferDeadlineHours');
    expect(source).toContain('documentedCancellationDeadlineHours');
    expect(source).toContain('documentedBuyEsnCardUrl');
    expect(source).toContain("from '../../support/fixtures/parallel-test'");
    expect(source).not.toContain('} finally {');
    expect(source).not.toContain('.update(schema.tenants)');
    expect(source).toContain("getByLabel('Upload organization logo file')");
    expect(source).toContain("getByLabel('Upload organization tab icon file')");
    expect(source).toContain('documentedLogoUrl');
    expect(source).toContain('documentedFaviconUrl');
    expect(source).toContain('Transfer deadline before event (hours)');
    expect(source).toContain('Cancellation deadline before event (hours)');
    expect(source).toContain('Refund fees on cancellation');
    expect(source).toContain(
      'If paid sign-ups are not ready, contact Evorto support before adding prices.',
    );
    expect(source).toContain("test('Publish legal pages @admin'");
    expect(source).toContain(
      "getByRole('textbox', { name: 'Privacy policy text' })",
    );
    expect(source).toContain('storageState: { cookies: [], origins: [] }');
    expect(source).toContain("name: 'Privacy policy'");
    expect(source).toContain('privacyPolicyUrl: null');
    expect(source).toContain(
      'When both are present, your public pages link to the page on the other website.',
    );
    expect(source).toContain(
      'Tax rates remain on the separate **Tax rates** page.',
    );
    expect(source).not.toContain('app-general-settings');
    expect(source).not.toContain("name: 'General settings'");
  });

  it('keeps unknown-domain recovery public, non-mutating, and beginner-readable', () => {
    const source = readSource('tests/docs/users/unknown-tenant-domain.doc.ts');
    const responseSource = readSource(
      'src/server/http/unknown-tenant-response.ts',
    );

    expect(source).toContain('No account is required');
    expect(source).toContain("unknownTenantUrl.hostname = 'unknown.localhost'");
    expect(source).toContain(
      "'/scan/registration/example-registration-from-qr'",
    );
    expect(source).toContain('expect(response?.status()).toBe(404)');
    expect(source).toContain('Your account and tickets have not changed');
    expect(source).toContain(
      'ask the person running the activity for the current Evorto link for this event',
    );
    expect(responseSource).toContain('status: 404');
    expect(responseSource).toContain("'Cache-Control': 'no-store'");
    expect(responseSource).toContain("'X-Robots-Tag': 'noindex, nofollow'");
  });

  it('keeps global-admin docs aligned with organization administration', () => {
    const source = readSource('tests/docs/admin/global-admin.doc.ts');

    expect(source).toContain('expectGlobalAdminTenantRows');
    expect(source).toContain('expectGlobalAdminTenantFormSurface');
    expect(source).toContain('Search organizations');
    expect(source).toContain('No organizations match this search');
    expect(source).toContain(
      "Review this organization's settings and manage its events, members, roles, and finances.",
    );
    expect(source).toContain('Open organization');
    expect(source).not.toContain('canonicalRootUrl');
    expect(source).not.toContain('Canonical root URL');
    expect(source).not.toContain('Stripe account');
    expect(source).not.toContain('stripeAccountId');
    expect(source).toContain(
      'Expected global-admin docs create flow to persist tenant',
    );
    expect(source).toContain('createdTenantDomain');
    expect(source).toContain('.delete(schema.tenants)');
    expect(source).toContain(
      'const documentedTenant = await database.query.tenants.findFirst({',
    );
    expect(source).toContain('where: { id: tenant.id }');
    expect(source).toContain(
      "throw new Error('Expected the documented organization to exist')",
    );
    expect(source).not.toContain('const documentedTenant = tenant');
    expect(source).not.toContain("fillTenantSearch(page, 'localhost')");
    expect(source).toContain('await fillTenantSearch(page, primaryDomain)');
    expect(source).toContain(
      'expect(tenantNameInput(page)).toHaveValue(createdTenant.name)',
    );
    expect(source).toContain(
      'expect(tenantPrimaryDomainInput(page)).toHaveValue(',
    );
    expect(source).toContain(
      "The create and edit forms manage the organization's website address, name, theme, currency, and time zone.",
    );
    expect(source).toContain(
      'They show **Paid sign-ups ready** or **Paid sign-ups need attention**, but do not change payment setup.',
    );
    expect(source).toContain(
      'Contact Evorto support when attention is needed.',
    );
    expect(source).not.toContain('The formatting locale remains fixed');
    expect(source).toContain("Enter only the organization's address");
    expect(source).toContain(
      "Evorto rejects an address for a specific page instead of the organization's main address, or an address already used by another organization.",
    );
    expect(source).toContain('Each change made here requires a reason.');
    expect(source).toContain(
      'The website address cannot change while a payment, refund, or ticket transfer is unfinished.',
    );
    expect(source).not.toContain('redirecting to the new one');
    expect(source).toContain(
      "getByRole('link', { name: 'Evorto change history' })",
    );
    expect(source).toContain("page.locator('app-platform-audit')");
    expect(source).toContain('.delete(schema.platformAuditEntries)');
    expect(source).toContain('.delete(schema.tenantPrivacyPolicyVersions)');
    expect(source).not.toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(source).not.toContain('impersonation');
    expect(source).not.toContain('impersonation workflow');
    expect(source).not.toContain('multiple active domains');
  });

  it('keeps platform-operator docs backed by target-scoped mutations and audit readback', () => {
    const source = readSource(
      'tests/docs/admin/platform-tenant-operations.doc.ts',
    );

    expect(source).toContain('seeded.scenario.events.draft.eventId');
    expect(source).toContain('seeded.scenario.events.past.eventId');
    expect(source).toContain('seedUserRoleAssignmentScenario');
    expect(source).toContain(
      "await expectPersistedAudit(eventReason, 'event.update')",
    );
    expect(source).toContain(
      "await expectPersistedAudit(templateReason, 'template.update')",
    );
    expect(source).toContain(
      "await expectPersistedAudit(roleAssignmentReason, 'user.assignRoles')",
    );
    expect(source).toContain(
      "await expectPersistedAudit(roleRemovalReason, 'user.assignRoles')",
    );
    expect(source).toContain(
      "await expectPersistedAudit(receiptReason, 'receipt.review')",
    );
    expect(source).toContain(
      "await expectPersistedAudit(registrationReason, 'registration.checkIn')",
    );
    expect(source).toContain(
      "getByRole('link', { exact: true, name: 'Manage events' })",
    );
    expect(source).toContain(
      "getByRole('button', { name: 'Save draft details' })",
    );
    expect(source).toContain("getByRole('button', { name: 'Save template' })");
    expect(source).toContain("getByRole('button', { name: 'Save roles' })");
    expect(source).toContain(
      "const saveDecision = platformFinance.getByRole('button', {",
    );
    expect(source).toContain("name: 'Save decision'");
    expect(source).toContain(
      'expect(saveDecision).toBeEnabled({ timeout: 20_000 })',
    );
    expect(source).toContain(
      "const checkIn = registrationDetail.getByRole('button', {",
    );
    expect(source).toContain("name: 'Check in'");
    expect(source).toContain(
      'expect(checkIn).toBeEnabled({ timeout: 20_000 })',
    );
    expect(source).toContain(
      "getByRole('link', { name: 'Evorto change history' })",
    );
    expect(source).toContain('.delete(schema.platformAuditEntries)');
    expect(source).toContain('await assignmentScenario.cleanup()');
    expect(source).toContain(
      'It does not reimburse the member, transfer money, issue refunds, or add tax rates. Those are separate actions.',
    );
    expect(source).not.toContain('This walkthrough');
    expect(source).not.toContain('full event and template graph editing');
    expect(source).not.toContain('### Recover a refund without duplicating it');
  });

  it('keeps global Email Outbox docs aligned with visibility, recovery, and permission behavior', () => {
    const source = readSource('tests/docs/admin/email-outbox.doc.ts');

    expect(source).toContain('seedEmailOutboxScenario');
    expect(source).toContain("page.goto('/global-admin')");
    expect(source).toContain("getByRole('link', { name: 'Email delivery' })");
    expect(source).toContain('Delivery details');
    expect(source).toContain(
      'Evorto could not confirm whether this email was delivered',
    );
    expect(source).toContain('This email could not be sent.');
    expect(source).toContain('the address cannot receive organization emails');
    expect(source).toContain('scenario.sent.subject');
    expect(source).toContain('await scenario.cleanup()');
    expect(source).toContain(
      'The **Delivery details** list shows up to 100 recent messages',
    );
    expect(source).toContain(
      'Messages marked **Could not send** or **Delivery not confirmed** appear before messages still waiting or being sent.',
    );
    expect(source).toContain(
      'Successfully **Sent** messages are included in the total but omitted from this list.',
    );
    expect(source).toContain(
      'For **Sending**, wait briefly and select **Check again** once. If it still has not changed, contact Evorto support with the same details.',
    );
    expect(source).toContain(
      'Email totals for all organizations and messages needing attention',
    );
    expect(source).toContain(
      '**Delivery not confirmed** means Evorto could not confirm delivery and will not send the message again',
    );
    expect(source).toContain(
      'There is currently no search or resend action on this page.',
    );
    expect(source).toContain(
      'Only people who manage Evorto as a whole can use this page.',
    );
    expect(source).toContain(
      'who does not manage Evorto as a whole sees **Access not allowed**',
    );
    expect(source).toContain(
      'Being an Admin for one organization does not open this page for all organizations.',
    );
    expect(source).not.toContain('tenant admins can review all email');
    expect(source).not.toContain('email service did not accept');
    expect(source).not.toContain('recipient is not approved');
    expect(source).not.toContain('Check again retries the email');
  });

  it('keeps profile docs aligned with implemented account and event-card behavior', () => {
    const source = readSource('tests/docs/profile/user-profile.doc.ts');

    expect(source).toContain('Sign-in email address and email for updates');
    expect(source).toContain(
      'IBAN or PayPal details used when finance teams reimburse receipts',
    );
    expect(source).toContain(
      'You can use a different address for updates than for signing in.',
    );
    expect(source).toContain(
      'Optional IBAN and PayPal fields tell finance teams where to send reimbursements.',
    );
    expect(source).toContain('## Use a private transfer code');
    expect(source).toContain(
      'review the event, questions you need to answer, price, guests, add-ons, check-ins, and handed-out items before accepting it',
    );
    expect(source).toContain(
      "const useTransferCode = page.getByRole('link', {",
    );
    expect(source).toContain("name: 'Use transfer code'");
    expect(source).toContain(
      "ticketTransfers.getByRole('heading', { name: 'Ticket transfers' })",
    );
    expect(source).toContain(
      'Private transfer code guidance and Use transfer code action',
    );
    expect(source).toContain('Profile contact details and available actions');
    expect(source).not.toContain('Profile information section');
    expect(source).toContain('documentedIban');
    expect(source).toContain('documentedPaypalEmail');
    expect(source).toContain("name: 'Email for updates'");
    expect(source).toContain("name: 'IBAN (for reimbursements)'");
    expect(source).toContain("name: 'PayPal email (for reimbursements)'");
    expect(source).toContain('updatedProfileUser.iban).toBe(documentedIban)');
    expect(source).toContain(
      'updatedProfileUser.paypalEmail).toBe(documentedPaypalEmail)',
    );
    expect(source).toContain(
      'From an event card, you can continue a payment or open the event to view its ticket, cancellation, transfer, or waitlist details.',
    );
    expect(source).toContain(
      'Finish payment here, or open the event page for your sign-up details.',
    );
    expect(source).toContain(
      'Open the event page for waitlist details and whether you can leave it.',
    );
    expect(source).toContain(
      '`/events/${profileEventCards.confirmed.eventId}`',
    );
    expect(source).toContain(
      '`/events/${profileEventCards.pendingCheckout.eventId}`',
    );
    expect(source).toContain('`/events/${profileEventCards.waitlist.eventId}`');
    expect(source).toContain(
      '`/events/${profileEventCards.checkedIn.eventId}`',
    );
    expect(source).toContain("getByRole('link', { name: 'Continue payment' })");
    expect(source).toContain('pendingCheckoutRegistration');
    expect(source).toContain('checkedInAddonPurchase');
    expect(source).toContain(
      'You are checked in. Open the event page for ticket details. You can no longer cancel, but you can still transfer the ticket and its existing check-ins.',
    );
    expect(source).toContain('Your receipts');
    expect(source).toContain("profileReceiptFileName = 'train-tickets.pdf'");
    expect(source).toContain('schema.financeReceipts');
    expect(source).toContain('profileReceiptCard.getByText');
    expect(source).toContain('profileReceiptFileName');
    expect(source).toContain('Submitted');
    expect(source).toContain('profileEvent.title');
    expect(source).toContain('18,75 €');
    expect(source).toContain(
      'Expected generated profile docs user after update',
    );
    expect(source).toContain('updatedProfileUser.communicationEmail).toBe');
    expect(source).toContain(
      'Expected generated profile docs receipt after read',
    );
    expect(source).toContain('attachmentFileName: profileReceiptFileName');
    expect(source).toContain('totalAmount: 1875');
    expect(source).not.toContain('automatic refund');
    expect(source).not.toContain('resale');
    expect(source).not.toContain('ticket email');
  });

  it('keeps account-creation docs aligned with notification-email and retry semantics', () => {
    const source = readSource('tests/docs/users/create-account.doc.ts');

    expect(source).toContain(
      'The form already fills in the first name, last name, and **Email for updates** from the sign-in account when available.',
    );
    expect(source).toContain(
      '**Join organization** for a new membership, or **Finish setup** for an existing member, stays unavailable until every required field is valid and the current policy is accepted.',
    );
    expect(source).toContain(
      'If your account already belongs to another organization, this step adds the same account here.',
    );
    expect(source).toContain(
      'If the policy or questions change while the page is open, Evorto keeps answers that still apply and asks you to review the changes.',
    );
    expect(source).toContain(
      'setup updates your privacy acceptance and required answers',
    );
    expect(source).toContain(
      'Your home organization changes only when you choose a different one from your profile.',
    );
    expect(source).not.toContain('login email as your notification email');
    expect(source).not.toContain('tenant-specific notification email');
  });

  it('keeps tenant-onboarding docs page-backed and explicit about versioned consent', () => {
    const source = readSource('tests/docs/users/tenant-onboarding.doc.ts');
    expect(source).toContain("admin.page.goto('/admin/onboarding')");
    expect(source).toContain('takeScreenshot');
    expect(source).toContain('Publishing a policy takes effect immediately');
    expect(source).toContain('every existing member');
    expect(source).toContain('Finish setup');
    expect(source).toContain('tenantPrivacyPolicyAcceptances.findFirst');
    expect(source).toContain('tenantOnboardingQuestionAnswers.findFirst');
    expect(source).toContain('Make this my home organization');
    expect(source).toContain(
      'Privacy acceptance and answers stay with the organization and the policy the member accepted.',
    );
    expect(source).toContain(
      'When a web address is saved, selecting **Privacy** on a public page opens that address.',
    );
    expect(source).toContain("name: 'Privacy policy web address'");
    expect(source).toContain('.fill(privacyPolicyUrl)');
    expect(source).toContain('privacyPolicyText,\n    privacyPolicyUrl,');
    expect(source).toContain("name: 'Open the full privacy policy'");
    expect(source).toContain("toHaveAttribute('href', privacyPolicyUrl)");
    expect(source).toContain(
      'Text published by Evorto and a separate web address belong to the same policy.',
    );
  });

  it('keeps receipt-submission cleanup deterministic and database-only', () => {
    const source = readSource('tests/docs/finance/receipt-submission.doc.ts');
    const cleanupStart = source.indexOf(
      'registerDatabaseCleanup(async (cleanupDatabase) => {',
    );
    const cleanupEnd = source.indexOf(
      "await testInfo.attach('markdown'",
      cleanupStart,
    );

    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);

    expect(cleanupSource).toContain(
      'attachmentUploadId: schema.financeReceipts.attachmentUploadId',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceipts.tenantId, tenant.id)',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceipts.eventId, eventId)',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceipts.submittedByUserId, submitter.id)',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceipts.attachmentFileName, receiptName)',
    );
    expect(cleanupSource).toContain('.delete(schema.financeReceipts)');
    expect(cleanupSource).toContain('.delete(schema.financeReceiptUploads)');
    expect(cleanupSource).toContain(
      'inArray(schema.financeReceiptUploads.id, uploadIds)',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceiptUploads.tenantId, tenant.id)',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceiptUploads.eventId, eventId)',
    );
    expect(cleanupSource).toContain(
      'eq(schema.financeReceiptUploads.uploadedByUserId, submitter.id)',
    );
    expect(cleanupSource).not.toMatch(/DeleteObject|S3Client/u);
  });

  it('keeps finance receipt docs aligned with email notification and reimbursement scope', () => {
    const overviewSource = readSource(
      'tests/docs/finance/finance-overview.doc.ts',
    );
    const receiptSource = readSource(
      'tests/docs/finance/receipt-review-reimbursement.doc.ts',
    );
    const combinedSource = `${overviewSource}\n${receiptSource}`;

    expect(combinedSource).toContain(
      'Evorto tries to email the submitter. Delivery may take time or fail.',
    );
    expect(receiptSource).toContain('organizerCommunicationEmail');
    expect(receiptSource).toContain('One person may have access to both');
    expect(receiptSource).not.toContain('One person may have both permissions');
    expect(combinedSource).toContain(
      "getByRole('button', { name: 'Record reimbursement' })",
    );
    expect(receiptSource).toContain(
      'Recording reimbursement updates the receipt to **Reimbursed**.',
    );
    expect(receiptSource).toContain(
      'This confirms that the bank or PayPal transfer was completed outside Evorto',
    );
    expect(combinedSource).not.toContain(
      'Submitter email notification is still manual',
    );
    expect(combinedSource).not.toContain('automatic email');
    expect(combinedSource).not.toContain('automatically transfer');
    expect(combinedSource).not.toContain('automatic money movement');
  });

  it('keeps finance overview docs aligned with permission-scoped navigation', () => {
    const source = readSource('tests/docs/finance/finance-overview.doc.ts');

    expect(source).toContain(
      'You need the finance access for the page you want to use',
    );
    expect(source).toContain(
      'The finance overview shows links only for the work you are allowed to do.',
    );
    expect(source).toContain(
      'someone who can approve receipts does not automatically see all payments.',
    );
    expect(source).toContain(
      "- **View money received and spent** to review the organization's payment history.",
    );
    expect(source).toContain(
      '- **Approve receipts** to review submitted receipts.',
    );
    expect(source).toContain(
      '- **Record receipt reimbursements** to record that approved receipts were paid.',
    );
    expect(source).toContain('visibleTransactionComment');
    expect(source).toContain('cancelledTransactionComment');
    expect(source).toContain(
      'Cancelled payment attempts are omitted from this list.',
    );
    expect(source).toContain(
      'page.getByText(cancelledTransactionComment)).toHaveCount(0)',
    );
    expect(source).not.toContain('all finance users see all finance pages');
    expect(source).not.toContain(
      'receipt approval access includes transactions',
    );
    expect(source).not.toContain('single finance permission');
  });

  it('keeps tax-rate documentation backed by account-scoped import and saved template/event assignments', () => {
    const source = readSource('tests/docs/finance/inclusive-tax-rates.doc.ts');

    expect(source).toContain(
      "test('Add a tax rate included in the shown price'",
    );
    expect(source).toContain(
      'Available and unavailable tax rates for paid sign-ups',
    );
    expect(source).toContain('Expected the tax-rate docs tenant to use Stripe');
    expect(source).toContain('await rateCheckbox.check()');
    expect(source).toContain(
      "page.getByRole('button', { name: 'Add selected' }).click()",
    );
    expect(source).toContain('stripeAccountId: tenantRecord.stripeAccountId');
    expect(source).toContain('documentedRate.stripeTaxRateId');
    expect(source).toContain('const reopenedDialog');
    expect(source).toContain(
      'await expect(importedRateCheckbox).toBeDisabled()',
    );
    expect(source).toContain(
      "importedRateRow.getByText('Already added', { exact: true })",
    );
    expect(source).toContain(
      'If rates cannot be loaded, select **Try again**; nothing is added until the list loads and you confirm a selection.',
    );
    expect(source).toContain("test.describe.configure({ mode: 'default' })");
    expect(source).toContain(
      'You need **View templates**, **Edit all templates**, and **Create events** access.',
    );
    expect(source).toContain('Free choices hide the price and tax-rate fields');
    expect(source).not.toContain('free registrations keep the field disabled');
    expect(source).toContain('No tax rates available for shown prices');
    expect(source).toContain('Keep the choice free until a rate is available.');
    expect(source).toContain('await templateTaxRateSelect.click()');
    expect(source).toContain("name: 'Update template'");
    expect(source).toContain(
      'database.query.templateRegistrationOptions.findFirst',
    );
    expect(source).toContain('.toBe(templateTaxRate.stripeTaxRateId)');
    expect(source).toContain('await eventEditTax.click()');
    expect(source).toContain("name: 'Save changes'");
    expect(source).toContain(
      'database.query.eventRegistrationOptions.findFirst',
    );
    expect(source).toContain('.toBe(eventTaxRate.stripeTaxRateId)');
    expect(source).toContain('registerDatabaseCleanup');
    expect(source).toContain('} finally {');
    expect(source).toContain('originalTemplateTaxRateId');
    expect(source).toContain(
      '.delete(schema.eventRegistrationOptionDiscounts)',
    );
    expect(source).toContain('.delete(schema.eventRegistrationQuestions)');
    expect(source).toContain('.delete(schema.addonToEventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventAddons)');
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).toContain('.update(schema.templateRegistrationOptions)');
    expect(source).toContain(
      '.set({ stripeTaxRateId: originalTemplateTaxRateId })',
    );
  });

  it('keeps template docs aligned with simple and advanced registration setup', () => {
    const source = readSource('tests/docs/templates/templates.doc.ts');

    expect(source).toContain(
      'Simple setup starts with one choice for attendees and one for organizers or helpers.',
    );
    expect(source).toContain(
      'Advanced setup supports any number of named choices and lets you choose which choices can use each reusable add-on.',
    );
    expect(source).toContain(
      'To return to simple setup, first save exactly one organizer choice and one attendee choice.',
    );
    expect(source).toContain(
      '**Description** and **Details shown after sign-up**',
    );
    expect(source).toContain(
      '**ESNcard price**: An optional lower price for organizations that offer an ESNcard discount.',
    );
    expect(source).toContain(
      '**Who can use this choice**: The organization roles allowed to choose it.',
    );
    expect(source).toContain(
      '**Manual approval** lets an organizer review it first.',
    );
    expect(source).toContain("name: 'Manual approval'");
    expect(source).toContain(
      "expect(organizerRegistrationOption.registrationMode).toBe('application')",
    );
    expect(source).toContain('Already selected roles are not offered again.');
    expect(source).toContain(
      "throw new Error('Expected template docs autocomplete option to have text')",
    );
    expect(source).toContain(
      'Organizer planning tips**: Optional private organizer notes',
    );
    expect(source).toContain(
      'When **Enable payment** is on, the price and tax-rate fields appear for that sign-up choice.',
    );
    expect(source).toContain(
      'Add-ons can be free or paid and available with one or more sign-up choices.',
    );
    expect(source).toContain('shown with the matching sign-up choices.');
    expect(source).toContain(
      'Questions can include help text and can be marked as required.',
    );
    expect(source).toContain('### General settings');
    expect(source).toContain('### Sign-up setup');
    expect(source).toContain('### Reusable add-ons');
    expect(source).toContain('### Sign-up questions');
    expect(source).not.toContain('#### General settings');
    expect(source).not.toContain('#### Sign-up setup');
    expect(source).not.toContain('#### Reusable add-ons');
    expect(source).not.toContain('#### Sign-up questions');
    expect(source).toContain(
      'Choose the sign-up choice that should show each question',
    );
    expect(source).toContain('fillTemplateBasics');
    expect(source).toContain('Switch to advanced setup?');
    expect(source).toContain('app-template-registration-option-editor');
    expect(source).toContain('app-template-addon-editor');
    expect(source).toContain('app-template-question-editor');
    expect(source).toContain('createdTemplate.planningTips');
    expect(source).toContain('addonToTemplateRegistrationOptions');
    expect(source).toContain('templateRegistrationQuestions.findFirst');
    expect(source).toContain('includedQuantity: 2');
    expect(source).toContain('optionalPurchaseQuantity: 1');
    expect(source).toContain(
      'expect(createdEvent.simpleModeEnabled).toBe(false)',
    );
    expect(source).toContain('eventOptionsAfterTemplateEdit');
    expect(source).toContain('eventMappingsAfterTemplateEdit');
    expect(source).toContain('testClock.plus({ months: 2 })');
    expect(source).toContain(
      'Expected template docs flow to persist the reusable add-on',
    );
    expect(source).toContain(
      'If **Event could not be created** appears, your entries remain in the form.',
    );
    expect(source).toContain('If the template changed while the form was open');
    expect(source).toContain(
      'The event has been created only when its details page opens and shows the event title.',
    );
    expect(source).not.toContain('addOnAttachment.quantity');
    expect(source).not.toContain('currently the only mode');
    expect(source).not.toContain('public event planning tips');
    expect(source).not.toContain('roles can be selected more than once');
    expect(source).not.toContain(
      'ESNcard pricing is configured on events only',
    );
  });

  it('keeps template category docs backed by deterministic persistence checks', () => {
    const source = readSource(
      'tests/docs/template-categories/categories.doc.ts',
    );

    expect(source).toContain("const categoryTitle = 'Outdoor activities'");
    expect(source).toContain(
      'Expected generated category docs to persist the category',
    );
    expect(source).toContain(
      'Expected generated category docs to update the category',
    );
    expect(source).toContain(
      'updatedCategory.title).toBe(updatedCategoryTitle)',
    );
    expect(source).toContain(
      'the page tells them to ask an administrator for access',
    );
    expect(source).not.toContain(
      'which permission an administrator needs to grant',
    );
    expect(source).toContain('.delete(schema.eventTemplateCategories)');
    expect(source).not.toContain("fill('Test category')");
    expect(source).not.toContain('Test category edited');
  });

  it('keeps registration docs aligned with unavailable states, participant add-ons, and the current transfer flow', () => {
    const source = readSource('tests/docs/events/register.doc.ts');
    const addOnScenarioSource = readSource(
      'tests/support/utils/post-registration-addon-purchase-scenario.ts',
    );
    const transferSource = readSource(
      'tests/docs/events/registration-transfer.doc.ts',
    );
    const paidTransferJourneyStart = transferSource.indexOf(
      "test('Finish a paid transfer and resolve a refund problem'",
    );
    expect(paidTransferJourneyStart).toBeGreaterThan(0);
    const freeTransferSource = transferSource.slice(
      0,
      paidTransferJourneyStart,
    );
    const paidTransferSource = transferSource.slice(paidTransferJourneyStart);
    const paidTransferScenarioSource = readSource(
      'tests/support/utils/paid-registration-transfer-scenario.ts',
    );
    const registrationPageSource = readSource(
      'tests/support/utils/event-registration-page.ts',
    );

    expect(source).toContain(
      'When an attendee choice is full, **Join waitlist** replaces **Sign up**.',
    );
    expect(source).toContain(
      'People on the waitlist can return to the event page and use **Leave waitlist** before the event starts.',
    );
    expect(source).toContain(
      'When the sign-up window is closed, attendees can still read the event details, but the sign-up action is removed.',
    );
    expect(source).toContain(
      'You can view this event, but none of its sign-up choices are available to you.',
    );
    expect(source).toContain(
      'pressing Enter chooses **Stay on waitlist**, so your place stays unchanged',
    );
    expect(source).toContain(
      'A shared link does not make a sign-up choice available to you.',
    );
    expect(source).not.toContain('receives focus by default');
    expect(source).not.toContain('grant eligibility');
    expect(source).not.toContain('### Paid sign-ups');
    expect(source).toContain("test('Buy add-ons for a confirmed ticket'");
    expect(source).not.toContain('## Buy add-ons for a confirmed ticket');
    expect(source).not.toContain('## Sign-up unavailable states');
    expect(source).toContain(
      'This guide is for a signed-in attendee whose account belongs to the same organization as the event.',
    );
    expect(source).toContain(
      'no organizer or administrator access is required for an ordinary sign-up',
    );
    expect(source).toContain(
      "For a paid sign-up, the organization's online payments must be available",
    );
    expect(source).toContain('Show the QR code when attending the event.');
    expect(source).toContain(
      'guests do not need separate accounts, but each guest uses one available event place and stays attached to your ticket.',
    );
    expect(source).toContain(
      "const guestCountInput = participantRegistrationCard.getByLabel('Guests')",
    );
    expect(source).toContain("await guestCountInput.fill('1')");
    expect(source).toContain("getByText('+ you = 2 places')");
    expect(source).toContain('expect(registration.guestCount).toBe(1)');
    expect(source).toContain('confirmedSpots: 2');
    expect(source).toContain(
      'expect(pendingTransaction.amount).toBe(paidOption.price * 2)',
    );
    expect(source).toContain('expect(pendingRegistration?.guestCount).toBe(1)');
    expect(source).toContain('const paidOptionDuringCheckout');
    expect(source).toContain('reservedSpots: 2');
    expect(source).toContain('const paidOptionAfterCheckout');
    expect(source).toContain('Includes 1 guest plus you.');
    expect(source).not.toContain('not logged it');
    expect(source).not.toContain(
      'This code is needed when attending the event.',
    );
    expect(source).toContain('seedPostRegistrationAddonPurchaseScenario');
    expect(source).toContain('waitForRegistrationPage');
    expect(source).toContain('deliverCompletedRegistrationCheckoutWebhook({');
    expect(source).not.toContain('fillTestCard');
    expect(source).toContain(
      'After payment succeeds, return to the event page and check for **Your ticket is confirmed**.',
    );
    expect(source).not.toContain(
      'After successful payment, you are redirected back to the event page',
    );
    expect(source).toContain('This add-on is not sold before the event.');
    expect(source).toContain('This add-on is not sold during the event.');
    expect(source).toContain('Payment is pending');
    expect(source).toContain('Continue to payment');
    expect(source).not.toContain('await scenario.beginPaidCheckout(2)');
    expect(source).toContain("name: 'Continue to payment'");
    expect(source).toContain(
      String.raw`page.waitForURL(/checkout\.stripe\.com/`,
    );
    expect(source).toContain('scenario.readPendingCheckout()');
    expect(source).toContain('scenario.completeCheckout()');
    expect(source).toContain('eventRegistrationAddonPurchaseOrders');
    expect(source).toContain('database.query.transactions');
    expect(source).toContain('eventRegistrationAddonPurchases');
    expect(source).toContain('eventRegistrationAddonPurchaseLots');
    expect(addOnScenarioSource).toContain('purchaseRegistrationAddon({');
    expect(addOnScenarioSource).toContain('completePaidAddonPurchaseCheckout(');
    expect(addOnScenarioSource).toContain(
      'class ProductionAddonPurchaseStripeHttpClient',
    );
    expect(addOnScenarioSource).toContain('adoptExistingPurchase(');
    expect(addOnScenarioSource).toContain(
      'extends StripeClientLibrary.HttpClient',
    );
    expect(addOnScenarioSource).toContain('Idempotency-Key');
    expect(addOnScenarioSource).toContain('?expand[0]=balance_transaction');
    expect(addOnScenarioSource).toContain(
      'throw new Error(`Unexpected Stripe request: ${method} ${path}`)',
    );
    expect(addOnScenarioSource).toContain('resolveScenarioEventWindow');
    expect(addOnScenarioSource).toContain('const wallClock = DateTime.utc()');
    expect(addOnScenarioSource).toContain('const latestNow =');
    expect(addOnScenarioSource).toContain('const earliestNow =');
    expect(addOnScenarioSource).not.toContain(
      '.insert(schema.eventRegistrationAddonPurchaseOrders)',
    );
    expect(addOnScenarioSource).not.toContain('.insert(schema.transactions)');
    expect(addOnScenarioSource).not.toContain('.update(schema.eventAddons)');
    expect(transferSource).not.toMatch(/^#\s+/mu);
    expect(transferSource).toContain('waitForRegistrationPage');
    expect(transferSource).toContain(
      'The current ticket owner creates the private transfer. The intended recipient must belong to the same organization',
    );
    expect(transferSource).toContain(
      '/docs/finish-a-paid-transfer-and-resolve-a-refund-problem',
    );
    expect(transferSource).toContain('/docs/transfer-your-ticket-privately');
    expect(transferSource).toContain(
      'Share the private transfer code with exactly one intended recipient.',
    );
    expect(freeTransferSource).toContain(
      "getByRole('link', { exact: true, name: 'Profile' })",
    );
    expect(freeTransferSource).toContain(
      "getByRole('link', { exact: true, name: 'Use transfer code' })",
    );
    expect(freeTransferSource).toContain("getByLabel('Transfer code')");
    expect(freeTransferSource).toContain(
      "getByRole('button', { name: 'Cancel private transfer' })",
    );
    expect(freeTransferSource).toContain(".toBe('cancelled')");
    expect(freeTransferSource).toContain(
      'Cancelling the transfer makes its code unusable; it does not cancel or move the ticket.',
    );
    expect(freeTransferSource).toContain("getByLabel('Transfer code')");
    expect(freeTransferSource).toContain(
      '0000-0000-0000-0000-0000-0000-0000-0000',
    );
    expect(freeTransferSource).toContain(
      "getByRole('button', { name: 'Enter another code' })",
    );
    expect(freeTransferSource).toContain(
      'If Evorto says the transfer could not be opened, select **Enter another code**',
    );
    expect(freeTransferSource).toContain(
      "name: 'Enter a private transfer code'",
    );
    expect(freeTransferSource).toContain(
      "getByLabel('What should the organizer know?')",
    );
    expect(freeTransferSource).toContain(
      'schema.eventRegistrationQuestionAnswers.answer',
    );
    expect(freeTransferSource).toContain(
      'The previous owner entered this answer.',
    );
    expect(freeTransferSource).toContain(
      'Previous answers do not transfer, so answer every currently required question before selecting **Accept ticket**.',
    );
    expect(transferSource).toContain(
      'have a current role that allows the sign-up choice',
    );
    expect(transferSource).toContain(
      'Everything on the ticket transfers together, including guests and add-ons.',
    );
    expect(transferSource).toContain(
      "The previous owner's answers and discounts do not transfer.",
    );
    expect(transferSource).toContain(
      'Guest and add-on quantities cannot be changed. Existing attendee and guest check-ins and the history of handed-out add-ons also move unchanged with the ticket.',
    );
    expect(transferSource).toContain(
      'The recipient pays the current price, using only their own current discounts.',
    );
    expect(transferSource).toContain(
      "After payment succeeds, everything on the ticket moves to the recipient and Evorto starts the previous owner's refund.",
    );
    expect(transferSource).toContain(
      'A free transfer completes immediately when no refund is needed.',
    );
    expect(transferSource).not.toContain(
      'a successful separately paid add-on currently blocks',
    );
    expect(transferSource).not.toContain(
      'Non-Stripe and multi-source paid tickets stay blocked',
    );
    expect(transferSource).toContain(
      'Starting payment does not move the ticket yet. The previous owner keeps it until payment succeeds.',
    );
    expect(transferSource).toContain(
      '**Transfer complete — refund in progress**',
    );
    expect(transferSource).toContain(
      '**Transfer complete — refund needs attention**',
    );
    expect(transferSource).toContain(
      'An Evorto administrator must review the failed refund',
    );
    expect(transferSource).toContain(
      'An Evorto administrator opens the affected organization, selects **Review finance**, and then opens **Refunds needing attention**.',
    );
    expect(transferSource).not.toContain('finance or platform administrator');
    expect(transferSource).toContain(
      'Evorto starts a full refund for the recipient.',
    );
    expect(transferSource).toContain(
      '**Transfer stopped — refund needs attention**',
    );
    expect(transferSource).toContain(
      'the recipient does not own the ticket and must not pay or try the transfer again',
    );
    expect(transferSource).toContain(
      "test('Finish a paid transfer and resolve a refund problem'",
    );
    expect(transferSource).toContain('seedPaidRegistrationTransferScenario');
    expect(transferSource).toContain('await scenario.completeCheckout()');
    expect(transferSource).toContain('await scenario.failSourceRefund()');
    expect(transferSource).not.toContain(
      'await scenario.requeueSourceRefund()',
    );
    expect(transferSource).toContain('storageState: gaStateFile');
    expect(transferSource).toContain(
      "getByRole('tab', { name: 'Refunds needing attention' })",
    );
    expect(transferSource).toContain('refundRecoveryForm.getByLabel(');
    expect(transferSource).toContain("'Reason for this action'");
    expect(transferSource).toContain("name: 'Try failed refund again'");
    expect(transferSource).toContain("name: 'Payment still required'");
    expect(transferSource).toContain(
      "name: 'Transfer complete — refund in progress'",
    );
    expect(transferSource).toContain(
      "name: 'Transfer complete — refund needs attention'",
    );
    expect(paidTransferSource).toContain(
      '**Payment still required** means the transfer is waiting for payment.',
    );
    expect(paidTransferSource).not.toContain(
      "'The recipient owns the ticket while the refund is on the way'",
    );
    expect(paidTransferSource).not.toContain(
      "'A completed transfer with a failed previous-owner refund'",
    );
    expect(paidTransferSource).not.toContain("'Refund will be tried again'");
    expect(transferSource).toContain(
      'expect(transferredRegistration).toMatchObject({',
    );
    expect(transferSource).toContain('id: sourceRegistrationId,');
    expect(transferSource).toContain('userId: recipient.id,');
    expect(freeTransferSource).not.toContain("status: 'CANCELLED'");
    expect(transferSource).toContain(
      'toEqual({ confirmedSpots: 1, reservedSpots: 0 })',
    );
    expect(transferSource).toContain("status: 'completed'");
    expect(transferSource).toContain(
      "eq(schema.emailOutbox.kind, 'registrationTransferred')",
    );
    expect(transferSource).toContain(').toHaveLength(2)');
    expect(paidTransferScenarioSource).toContain('isPaid: true');
    expect(paidTransferScenarioSource).toContain(
      'const recipientRegistrationId = sourceRegistrationId',
    );
    expect(
      paidTransferScenarioSource.match(/insert\(schema\.eventRegistrations\)/g),
    ).toHaveLength(1);
    expect(paidTransferScenarioSource).toContain('checkedInGuestCount: 1');
    expect(paidTransferScenarioSource).toContain('guestCount: 1');
    expect(paidTransferScenarioSource).toContain(
      'appliedDiscountedPrice: sourceDiscountedUnitPrice',
    );
    expect(paidTransferScenarioSource).toContain(
      "appliedDiscountType: 'esnCard'",
    );
    expect(paidTransferScenarioSource).toContain(
      'registrationTransferBundleAddonPurchases',
    );
    expect(paidTransferScenarioSource).toContain(
      'registrationTransferRefundPlanItems',
    );
    expect(paidTransferScenarioSource).toContain('registrationAcquisitions');
    expect(paidTransferScenarioSource).toContain(
      'registrationAcquisitionPayments',
    );
    expect(paidTransferScenarioSource).toContain(
      'registrationAcquisitionComponents',
    );
    expect(paidTransferScenarioSource).toContain(
      'registrationAcquisitionRefundAllocations',
    );
    expect(paidTransferScenarioSource).toContain(
      'registrationTransferRefundPlanAcquisitionLinks',
    );
    expect(paidTransferScenarioSource).not.toContain(
      'registrationTransferRecipientAddonPayments',
    );
    expect(paidTransferScenarioSource).toContain(
      'sourceTransactionIds: [sourceTransactionId, sourceAddonTransactionId]',
    );
    expect(paidTransferScenarioSource).not.toContain(
      'recipientRegistrationId: sourceRegistrationId',
    );
    expect(paidTransferScenarioSource).not.toContain('recipientSpotCount: 2');
    expect(paidTransferScenarioSource).toContain('sourceSpotCount: 2');
    expect(paidTransferScenarioSource).not.toContain(
      'reservedAdditionalSpots: 0',
    );
    expect(paidTransferScenarioSource).not.toContain(
      'sourcePaymentTransactionId',
    );
    expect(paidTransferScenarioSource).not.toContain('sourceRefundAmount');
    expect(paidTransferScenarioSource).not.toContain(
      'sourceRefundApplicationFee',
    );
    expect(paidTransferSource).toContain(
      'expect(transferredRegistration).toEqual({',
    );
    expect(paidTransferSource).toContain('...registrationBefore,');
    expect(paidTransferSource).toContain('appliedDiscountedPrice: null');
    expect(paidTransferSource).toContain('appliedDiscountType: null');
    expect(paidTransferSource).toContain('basePriceAtRegistration: 2100');
    expect(paidTransferSource).toContain('discountAmount: 0');
    expect(paidTransferSource).toContain('toEqual(purchasesBefore)');
    expect(paidTransferSource).toContain('toEqual(lotsBefore)');
    expect(paidTransferSource).toContain('toEqual(fulfillmentEventsBefore)');
    expect(paidTransferSource).toContain('toEqual(refundAllocationsBefore)');
    expect(paidTransferSource).toContain('toEqual(addonStockBefore)');
    expect(paidTransferSource).toContain('toEqual(optionCapacityBefore)');
    expect(paidTransferSource).toContain(
      "getByText('Attendee check-in', { exact: true })",
    );
    expect(paidTransferSource).toContain(
      "getByText('Guests checked in', { exact: true })",
    );
    expect(paidTransferSource).toContain(
      "getByText('Transfer workshop kit', { exact: true })",
    );
    expect(paidTransferSource).toContain(
      "getByText('Transfer checklist item', { exact: true })",
    );
    expect(paidTransferSource).toContain(
      String.raw`toContainText(/Handed out\s*1/)`,
    );
    expect(paidTransferSource).toContain(
      String.raw`toContainText(/Cancelled\s*1/)`,
    );
    expect(paidTransferSource).toContain('amount: 5500');
    expect(paidTransferSource).toContain(
      'expect(acquisitionsAfter).toHaveLength(2)',
    );
    expect(paidTransferSource).toContain("kind: 'claim_transfer'");
    expect(paidTransferSource).toContain(
      'previousAcquisitionId: scenario.sourceAcquisitionId',
    );
    expect(paidTransferSource).toContain(
      'toEqual(sourceAcquisitionPaymentsBefore)',
    );
    expect(paidTransferSource).toContain(
      'toEqual(sourceAcquisitionComponentsBefore)',
    );
    expect(paidTransferSource).toContain(
      'toEqual(sourceAcquisitionRefundAllocationsBefore)',
    );
    expect(paidTransferSource).toContain('baseAmount: 4200');
    expect(paidTransferSource).toContain('baseAmount: 1300');
    expect(paidTransferSource).toContain(
      'registrationTransferRefundPlanAcquisitionLinks',
    );
    expect(paidTransferSource).toContain(
      'sourceAcquisitionPaymentId: sourcePayment.id',
    );
    expect(paidTransferSource).toContain(
      'stripeAccountId: scenario.sourceStripeAccountId',
    );
    expect(paidTransferSource).not.toContain(
      'registrationTransferRecipientAddonPayments',
    );
    expect(paidTransferSource).toContain(
      'database.query.registrationTransferRefundPlanItems.findMany',
    );
    expect(paidTransferSource).toContain('originalAmount: 3300');
    expect(paidTransferSource).toContain('refundAmountDue: 3300');
    expect(paidTransferSource).toContain('originalAmount: 1000');
    expect(paidTransferSource).toContain('priorRefundedAmount: 500');
    expect(paidTransferSource).toContain('refundAmountDue: 500');
    expect(paidTransferSource).toContain(
      "expect(transferEventTypes).toContain('ownership_transferred')",
    );
    expect(paidTransferSource).not.toContain("status: 'CANCELLED'");
    expect(paidTransferScenarioSource).toContain('futureServerEventWindow()');
    expect(paidTransferScenarioSource).toContain('latestServerOrWallNow()');
    expect(paidTransferScenarioSource).toContain(
      'completePaidRegistrationCheckout(',
    );
    expect(paidTransferScenarioSource).toContain(
      'Stripe.webhooks.constructEvent(',
    );
    expect(paidTransferScenarioSource).toContain(
      'Layer.succeed(StripeClient, deterministicStripe)',
    );
    expect(paidTransferScenarioSource).not.toContain(
      'as Stripe.Checkout.Session',
    );
    expect(paidTransferScenarioSource).toContain(
      'reconcileRegistrationTransferRefund(tx',
    );
    expect(paidTransferScenarioSource).toContain(
      'requeueRegistrationRefundClaim(tx',
    );
    expect(paidTransferScenarioSource).toContain(
      'markRegistrationTransferRefundRequeued(tx',
    );
    expect(registrationPageSource).toContain(
      "const eventDetailsSelector = 'app-event-list router-outlet + ng-component'",
    );
    expect(registrationPageSource).toContain(':not([aria-busy="true"])');
    expect(registrationPageSource).toContain(
      ".getByText('Loading event…', { exact: true })",
    );
    expect(registrationPageSource).toContain(
      ".getByText('Failed to load event.', { exact: true })",
    );
    expect(registrationPageSource).toContain('level: 2');
    expect(registrationPageSource).toContain("name: 'Your sign-up'");
    expect(registrationPageSource).toContain(
      ".getByText('Loading your sign-up')",
    );
    expect(registrationPageSource).toContain(
      ".getByText('Failed to load registration status.')",
    );
    expect(registrationPageSource.indexOf("name: 'Your sign-up'")).toBeLessThan(
      registrationPageSource.indexOf(".getByText('Loading your sign-up')"),
    );
    expect(
      registrationPageSource.indexOf(':not([aria-busy="true"])'),
    ).toBeLessThan(
      registrationPageSource.indexOf(
        ".getByText('Loading event…', { exact: true })",
      ),
    );
    expect(
      registrationPageSource.indexOf(
        ".getByText('Failed to load event.', { exact: true })",
      ),
    ).toBeLessThan(registrationPageSource.indexOf("name: 'Your sign-up'"));
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).toContain(
      'Evorto also tries to send a confirmation email with a link back to the ticket.',
    );
    expect(source).toContain('seedRequiredRegistrationQuestion');
    expect(source).toContain(
      'A free sign-up choice can also offer guests, add-ons, and required questions.',
    );
    expect(source).toContain('organizers can review the answers.');
    expect(source).toContain(
      'participantRegistrationCard.getByLabel(registrationQuestion.title)',
    );
    expect(source).toContain('registration.questionAnswers');
    expect(source).toContain(
      'If that choice asks required sign-up questions, attendees must answer them before joining.',
    );
    expect(source).toContain('waitlistRegistration.questionAnswers');
    expect(source).toContain(
      'When the **Leave the waitlist?** confirmation opens, pressing Enter chooses **Stay on waitlist**, so your place stays unchanged.',
    );
    expect(source).toContain('Review before leaving the waitlist');
    expect(source).toContain('fullOptionAfterLeaving.waitlistSpots');
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain('ticket QR code by email');
  });

  it('publishes both event-discovery models in the relevant guides', () => {
    const announcementSource = readSource(
      'tests/docs/events/announcement-discovery.doc.ts',
    );
    const eventDiscoverySource = readSource(
      'tests/docs/events/event-discovery.doc.ts',
    );
    const findAnEventGuide = documentationConsumerGuideCatalog.find(
      ({ id }) => id === 'evorto:find-an-event',
    );
    const reviewAndPublishGuide = documentationConsumerGuideCatalog.find(
      ({ id }) => id === 'evorto:review-and-publish-an-event',
    );

    expect(findAnEventGuide?.sourceSlugs).toEqual(
      expect.arrayContaining([
        'find-an-event-you-can-join',
        'choose-who-can-find-an-announcement',
      ]),
    );
    expect(reviewAndPublishGuide?.sourceSlugs).toContain(
      'choose-who-can-find-an-announcement',
    );
    expect(announcementSource).toContain(
      "does not change anyone's role or access, or send them a message",
    );
    expect(announcementSource).not.toContain('give members new permissions');
    expect(eventDiscoverySource).toContain(
      '**Place confirmed**, **Waiting for approval**, **Finish payment**, and **On waitlist**',
    );
    expect(eventDiscoverySource).toContain(
      "registeredCard.getByText('On waitlist', { exact: true })",
    );
    expect(eventDiscoverySource).toContain(
      'roles selected on the announcement',
    );
    expect(eventDiscoverySource).not.toContain('selected by an organizer');
  });

  it('keeps manual approval docs beginner-readable and behavior-backed', () => {
    const source = readSource('tests/docs/events/manual-approval.doc.ts');

    expect(source).not.toMatch(/^#\s+/mu);
    expect(source).toContain(
      'An attendee whose organization role allows the event choice applies for a place.',
    );
    expect(source).toContain(
      'An application does not reserve a place, charge the attendee, or create a ticket.',
    );
    expect(source).toContain('Apply for approval');
    expect(source).toContain('Awaiting approval');
    expect(source).toContain('Approve application');
    expect(source).toContain(
      'Open the event again after the organizer finishes to see the confirmed ticket and its QR code.',
    );
    expect(source).toContain(
      "Selecting **Approve application** reserves one place and prepares the attendee's payment link.",
    );
    expect(source).toContain(
      "The approval email that Evorto tries to send shows the payment deadline in the organization's local time and names the organization clearly.",
    );
    expect(source).toContain('`(local time for ${scenario.tenant.name})`');
    expect(source).toContain('deliverCompletedRegistrationCheckoutWebhook({');
    expect(source).not.toContain('fillTestCard');
    expect(source).toContain(".toBe('successful:CONFIRMED')");
    expect(source).toContain('approvalEmailsForRegistration');
    expect(source).toContain('Payment needs attention');
    expect(source).toContain('Try payment again');
    expect(source).toContain(
      'Select **Try again** once on the existing sign-up.',
    );
    expect(source).toContain(
      'contact the event organizer, who can ask Evorto support to review the reserved place',
    );
    expect(source).toContain(
      'ask Evorto support to review the existing sign-up',
    );
    expect(source).not.toContain('refresh shortly');
    expect(source).not.toContain('focused by default');
    expect(source).toContain("transactionStatus: 'cancelled'");
    expect(source).toContain(
      "test('Withdraw a pending application and apply again'",
    );
    expect(source).toContain(
      'The confirmation explains exactly what changes: the pending application is withdrawn immediately, it does not affect any confirmed places, and no refund starts.',
    );
    expect(source).toContain("status: 'CANCELLED'");
    expect(source).toContain('capacityBeforeApplying');
    expect(source).toContain(
      "throw new Error('Expected a new pending application after withdrawal')",
    );
    expect(source).toContain('Application status');
    expect(source).not.toContain(
      'A separate **Reject application** action is not currently available',
    );
    expect(source).toContain(
      'Application and approval belong to this organization.',
    );
    expect(source).not.toContain('an application reserves a spot immediately');
    expect(source).not.toContain(
      'payment approval immediately creates a ticket',
    );
  });

  it('keeps organizer and helper signup docs role-aware and behavior-backed', () => {
    const source = readSource('tests/docs/events/organizer-signup.doc.ts');
    const scenarioSource = readSource(
      'tests/support/utils/organizer-signup-scenario.ts',
    );

    expect(source).not.toMatch(/^#\s+/mu);
    expect(source).toContain(
      'Organizer/helper sign-ups never include guests or a waitlist.',
    );
    expect(source).toContain(
      'Evorto allows one active ticket per person and event',
    );
    expect(source).toContain('Your organizer/helper place is confirmed');
    expect(source).toContain('Your organizer/helper pass');
    expect(source).toContain('Organizer/helper team');
    expect(source).toContain('Attendee sign-ups');
    expect(source).toContain('Type** as **Organizer/helper');
    expect(source).toContain('A saved or copied organizer link');
    expect(source).toContain(
      'This does not remove access provided in other ways',
    );
    expect(source).not.toContain('Other permissions');
    expect(source).toContain(
      'page.goto(`/events/${scenario.event.id}/organize`)',
    );
    expect(source).toContain(String.raw`page).toHaveURL(/\/403$/)`);
    expect(source).toContain("test('Apply to help organize an event'");
    expect(source).toContain(
      'Your organizer/helper application is waiting for approval',
    );
    expect(source).toContain('Approve application');
    expect(source).toContain(
      'A paid category remains pending until payment succeeds',
    );
    expect(source).toContain('## Withdraw before approval');
    expect(source).toContain('## Apply again');
    expect(source).toContain(
      'pressing Enter chooses **Go back** and leaves the application unchanged',
    );
    expect(source).not.toContain('receives focus');
    expect(source).not.toContain('remain eligible');
    expect(source).not.toContain('the eligible sign-up choices');
    expect(source).not.toContain('role must still be eligible');
    expect(source).toContain("status: 'CANCELLED'");
    expect(source).toContain('paymentCount: 0');
    expect(source).toContain(
      'Pending application withdrawal leaves organizer access unavailable',
    );
    expect(source).not.toContain(
      'without demonstrating withdrawal of the pending application',
    );
    expect(source).not.toContain(
      'Paid organizer/helper categories are outside this guide.',
    );
    expect(source).toContain('seedOrganizerSignupScenario');
    expect(source).toContain('takeScreenshot');
    expect(scenarioSource).toContain("mode: 'advanced' | 'simple'");
    expect(scenarioSource).toContain("simpleModeEnabled: mode === 'simple'");
    expect(scenarioSource).toContain("registrationMode: 'application'");
    expect(scenarioSource).toContain('organizingRegistration: true');
    expect(scenarioSource).toContain('cancellationDeadlineHoursBeforeStart: 0');
    expect(source).not.toContain('organizer access starts on application');
  });

  it('keeps event approval docs backed by deterministic lifecycle persistence checks', () => {
    const source = readSource('tests/docs/events/event-approval.doc.ts');

    expect(source).toContain("const eventTitle = 'Community garden workshop'");
    expect(source).toContain('Expected generated approval docs event to exist');
    expect(source).toContain(
      "expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW')",
    );
    expect(source).toContain("expect(returnedEvent.status).toBe('DRAFT')");
    expect(source).toContain(
      'expect(returnedEvent.statusComment).toBe(reviewFeedback)',
    );
    expect(source).toContain('expect(returnedEvent.reviewedAt).not.toBeNull()');
    expect(source).toContain('Return-to-draft feedback on event details');
    expect(source).not.toContain("status).toBe('REJECTED')");
    expect(source).toContain("expect(approvedEvent.status).toBe('APPROVED')");
    expect(source).toContain(
      'const clickHydratedAction = async (action: Locator)',
    );
    expect(source).toContain("not.toHaveAttribute('jsaction', /click/, {");
    expect(source.match(/await clickHydratedAction\(/g)).toHaveLength(10);
    expect(source).toContain('name: /^Event reviews(?: \\d+)?$/u');
    expect(source).toContain("name: 'Return to draft'");
    expect(source).not.toContain("name: 'Reject'");
    expect(source).toContain("name: 'Check pending reviews again'");
    expect(source).toContain('test.setTimeout(300_000)');
    expect(source).toContain(
      'Pending-review and published events cannot be edited.',
    );
    expect(source).toContain(
      "page.getByRole('link', { exact: true, name: 'Edit Event' })",
    );
    expect(source).toContain('await page.goto(`/events/${eventId}/edit`)');
    expect(source).toContain('\\?error=event-locked$');
    expect(source).toContain('Published events cannot be edited.');
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).not.toContain(
      'Approval Flow ${seedDate.toISOString().slice(0, 10)}',
    );
  });

  it('keeps event-management docs aligned with scanner and organizer scope', () => {
    const source = readSource('tests/docs/events/event-management.doc.ts');

    expect(source).toContain(
      'Each draft event has its own sign-up setup, independent of the template.',
    );
    expect(source).toContain(
      'Before returning an advanced event to simple setup, save it with exactly one choice of each kind',
    );
    expect(source).toContain("page.getByTestId('event-mode-simple')");
    expect(source).toContain("page.getByTestId('event-mode-advanced')");
    expect(source).toContain(
      'event.id === seeded.scenario.events.draft.eventId',
    );

    expect(source).toContain(
      'Organizers check in attendees with the QR scanner.',
    );
    expect(source).toContain(
      'The result shows the attendee, event, sign-up choice, ESNcard discount when applicable, guest progress, and clear warnings when a ticket cannot be checked in.',
    );
    expect(source).toContain(
      'Confirming check-in updates the count shown on the organizer overview.',
    );
    expect(source).toContain(
      'When a ticket includes guests, the organizer chooses how many arrived with the attendee, and the count increases by the attendee plus those guests.',
    );
    expect(source).toContain(
      'page.goto(`/scan/registration/${scannerRegistrationId}`)',
    );
    expect(source).toContain("page.getByText('Includes 2 guests.')");
    expect(source).toContain(
      "import { fillScannerGuestCheckInCount } from '../../support/utils/scanner-result-page';",
    );
    expect(source).toContain(
      `const confirmScannerCheckIn = await fillScannerGuestCheckInCount(page, {
      guestCount: 2,
      includeAttendee: true,
    });`,
    );
    expect(source).toContain('await confirmScannerCheckIn.click()');
    expect(source).toContain('Scanned ticket with guest check-in');
    expect(source).toContain("page.getByText('Check-in complete')");
    expect(source).toContain('checkedInGuestCount: true');
    expect(source).toContain('checkedInSpots: initialCheckedInSpots + 3');
    expect(source).toContain('.update(eventRegistrationOptions)');
    expect(source).toContain('.set({ checkedInSpots: initialCheckedInSpots })');
    expect(source).toContain(
      "Organizers can also cancel an attendee's confirmed ticket from the organizer overview before check-in. This releases the place and starts any refund shown in the confirmation.",
    );
    expect(source).toContain(
      'Organizers can move the ticket directly only when the whole ticket is free, no refund is needed, and there are no attendee questions.',
    );
    expect(source).toContain(
      'Attendee transfers always use a private offer from the current owner to one intended recipient.',
    );
    expect(source).toContain(
      'Sign-up events have no separate choice for who can find them.',
    );
    expect(source).not.toContain('visibility setting');
    expect(source).not.toContain('eligibility changes');
    expect(source).toContain(
      'Guest and add-on quantities cannot be changed. Existing attendee and guest check-ins and the history of handed-out add-ons move unchanged with the ticket.',
    );
    expect(source).toContain(
      "When payment is required, the recipient pays before the ticket moves and Evorto then starts the previous owner's refund.",
    );
    expect(source).not.toContain('pending manual refund record');
    expect(source).not.toContain(
      'separately paid add-on or a non-Stripe registration payment currently blocks',
    );
    expect(source).toContain(
      'It does not currently include downloading attendee lists, sending messages to attendees, or checking people in without scanning a QR code',
    );
    expect(source).toContain('Already selected roles are not offered again.');
    expect(source).toContain(
      'If attendees cannot be loaded, Evorto hides every sign-up count and attendee action.',
    );
    expect(source).toContain(
      "This choice does not change anyone's role or access, or send a message.",
    );
    expect(source).not.toContain('give new permissions');
    expect(source).toContain(
      'Receipt history has its own warning and **Try again** action.',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have selected registration roles',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have an unselected role for autocomplete',
    );
    expect(source).toContain(
      "registrationOptionEditor.getByPlaceholder('Add role…')",
    );
    expect(source).toContain('Choose which roles can use a sign-up choice');
    expect(source).toContain('## Edit an existing draft event');
    expect(source).toContain('await database.insert(eventInstances).values({');
    expect(source).toContain("status: 'DRAFT'");
    expect(source).toContain('await editableTitle.fill(savedEditableTitle)');
    expect(source).toContain(
      'await descriptionContent.fill(savedEditableDescription)',
    );
    expect(source).toContain("name: 'Change sign-up setup?'");
    expect(source).toContain("name: 'Keep current setup'");
    expect(source).toContain("name: 'Use advanced setup'");
    expect(source).toContain(
      "getByLabel('Number of places')\n      .fill(savedParticipantSpots.toString())",
    );
    expect(source).toContain("name: 'Manual approval'");
    expect(source).toContain('persistedEvent?.simpleModeEnabled).toBe(false)');
    expect(source).toContain(
      "persistedParticipantOption?.registrationMode).toBe('application')",
    );
    expect(source).toContain('Saved draft event with updated details');
    expect(source).toContain('.where(eq(eventInstances.id, editableEventId))');
    expect(source).not.toContain('manual check-in from the organizer overview');
    expect(source).not.toContain('automatic refund controls are available');
    expect(source).not.toContain('paid registration transfer is available');
  });

  it('keeps dedicated check-in docs beginner-readable and behavior-backed', () => {
    const source = readSource('tests/docs/scanning/check-in.doc.ts');

    expect(source).not.toMatch(/^#\s+/mu);
    expect(source).toContain('Who can do this');
    expect(source).toContain(
      "page.getByRole('link', { exact: true, name: 'Scanner' })",
    );
    expect(source).toContain("installMockCamera(page, 'allowed')");
    expect(source).toContain('camera=(self)');
    expect(source).toContain('If the camera does not start');
    expect(source).toContain('**Not an Evorto ticket**');
    expect(source).toContain("getByRole('link', { name: 'Back to scanner' })");
    expect(source).toContain('Verify the ticket');
    expect(source).toContain(
      'Check-in opens one hour before the event starts and closes two hours after it ends.',
    );
    expect(source).toContain('**Organize all events** access');
    expect(source).not.toContain('**Organize all events** permission');
    expect(source).toContain('**Check-in closed**');
    expect(source).toContain("hasText: 'Check-in closed'");
    expect(source).toContain('Check in guests who arrive later');
    expect(source).toContain("page.getByText('Already checked in')");
    expect(source).toContain('checkedInSpots: optionBefore.checkedInSpots + 2');
    expect(source).toContain('optionBefore.checkedInSpots + 3');
    expect(source).toContain('.delete(eventRegistrations)');
    expect(source).toContain('checkedInSpots: optionBefore.checkedInSpots,');
    expect(source).toContain('confirmedSpots: optionBefore.confirmedSpots,');
    expect(source).not.toContain('a QR code is enough to check in');
  });

  it('keeps role docs aligned with generated permission reference semantics', () => {
    const rolesSource = readSource('tests/docs/roles/roles.doc.ts');
    const roleScenarioSource = readSource(
      'tests/support/utils/user-role-assignment-scenario.ts',
    );
    const permissionsSource = readSource(
      'tests/docs/roles/about-permissions.doc.ts',
    );

    expect(rolesSource).toContain(
      'Learn more at [about permissions](/docs/about-permissions).',
    );
    expect(rolesSource).toContain(
      'When one permission needs another, Evorto includes it automatically and explains why it cannot be removed separately.',
    );
    expect(rolesSource).toContain(
      "const roleName = 'Event communications lead'",
    );
    expect(rolesSource).toContain(
      "throw new Error('Expected generated roles doc to persist the role')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('events:create')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('templates:view')",
    );
    expect(rolesSource).toContain('updatedRoleDescription');
    expect(rolesSource).toContain(
      'editRoleFormCheckbox(/^Show this role in the hub$/).setChecked(true)',
    );
    expect(rolesSource).toContain(
      'editRoleFormCheckbox(/^Members Hub$/).setChecked(true)',
    );
    expect(rolesSource).toContain(
      "updatedRole?.permissions).toContain('internal:viewInternalPages')",
    );
    expect(rolesSource).toContain('await page.reload()');
    expect(rolesSource).toContain('openAuthenticatedTestPage({');
    expect(rolesSource).toContain('storageState: userStateFile');
    expect(rolesSource).toContain("exact: true,\n        name: 'Members Hub'");
    expect(rolesSource).toContain('tenantScopeDecoy.memberDisplayName');
    expect(rolesSource).toContain(').toHaveCount(0)');
    expect(rolesSource).not.toContain('members are collapsed by default');
    expect(roleScenarioSource).toContain('seedMembersHubTenantScopeDecoy');
    expect(roleScenarioSource).toContain(
      "description: 'This same-named role belongs to another organization'",
    );
    expect(roleScenarioSource).toContain('name: roleName');
    expect(roleScenarioSource).toContain('displayInHub: true');
    expect(rolesSource).toContain('.delete(schema.roles)');
    expect(permissionsSource).toContain(
      'Permissions belong to an organization and are assigned through roles.',
    );
    expect(permissionsSource).toContain(
      'Some permissions automatically provide the other permissions needed to open and use the same area.',
    );
    expect(permissionsSource).toContain(
      'Those additions appear below as **You also receive**, using the same names shown in the role editor.',
    );
    expect(permissionsSource).toContain(
      'Evorto administrator access is separate from organization roles',
    );
    expect(permissionsSource).toContain('PERMISSION_GROUPS');
    expect(permissionsSource).toContain('PERMISSION_DEPENDENCIES');
    expect(permissionsSource).toContain(
      '`- What it allows: ${permission.description}`',
    );
    expect(permissionsSource).not.toContain('Global admin access is a role');
    expect(permissionsSource).not.toContain('tenant roles grant global admin');
  });

  it('keeps ESN discount docs aligned with provider-error and write-guard behavior', () => {
    const source = readSource('tests/docs/profile/discounts.doc.ts');

    expect(source).toContain('esnCardStatusLabel');
    expect(source).toContain('esnCardActionLabel');
    expect(source).toContain('esnCardActionDisabled');
    expect(source).toContain('esnCardSaveDisabled');
    expect(source).toContain('esnCardSubmitPayloadFromIdentifier');
    expect(source).toContain('esnCardMutationErrorMessage');
    expect(source).toContain(
      'You can save one ESNcard for your account in each organization that enables ESNcard discounts.',
    );
    expect(source).toContain(
      'Save, check again, and remove remain unavailable until the current check or change finishes.',
    );
    expect(source).toContain(
      "If Evorto cannot check a new card, it shows **We couldn't check this ESNcard, so it was not saved.",
    );
    expect(source).toContain('it keeps the saved card unchanged');
    expect(source).toContain("page.goto('/profile/discounts')");
    expect(source).toContain(
      'const clickHydratedAction = async (action: Locator)',
    );
    expect(source).toContain("not.toHaveAttribute('jsaction', /click/, {");
    expect(source.match(/await clickHydratedAction\(/g)).toHaveLength(8);
    expect(source).toContain("name: 'Discount cards'");
    expect(source).not.toContain("name: 'Discount Cards'");
    expect(source).toContain('unchangedSeededEsnCard');
    expect(source).toContain(
      "page.getByRole('button', { name: 'Save ESNcard' })",
    );
    expect(source).toContain('ESNcard validation provider is unavailable');
    expect(source).not.toContain('provider outages mark the card invalid');
    expect(source).not.toContain('overlap ESNcard writes');
    expect(source).not.toContain('stores the card number without trimming');
  });
});
