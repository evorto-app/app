import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source guard: generated documentation is product-facing, so these checks keep
// the docs tied to implemented flows instead of stale aspirational copy.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

describe('generated docs source current behavior', () => {
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
      "test('Cancel a confirmed free registration and release its capacity'",
    );
    const scenarioEnd = source.indexOf(
      "test('Cancel a Stripe-backed registration with settled add-ons and recover its refund'",
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
      "test('Cancel a Stripe-backed registration with settled add-ons and recover its refund'";
    const journeyStart = source.indexOf(journeyTitle);
    const nextJourneyStart = source.indexOf(
      "test('Understand a participant cancellation deadline block'",
      journeyStart,
    );

    expect(journeyStart).toBeGreaterThanOrEqual(0);
    expect(nextJourneyStart).toBeGreaterThan(journeyStart);
    const journey = source.slice(journeyStart, nextJourneyStart);

    expect(journey).toContain('paidIncludedQuantity: 1');
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

    expect(journey).toContain("name: 'Cancel registration'");
    expect(journey).toContain("name: 'Confirm cancellation'");
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
      'Do not ask the attendee to pay or register again',
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refund processing', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Provider action required', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refund needs attention', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toMatch(
      /await expect\(\s*scannerAddOn\.getByText\('Refunded', \{ exact: true \}\),\s*\)\.toBeVisible\(\)/u,
    );
    expect(journey).toContain('openProfileEventCard(page, scenario.title)');
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Refund retrying\//u,
    );
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Provider action required\//u,
    );
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Refund needs attention\//u,
    );
    expect(journey).toMatch(
      /await expect\(profileCard\)\.toContainText\(\s*\/Add-on payment:\\s\*Refund completed\//u,
    );

    expect(journey).toContain('storageState: gaStateFile');
    expect(journey).toContain("name: 'Review finance'");
    expect(journey).toContain('const providerActionTransactionRow');
    expect(journey).toContain("hasText: 'Provider action required'");
    expect(journey).toContain("name: 'Refund recovery'");
    expect(journey).toContain("name: 'Review recovery'");
    expect(journey).toContain("name: 'Resume stopped refund'");
    expect(journey).toContain("name: 'Retry terminal refund'");
    expect(journey).toContain('stripeRefundAttempts: true');
    expect(journey).toContain('stripeRefundMaxAttempts: true');
    expect(journey).toContain(
      '`attempts ${terminalRefundClaim.stripeRefundAttempts}/${terminalRefundClaim.stripeRefundMaxAttempts}`',
    );
    expect(journey).toContain(
      '`generation ${terminalRefundClaim.stripeRefundGeneration}`',
    );
    expect(journey).toContain('getByText(refundClaim.id, { exact: true })');
    expect(journey).toContain(
      'getByText(scenario.registrationId, { exact: true })',
    );
    expect(journey).toContain("getByLabel('Operational recovery reason')");
    expect(journey).toContain("name: 'Schedule new refund generation'");
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
    expect(journey).toContain('Money has not necessarily been returned yet');
    expect(journey).toContain(
      'It does not certify live bank or card-network settlement',
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
      'registerDatabaseCleanup(async () => {',
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
      "test('Cancel a confirmed free registration and release its capacity'",
    );
    expect(freeJourneyStart).toBeGreaterThanOrEqual(0);
    const freeJourney = source.slice(freeJourneyStart, journeyStart);
    expect(freeJourney).toContain('expect(refunds).toEqual([])');
    expect(freeJourney).not.toContain("method: 'cash'");
    expect(freeJourney).not.toContain('Manual refund pending');
    expect(source).not.toContain("method: 'cash'");
    expect(source).not.toContain('A supported non-Stripe source');
  });

  it('keeps tenant general-settings docs aligned with implemented branding and legal routes', () => {
    const source = readSource('tests/docs/admin/general-settings.doc.ts');

    expect(source).not.toContain(
      'domain onboarding, brand asset upload, legal text page',
    );
    expect(source).toContain(
      'A read-only **Tenant identity** summary with tenant name, primary domain, and Stripe connection state.',
    );
    expect(source).not.toContain('canonicalRootUrl');
    expect(source).not.toContain('Canonical root URL');
    expect(source).toContain(
      'A **Currency** select with EUR, CZK, and AUD plus a **Timezone** text field that accepts an IANA timezone such as Europe/Berlin.',
    );
    expect(source).toContain(
      '**Formatting locale** is read-only and fixed to **de-DE**',
    );
    expect(source).toContain(
      "generalSettings.getByRole('combobox', { name: 'Locale' })",
    );
    expect(source).toContain(
      "generalSettings.getByRole('textbox', { name: 'Timezone' })",
    );
    expect(source).toContain(
      '**SEO title** and **SEO description** for tenant-level page metadata.',
    );
    expect(source).toContain(
      'A **Deferred settings** summary that keeps custom-domain automation visible as a deferred scope item.',
    );
    expect(source).toContain(
      '**Operations settings** for tenant email reply-to name/email, Stripe account id, the tenant-wide active registration limit, default registration transfer/cancellation deadlines, and cancellation fee-refund behavior.',
    );
    expect(source).toContain('documentedEmailSenderName');
    expect(source).toContain('documentedEmailSenderEmail');
    expect(source).toContain('documentedStripeAccountId');
    expect(source).toContain('documentedRegistrationLimit');
    expect(source).toContain('documentedTransferDeadlineHours');
    expect(source).toContain('documentedCancellationDeadlineHours');
    expect(source).toContain('documentedRefundFeesOnCancellation');
    expect(source).toContain("page.getByPlaceholder('Example Section')");
    expect(source).toContain("page.getByPlaceholder('acct_...')");
    expect(source).toContain('await page.reload()');
    expect(source).toContain('Expected generated general-settings docs tenant');
    expect(source).toContain("from '../../support/fixtures/parallel-test'");
    expect(source).not.toContain('} finally {');
    expect(source).not.toContain('.update(schema.tenants)');
    expect(source).toContain(
      'The generated journey below updates the editable operations values and uploaded brand assets on its disposable tenant while preserving the connected Stripe account. It saves the form, checks the stored tenant row, reloads the page, and checks that the same values are read back.',
    );
    expect(source).toContain("getByLabel('Upload tenant logo file')");
    expect(source).toContain("getByLabel('Upload tenant favicon file')");
    expect(source).toContain('documentedLogoUrl');
    expect(source).toContain('documentedFaviconUrl');
    expect(source).toContain(
      'uploaded paths from a different tenant are rejected',
    );
    expect(source).toContain('Transfer deadline before event (hours)');
    expect(source).toContain('Cancellation deadline before event (hours)');
    expect(source).toContain('Refund fees on cancellation');
    expect(source).toContain(
      'The public footer gives a saved external URL precedence and opens it off-site.',
    );
    expect(source).toContain(
      'For privacy, Evorto stores the text and URL together as one policy version that a member accepts once.',
    );
    expect(source).not.toContain('Do not fill both alternatives');
    expect(source).toContain(
      "test('Publish hosted legal pages and verify the signed-out footer @admin'",
    );
    expect(source).toContain(
      "getByRole('textbox', { name: 'Hosted privacy policy text' })",
    );
    expect(source).toContain('storageState: { cookies: [], origins: [] }');
    expect(source).toContain("name: 'Privacy policy'");
    expect(source).toContain('privacyPolicyUrl: null');
    expect(source).toContain(
      '**Allowed receipt countries** and **Allow other** for receipt submission.',
    );
    expect(source).toContain(
      '**ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.',
    );
    expect(source).toContain(
      'Tax rates are managed on the separate **Tax Rates** page.',
    );
    expect(source).toContain(
      'Currency and timezone changes are only accepted before event or payment data exists for the tenant.',
    );
    expect(source).toContain(
      'When one of those accepted changes is saved, Evorto reloads the app',
    );
    expect(source).not.toContain('Tax rates are configured here');
    expect(source).not.toContain('Stripe account management gaps');
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
    expect(source).toContain(
      'Your account and registrations have not been changed',
    );
    expect(source).toContain('do not create a replacement registration');
    expect(responseSource).toContain('status: 404');
    expect(responseSource).toContain("'Cache-Control': 'no-store'");
    expect(responseSource).toContain("'X-Robots-Tag': 'noindex, nofollow'");
  });

  it('keeps global-admin docs aligned with the relaunch tenant-administration scope', () => {
    const source = readSource('tests/docs/admin/global-admin.doc.ts');

    expect(source).toContain('expectGlobalAdminTenantRows');
    expect(source).toContain('expectGlobalAdminTenantFormSurface');
    expect(source).toContain('Search tenants');
    expect(source).toContain('No tenants match this search');
    expect(source).toContain('Read-only operational tenant review');
    expect(source).toContain('Open tenant');
    expect(source).not.toContain('canonicalRootUrl');
    expect(source).not.toContain('Canonical root URL');
    expect(source).toContain('Stripe account');
    expect(source).toContain('Expected generated global-admin docs tenant');
    expect(source).toContain(
      'Expected global-admin docs create flow to persist tenant',
    );
    expect(source).toContain('createdTenantDomain');
    expect(source).toContain('.delete(schema.tenants)');
    expect(source).toContain("where: { domain: 'localhost' }");
    expect(source).toContain('documentedTenant.stripeAccountId');
    expect(source).toContain('await fillTenantSearch(page, primaryDomain)');
    expect(source).toContain(
      'expect(tenantNameInput(page)).toHaveValue(createdTenant.name)',
    );
    expect(source).toContain(
      'expect(tenantPrimaryDomainInput(page)).toHaveValue(',
    );
    expect(source).toContain(
      'Tenant create/edit manages the one active primary domain, name, theme, currency, timezone, and connected Stripe account id.',
    );
    expect(source).toContain(
      'the server blocks removing a connected account while any paid template/event option or add-on still exists',
    );
    expect(source).toContain(
      'The formatting locale remains fixed to **de-DE**.',
    );
    expect(source).toContain(
      'Transactional links and Stripe return URLs use the secure HTTPS origin derived from this normalized domain rather than request headers.',
    );
    expect(source).toContain(
      'The generated journey creates a temporary tenant, reads the created row back from the database, saves a tenant-name edit on that temporary tenant, verifies the saved row, and cleans it up after the doc run.',
    );
    expect(source).toContain(
      'Each allowed platform mutation requires an operator reason.',
    );
    expect(source).toContain(
      'A public-URL migration is rejected while pending Stripe Checkouts or refunds, or active registration transfers, still depend on issued links.',
    );
    expect(source).toContain(
      'operators must keep HTTPS redirects from the old domain to the new domain for already-issued QR codes',
    );
    expect(source).toContain(
      "getByRole('link', { name: 'Platform audit log' })",
    );
    expect(source).toContain("page.locator('app-platform-audit')");
    expect(source).toContain('.delete(schema.platformAuditEntries)');
    expect(source).toContain('.delete(schema.tenantPrivacyPolicyVersions)');
    expect(source).toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(source).toContain(
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    );
    expect(source).not.toContain('impersonation workflow');
    expect(source).not.toContain('multiple active domains');
  });

  it('keeps global Email Outbox docs aligned with visibility, recovery, and permission behavior', () => {
    const source = readSource('tests/docs/admin/email-outbox.doc.ts');

    expect(source).toContain('seedEmailOutboxScenario');
    expect(source).toContain("page.goto('/global-admin')");
    expect(source).toContain("getByRole('link', { name: 'Email outbox' })");
    expect(source).toContain('Rows needing delivery');
    expect(source).toContain('Temporary provider timeout');
    expect(source).toContain('Recipient address was rejected');
    expect(source).toContain('scenario.sent.subject');
    expect(source).toContain('await scenario.cleanup()');
    expect(source).toContain(
      'It shows the 100 most recently updated **queued**, **sending**, and **failed** rows.',
    );
    expect(source).toContain(
      'It omits successfully **sent** rows even though the Sent total still includes them.',
    );
    expect(source).toContain(
      'Evorto can reclaim the row after that claim lease expires',
    );
    expect(source).toContain('automatic retries have stopped');
    expect(source).toContain(
      'There is currently no tenant/status search control and no manual retry button on this page.',
    );
    expect(source).toContain(
      'platform administrator whose authority comes from verified Auth0 app metadata',
    );
    expect(source).toContain(
      'without platform administrator authority is redirected to the forbidden page',
    );
    expect(source).toContain(
      "Tenant roles, including a tenant's ordinary Admin role, do not grant access",
    );
    expect(source).not.toContain('tenant admins can review all email');
    expect(source).not.toContain('Refresh retries the email');
  });

  it('keeps profile docs aligned with implemented account and event-card behavior', () => {
    const source = readSource('tests/docs/profile/user-profile.doc.ts');

    expect(source).toContain(
      'Login email address and notification email address',
    );
    expect(source).toContain(
      'IBAN and PayPal details are optional global reimbursement details, not tenant-specific payout instructions.',
    );
    expect(source).toContain(
      'The notification email is user-managed and may differ from the Auth0 login email.',
    );
    expect(source).toContain(
      'Optional IBAN and PayPal fields store global reimbursement details for finance teams.',
    );
    expect(source).toContain('## Claiming a private registration transfer');
    expect(source).toContain(
      'review the event, current questions, current recipient price, and the complete fixed registration/add-on bundle before accepting it',
    );
    expect(source).toContain(
      "getByRole('link', { exact: true, name: 'Claim transfer' })",
    );
    expect(source).toContain('documentedIban');
    expect(source).toContain('documentedPaypalEmail');
    expect(source).toContain("getByRole('textbox', { name: 'IBAN' })");
    expect(source).toContain("getByRole('textbox', { name: 'PayPal email' })");
    expect(source).toContain('updatedProfileUser.iban).toBe(documentedIban)');
    expect(source).toContain(
      'updatedProfileUser.paypalEmail).toBe(documentedPaypalEmail)',
    );
    expect(source).toContain(
      'Profile event cards point pending checkout registrations at the implemented profile action, route ticket/cancellation/transfer details back to the event page, expose waitlist routing back to the event page, and explain that cancellation stops after check-in while a transfer preserves the attendee and guest check-in history',
    );
    expect(source).toContain(
      'Continue payment from this card, or open the event page for registration details.',
    );
    expect(source).toContain(
      'Open the event page for waitlist details and current cancellation status.',
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
      'You are checked in. Open the event page for ticket details. Cancellation is no longer available; a transfer preserves the existing attendee and guest check-in history.',
    );
    expect(source).toContain('Submitted receipts');
    expect(source).toContain('profile-docs-receipt-');
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
      'The account form pre-fills first name, last name, and **Notification email** from Auth0 data when available.',
    );
    expect(source).toContain(
      'It stays disabled while invalid, already submitting, waiting for the onboarding mutation, or until the current privacy policy is accepted',
    );
    expect(source).toContain(
      'Existing global users with the same Auth0 id join the current tenant instead of creating a duplicate global user.',
    );
    expect(source).toContain(
      'If setup fails or the requirements changed in another tab, the page shows a retryable server error instead of silently losing the submit attempt.',
    );
    expect(source).toContain('exact privacy-policy version');
    expect(source).toContain('original home tenant stays unchanged');
    expect(source).not.toContain('login email as your notification email');
    expect(source).not.toContain('tenant-specific notification email');
  });

  it('keeps tenant-onboarding docs page-backed and explicit about versioned consent', () => {
    const source = readSource('tests/docs/users/tenant-onboarding.doc.ts');

    expect(source).toContain("admin.page.goto('/admin/onboarding')");
    expect(source).toContain('takeScreenshot');
    expect(source).toContain('Publishing a policy takes effect immediately');
    expect(source).toContain('Every existing tenant user');
    expect(source).toContain('Confirm and continue');
    expect(source).toContain('tenantPrivacyPolicyAcceptances.findFirst');
    expect(source).toContain('tenantOnboardingQuestionAnswers.findFirst');
    expect(source).toContain('Make this my home tenant');
    expect(source).toContain(
      'Text and URL saved together form one policy version with one publication time and author.',
    );
    expect(source).toContain(
      'while a URL is saved, **Privacy** opens that external URL',
    );
    expect(source).toContain("name: 'Privacy policy URL'");
    expect(source).toContain('.fill(privacyPolicyUrl)');
    expect(source).toContain('privacyPolicyText,\n    privacyPolicyUrl,');
    expect(source).toContain("name: 'Open the full privacy policy'");
    expect(source).toContain("toHaveAttribute('href', privacyPolicyUrl)");
    expect(source).toContain(
      'Hosted text plus an external URL is still one accepted policy version, not two separate acceptances.',
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
      'queues the submitter receipt-reviewed email in the durable email outbox.',
    );
    expect(receiptSource).toContain(
      'delivered+receipt-doc-${receiptId}@resend.dev',
    );
    expect(combinedSource).toContain(
      'record the manual reimbursement transaction for the selected batch',
    );
    expect(receiptSource).toContain(
      "Recording reimbursement updates the receipt to **refunded** and creates a successful manual refund transaction in Evorto using the receipt's recorded currency.",
    );
    expect(receiptSource).toContain(
      'The actual bank or PayPal transfer remains an external finance action.',
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
      'Each child page is guarded by its own finance permission.',
    );
    expect(source).toContain('The finance overview is a navigation surface.');
    expect(source).toContain(
      'It shows links only for the finance capabilities you have, so users with receipt approval access do not automatically see the transaction list.',
    );
    expect(source).toContain(
      '- **finance:viewTransactions**: view the tenant transaction list.',
    );
    expect(source).toContain(
      '- **finance:approveReceipts**: review submitted receipts.',
    );
    expect(source).toContain(
      '- **finance:refundReceipts**: record receipt reimbursement batches.',
    );
    expect(source).toContain('visibleTransactionComment');
    expect(source).toContain('cancelledTransactionComment');
    expect(source).toContain(
      'Cancelled transactions are omitted from this list.',
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

    expect(source).toContain("test('Import a Stripe tax rate and verify it'");
    expect(source).toContain('Expected the tax-rate docs tenant to use Stripe');
    expect(source).toContain('await rateCheckbox.check()');
    expect(source).toContain(
      "page.getByRole('button', { name: 'Import selected' }).click()",
    );
    expect(source).toContain('stripeAccountId: tenantRecord.stripeAccountId');
    expect(source).toContain('documentedRate.stripeTaxRateId');
    expect(source).toContain('const reopenedDialog');
    expect(source).toContain(
      'await expect(importedRateCheckbox).toBeDisabled()',
    );
    expect(source).toContain(
      "importedRateRow.getByText('imported', { exact: true })",
    );
    expect(source).toContain('Failed to load rates from Stripe');
    expect(source).toContain('imports nothing');
    expect(source).toContain("test.describe.configure({ mode: 'default' })");
    expect(source).toContain(
      'This journey needs **View templates**, **Edit all templates**, and **Create events** access.',
    );
    expect(source).toContain('Free options hide the price and tax-rate fields');
    expect(source).not.toContain('free registrations keep the field disabled');
    expect(source).toContain('No active inclusive tax rates');
    expect(source).toContain('Keep the option free until a compatible rate');
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

  it('keeps template docs aligned with simple and advanced graph authoring', () => {
    const source = readSource('tests/docs/templates/templates.doc.ts');

    expect(source).toContain(
      'Simple mode intentionally keeps exactly one organizer registration block and one participant registration block.',
    );
    expect(source).toContain(
      'Advanced configuration supports any number of named options and reveals reusable add-ons with explicit option mappings.',
    );
    expect(source).toContain(
      'first save the advanced graph with exactly one organizing and one non-organizing option',
    );
    expect(source).toContain(
      '**Description** and **description for registered users**: Optional reusable',
    );
    expect(source).toContain(
      '**ESNcard discounted price**: Optional discounted pricing for tenants with the ESNcard discount provider enabled.',
    );
    expect(source).toContain(
      '**Selected roles**: The roles that are selected for this registration.',
    );
    expect(source).toContain(
      '**Manual approval** saves a pending application for an organizer to review',
    );
    expect(source).toContain("name: 'Manual approval'");
    expect(source).toContain(
      "expect(organizerRegistrationOption.registrationMode).toBe('application')",
    );
    expect(source).toContain(
      'Role selection also avoids duplicate entries by hiding already selected roles from the autocomplete list.',
    );
    expect(source).toContain(
      "throw new Error('Expected template docs autocomplete option to have text')",
    );
    expect(source).toContain(
      'Organizer planning tips**: Optional private organizer notes',
    );
    expect(source).toContain(
      'When **Enable Payment** is on, the price and tax-rate fields appear for that registration block.',
    );
    expect(source).toContain(
      'Add-ons can be free or paid, mapped to one or more registration options',
    );
    expect(source).toContain(
      'shown on matching registration cards for registration-time purchase',
    );
    expect(source).toContain(
      'Questions can include help text and can be marked as required.',
    );
    expect(source).toContain(
      'Event-side answer collection is handled separately from this template setup flow.',
    );
    expect(source).toContain('fillTemplateBasics');
    expect(source).toContain('Switch to advanced configuration?');
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
    expect(source).toContain(
      'If the reason says a registration option no longer belongs to the selected template',
    );
    expect(source).toContain(
      'If it mentions legacy random allocation, return to the template, change every option to **First come, first served** or **Manual approval**',
    );
    expect(source).toContain(
      'Do not assume the event exists until its detail page opens and shows the event title.',
    );
    expect(source).not.toContain('app-template-registration-option-form');
    expect(source).not.toContain('app-template-addon-form');
    expect(source).not.toContain('app-template-question-form');
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

    expect(source).toContain('Category docs ${seedDate.getTime()}');
    expect(source).toContain(
      'Expected generated category docs to persist the category',
    );
    expect(source).toContain(
      'Expected generated category docs to update the category',
    );
    expect(source).toContain(
      'updatedCategory.title).toBe(updatedCategoryTitle)',
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
      "test('Complete a paid transfer and recover one failed source refund claim'",
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
      'When a participant option is full, registration changes to a distinct **Join waitlist** action',
    );
    expect(source).toContain(
      'Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.',
    );
    expect(source).toContain(
      'When the registration window is closed, participants can still read the event details, but the registration action is removed.',
    );
    expect(source).toContain(
      'This event is visible from the direct link, but your account is not eligible for the available registration options.',
    );
    expect(source).toContain("test('Buy add-ons after registration'");
    expect(source).not.toContain('## Buy add-ons after registration');
    expect(source).not.toContain('## Registration unavailable states');
    expect(source).toContain(
      'This guide is for a signed-in participant whose account belongs to the same tenant as the event.',
    );
    expect(source).toContain(
      "A paid registration also requires the tenant's Stripe payments to be available",
    );
    expect(source).toContain(
      'Show this ticket QR code when attending the event.',
    );
    expect(source).toContain(
      'guests do not need separate accounts, but each guest uses one available event spot and stays attached to your registration.',
    );
    expect(source).toContain(
      "const guestCountInput = participantRegistrationCard.getByLabel('Guests')",
    );
    expect(source).toContain("await guestCountInput.fill('1')");
    expect(source).toContain("getByText('+ you = 2 spots')");
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
      'After Stripe accepts the payment, return to the event page to see your registration confirmation.',
    );
    expect(source).not.toContain(
      'After successful payment, you are redirected back to the event page',
    );
    expect(source).toContain('This add-on is not sold before the event.');
    expect(source).toContain('This add-on is not sold during the event.');
    expect(source).toContain('Payment is pending');
    expect(source).toContain('Continue Stripe checkout');
    expect(source).not.toContain('await scenario.beginPaidCheckout(2)');
    expect(source).toContain("name: 'Continue to Stripe'");
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
    expect(transferSource).toContain('# Transfer a registration');
    expect(transferSource).toContain('waitForRegistrationPage');
    expect(transferSource).toContain(
      'This guide uses two signed-in participant accounts that belong to the same tenant:',
    );
    expect(transferSource).toContain(
      '/docs/complete-a-paid-transfer-and-recover-one-failed-source-refund-claim',
    );
    expect(transferSource).toContain(
      '/docs/transfer-a-registration-with-a-private-offer',
    );
    expect(transferSource).toContain(
      'The transfer link and manual code are bearer credentials.',
    );
    expect(freeTransferSource).toContain(
      "getByRole('link', { exact: true, name: 'Profile' })",
    );
    expect(freeTransferSource).toContain(
      "getByRole('link', { exact: true, name: 'Claim transfer' })",
    );
    expect(freeTransferSource).toContain("getByLabel('Manual claim code')");
    expect(freeTransferSource).toContain(
      "getByRole('button', { name: 'Cancel transfer offer' })",
    );
    expect(freeTransferSource).toContain(".toBe('cancelled')");
    expect(freeTransferSource).toContain(
      'Cancelling the offer invalidates its private link and manual code; it does not cancel or transfer the registration.',
    );
    expect(freeTransferSource).toContain("getByLabel('Claim code')");
    expect(freeTransferSource).toContain('NOT-A-VALID-TRANSFER-CODE');
    expect(freeTransferSource).toContain(
      "getByRole('link', { name: 'Enter another code' })",
    );
    expect(freeTransferSource).toContain(
      'If Evorto says the transfer could not be opened, select **Enter another code**',
    );
    expect(freeTransferSource).toContain("name: 'Enter a private claim code'");
    expect(freeTransferSource).toContain(
      "getByLabel('What should the organizer know?')",
    );
    expect(freeTransferSource).toContain(
      'schema.eventRegistrationQuestionAnswers.answer',
    );
    expect(freeTransferSource).toContain(
      'The source participant entered this answer.',
    );
    expect(freeTransferSource).toContain(
      'Previous answers do not transfer: answer every currently required question for the recipient',
    );
    expect(transferSource).toContain('current role eligibility');
    expect(transferSource).toContain('one inseparable bundle');
    expect(transferSource).toContain(
      "The previous owner's answers and discounts do not transfer.",
    );
    expect(transferSource).toContain(
      'Guest quantity, every included/free/purchased add-on quantity, check-in state, and fulfillment history transfer unchanged',
    );
    expect(transferSource).toContain(
      'the recipient cannot omit or re-quantity them',
    );
    expect(transferSource).toContain(
      'every add-on quantity, and existing check-in/fulfillment history',
    );
    expect(transferSource).toContain(
      'prices the fixed bundle from current base prices',
    );
    expect(transferSource).toContain(
      "applies only the recipient's current eligible discounts",
    );
    expect(transferSource).toContain(
      'a separate claim for each remaining source refund',
    );
    expect(transferSource).toContain(
      'the prior and new refunds add up to each original Stripe payment exactly',
    );
    expect(transferSource).toContain(
      'completes database-only only when the entire bundle is free and no source refund claim is required',
    );
    expect(transferSource).not.toContain(
      'a successful separately paid add-on currently blocks',
    );
    expect(transferSource).not.toContain(
      'Non-Stripe and multi-source paid tickets stay blocked',
    );
    expect(transferSource).toContain(
      "The registration stays confirmed under the source owner's ownership while the offer is open.",
    );
    expect(transferSource).toContain(
      "Stripe Checkout on the tenant's connected account and includes the platform application fee.",
    );
    expect(transferSource).toContain(
      '**Transfer complete — refund processing**',
    );
    expect(transferSource).toContain(
      '**Transfer complete — refund needs attention**',
    );
    expect(transferSource).toContain(
      'must use the recovery action to requeue the existing failed refund claim',
    );
    expect(transferSource).toContain(
      'A platform administrator must use the recovery action',
    );
    expect(transferSource).not.toContain('finance or platform administrator');
    expect(transferSource).toContain(
      'queues a full recipient refund including the platform fee',
    );
    expect(transferSource).toContain(
      '**Transfer stopped — refund needs attention**',
    );
    expect(transferSource).toContain(
      'the recipient does not own the ticket and must not pay or claim again',
    );
    expect(transferSource).toContain(
      "test('Complete a paid transfer and recover one failed source refund claim'",
    );
    expect(transferSource).toContain('seedPaidRegistrationTransferScenario');
    expect(transferSource).toContain('await scenario.completeCheckout()');
    expect(transferSource).toContain('await scenario.failSourceRefund()');
    expect(transferSource).not.toContain(
      'await scenario.requeueSourceRefund()',
    );
    expect(transferSource).toContain('storageState: gaStateFile');
    expect(transferSource).toContain(
      "getByRole('tab', { name: 'Refund recovery' })",
    );
    expect(transferSource).toContain('refundRecoveryForm.getByLabel(');
    expect(transferSource).toContain("'Operational recovery reason'");
    expect(transferSource).toContain("name: 'Schedule new refund generation'");
    expect(transferSource).toContain("name: 'Payment still required'");
    expect(transferSource).toContain(
      "name: 'Transfer complete — refund processing'",
    );
    expect(transferSource).toContain(
      "name: 'Transfer complete — refund needs attention'",
    );
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
    expect(paidTransferScenarioSource).toContain(
      'recipientRegistrationId: sourceRegistrationId',
    );
    expect(paidTransferScenarioSource).toContain('recipientSpotCount: 2');
    expect(paidTransferScenarioSource).toContain('sourceSpotCount: 2');
    expect(paidTransferScenarioSource).toContain('reservedAdditionalSpots: 0');
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
      "getByText('Registration check-in', { exact: true })",
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
      String.raw`toContainText(/Redeemed\s*1/)`,
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
      ".getByText('Loading event ...', { exact: true })",
    );
    expect(registrationPageSource).toContain(
      ".getByText('Failed to load event.', { exact: true })",
    );
    expect(registrationPageSource).toContain('level: 2');
    expect(registrationPageSource).toContain("name: 'Registration'");
    expect(registrationPageSource).toContain(
      ".getByText('Loading registration status')",
    );
    expect(registrationPageSource).toContain(
      ".getByText('Failed to load registration status.')",
    );
    expect(registrationPageSource.indexOf("name: 'Registration'")).toBeLessThan(
      registrationPageSource.indexOf(
        ".getByText('Loading registration status')",
      ),
    );
    expect(
      registrationPageSource.indexOf(':not([aria-busy="true"])'),
    ).toBeLessThan(
      registrationPageSource.indexOf(
        ".getByText('Loading event ...', { exact: true })",
      ),
    );
    expect(
      registrationPageSource.indexOf(
        ".getByText('Failed to load event.', { exact: true })",
      ),
    ).toBeLessThan(registrationPageSource.indexOf("name: 'Registration'"));
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).toContain(
      'Evorto also queues a confirmation email with a link back to this authenticated ticket page.',
    );
    expect(source).toContain('seedRequiredRegistrationQuestion');
    expect(source).toContain(
      'Free registration cards can also offer guests, registration-time add-ons, and required questions.',
    );
    expect(source).toContain('question answers are stored for organizers.');
    expect(source).toContain(
      'participantRegistrationCard.getByLabel(registrationQuestion.title)',
    );
    expect(source).toContain('registration.questionAnswers');
    expect(source).toContain(
      'If that option asks required registration questions, participants must answer them before joining the waitlist.',
    );
    expect(source).toContain('waitlistRegistration.questionAnswers');
    expect(source).toContain(
      'Review the **Leave the waitlist?** confirmation; **Keep registration** receives focus by default.',
    );
    expect(source).toContain('Confirm before giving up a waitlist position');
    expect(source).toContain('fullOptionAfterLeaving.waitlistSpots');
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain('ticket QR code by email');
  });

  it('keeps participant unlisted-event guidance page-backed', () => {
    const source = readSource('tests/docs/events/unlisted-user.doc.ts');

    expect(source).toContain('.set({ unlisted: true })');
    expect(source).toContain("page.getByRole('link', { name: target.title })");
    expect(source).toContain('toHaveCount(0)');
    expect(source).toContain('await page.goto(`/events/${target.id}`);');
    expect(source).toContain('waitForRegistrationPage(page)');
    expect(source).toContain(
      'Being unlisted does not bypass role, registration-window, capacity, or sign-in requirements.',
    );
    expect(source).toContain('Unlisted event opened from its direct link');
    expect(source).toContain('page.context().clearCookies()');
    expect(source).toContain('page.context().addCookies([tenantCookie])');
    expect(source).toContain("name: 'Log in now'");
    expect(source).toContain(
      'Anyone with the exact link can open the approved event details.',
    );
    expect(source).toContain('.set({ unlisted: target.unlisted })');
  });

  it('keeps manual approval docs beginner-readable and behavior-backed', () => {
    const source = readSource('tests/docs/events/manual-approval.doc.ts');

    expect(source).toContain('# Manual approval registrations');
    expect(source).toContain('This guide uses two signed-in accounts');
    expect(source).toContain(
      'An application does not reserve a spot, charge the participant, or create a ticket.',
    );
    expect(source).toContain('Apply for approval');
    expect(source).toContain('Awaiting approval');
    expect(source).toContain('Approve application');
    expect(source).toContain(
      'Refresh or reopen the event after the organizer finishes.',
    );
    expect(source).toContain(
      'Selecting **Approve application** reserves one spot and prepares one Stripe Checkout session.',
    );
    expect(source).toContain('deliverCompletedRegistrationCheckoutWebhook({');
    expect(source).not.toContain('fillTestCard');
    expect(source).toContain(".toBe('successful:CONFIRMED')");
    expect(source).toContain('approvalEmailsForRegistration');
    expect(source).toContain('Payment setup needs retry');
    expect(source).toContain('Retry payment setup');
    expect(source).toContain("transactionStatus: 'cancelled'");
    expect(source).toContain('Current boundaries');
    expect(source).toContain('Application and approval are tenant-scoped.');
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

    expect(source).toContain('# Sign up as an organizer or helper');
    expect(source).toContain(
      'Organizer/helper registrations never include guests or a waitlist.',
    );
    expect(source).toContain(
      'Evorto allows one active registration per person and event',
    );
    expect(source).toContain('Organizer/helper registration confirmed');
    expect(source).toContain('Your organizer/helper pass');
    expect(source).toContain('Organizer/helper team');
    expect(source).toContain('Participant registrations');
    expect(source).toContain('Type** as **Organizer/helper');
    expect(source).toContain('A saved or copied organizer URL');
    expect(source).toContain(
      'page.goto(`/events/${scenario.event.id}/organize`)',
    );
    expect(source).toContain(String.raw`page).toHaveURL(/\/403$/)`);
    expect(source).toContain(
      '# Apply for an advanced organizer or helper category',
    );
    expect(source).toContain('Organizer/helper application pending');
    expect(source).toContain('Approve application');
    expect(source).toContain(
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

    expect(source).toContain('Approval Flow ${seedDate.getTime()}');
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
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).not.toContain(
      'Approval Flow ${seedDate.toISOString().slice(0, 10)}',
    );
  });

  it('keeps event-management docs aligned with scanner and organizer scope', () => {
    const source = readSource('tests/docs/events/event-management.doc.ts');

    expect(source).toContain(
      'Each draft event owns its registration configuration independently from the source template.',
    );
    expect(source).toContain(
      'Before returning an advanced event to simple mode, save the advanced graph with exactly one option of each kind',
    );
    expect(source).toContain("page.getByTestId('event-mode-simple')");
    expect(source).toContain("page.getByTestId('event-mode-advanced')");
    expect(source).toContain(
      'event.id === seeded.scenario.events.draft.eventId',
    );

    expect(source).toContain(
      'Organizers check in attendees from the dedicated QR scanner.',
    );
    expect(source).toContain(
      'The scanned-registration page shows the attendee, event, registration option, ESNcard discount marker when applicable, guest check-in progress when guests are attached to the registration, and warnings for self-scan, future events, non-confirmed registrations, and already checked-in tickets.',
    );
    expect(source).toContain(
      'Confirming check-in records the registration check-in time and updates the checked-in count shown on the organizer overview.',
    );
    expect(source).toContain(
      'When a registration includes guests, the organizer chooses how many guests arrived with the attendee, and the checked-in count increases by the attendee plus the selected guests.',
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
    expect(source).toContain('Scanned registration with guest check-in');
    expect(source).toContain("page.getByText('Check-in recorded')");
    expect(source).toContain('checkedInGuestCount: true');
    expect(source).toContain('checkedInSpots: initialCheckedInSpots + 3');
    expect(source).toContain('.update(eventRegistrationOptions)');
    expect(source).toContain('.set({ checkedInSpots: initialCheckedInSpots })');
    expect(source).toContain(
      "Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot and submits the appropriate Stripe refunds for paid event sources.",
    );
    expect(source).toContain(
      'Event registration and add-on payments are Stripe-only',
    );
    expect(source).toContain(
      'Guest quantity, all included/free/purchased add-on quantities, and check-in/fulfillment history move unchanged.',
    );
    expect(source).toContain(
      'The source receives exact refunds for every original Stripe payment',
    );
    expect(source).not.toContain('pending manual refund record');
    expect(source).not.toContain(
      'separately paid add-on or a non-Stripe registration payment currently blocks',
    );
    expect(source).toContain(
      'It does not currently include attendee export, attendee messaging, or manual check-in controls outside QR scanning',
    );
    expect(source).toContain(
      'Role picker behavior: already selected roles are hidden from suggestions to avoid duplicate eligibility entries.',
    );
    expect(source).toContain(
      'If the organizer overview request fails, Evorto hides every registration count and participant action.',
    );
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
      "registrationOptionEditor.getByPlaceholder('Add Role...')",
    );
    expect(source).toContain('Event edit role picker duplicate prevention');
    expect(source).not.toContain('manual check-in from the organizer overview');
    expect(source).not.toContain('automatic refund controls are available');
    expect(source).not.toContain('paid registration transfer is available');
  });

  it('keeps dedicated check-in docs beginner-readable and behavior-backed', () => {
    const source = readSource('tests/docs/scanning/check-in.doc.ts');

    expect(source).toContain('# Check in event attendees');
    expect(source).toContain('Before you start');
    expect(source).toContain(
      "page.getByRole('link', { exact: true, name: 'Scanner' })",
    );
    expect(source).toContain("installMockCamera(page, 'allowed')");
    expect(source).toContain('camera=(self)');
    expect(source).toContain('If the camera does not start');
    expect(source).toContain('**Invalid QR code**');
    expect(source).toContain("getByRole('link', { name: 'Back to scanner' })");
    expect(source).toContain('Verify the registration');
    expect(source).toContain('Check in guests who arrive later');
    expect(source).toContain("page.getByText('Already checked in')");
    expect(source).toContain('checkedInSpots: optionBefore.checkedInSpots + 2');
    expect(source).toContain('optionBefore.checkedInSpots + 3');
    expect(source).toContain('.delete(eventRegistrations)');
    expect(source).toContain(
      '.set({ checkedInSpots: optionBefore.checkedInSpots })',
    );
    expect(source).not.toContain('a QR code is enough to check in');
  });

  it('keeps role docs aligned with generated permission reference semantics', () => {
    const rolesSource = readSource('tests/docs/roles/roles.doc.ts');
    const permissionsSource = readSource(
      'tests/docs/roles/about-permissions.doc.ts',
    );

    expect(rolesSource).toContain(
      'Learn more at [about permissions](/docs/about-permissions).',
    );
    expect(rolesSource).toContain(
      'Permissions that are required by another permission are automatically included and shown as non-editable dependent permissions with the same admin-facing labels used in the permission reference.',
    );
    expect(rolesSource).toContain('Role docs ${seedDate.getTime()}');
    expect(rolesSource).toContain(
      "throw new Error('Expected generated roles doc to persist the role')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('events:create')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('templates:view')",
    );
    expect(rolesSource).toContain('.delete(schema.roles)');
    expect(permissionsSource).toContain(
      'Permissions are tenant-scoped capabilities assigned through roles.',
    );
    expect(permissionsSource).toContain(
      'Wildcard permissions such as \\`events:*\\` grant the permissions in that group.',
    );
    expect(permissionsSource).toContain(
      'Some permissions also include dependent permissions so the user can reach the screens needed to use the parent capability.',
    );
    expect(permissionsSource).toContain(
      'Global admin access is separate from tenant roles.',
    );
    expect(permissionsSource).toContain('PERMISSION_GROUPS');
    expect(permissionsSource).toContain('PERMISSION_DEPENDENCIES');
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
      'The profile discount-card form stores one ESN card per user and trims the card number before validation.',
    );
    expect(source).toContain(
      'Save, refresh, and remove stay disabled while any ESNcard write is pending',
    );
    expect(source).toContain(
      'Provider outages are not treated as invalid cards.',
    );
    expect(source).toContain(
      'Evorto leaves the stored ESN card unchanged so the user can retry later.',
    );
    expect(source).toContain("page.goto('/profile#discounts')");
    expect(source).toContain(
      "page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).toContain('unchangedSeededEsnCard');
    expect(source).toContain(
      "page.getByRole('button', { name: 'Save ESN card' })",
    );
    expect(source).toContain('ESNcard validation provider is unavailable');
    expect(source).not.toContain('provider outages mark the card invalid');
    expect(source).not.toContain('overlap ESNcard writes');
    expect(source).not.toContain('stores the card number without trimming');
  });
});
