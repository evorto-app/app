import { readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(repositoryRoot, sourcePath), 'utf8');

const listFiles = (directory: string, extension: string): string[] =>
  readdirSync(nodePath.join(repositoryRoot, directory)).flatMap((entry) => {
    const sourcePath = `${directory}/${entry}`;
    const absolutePath = nodePath.join(repositoryRoot, sourcePath);

    if (statSync(absolutePath).isDirectory()) {
      return listFiles(sourcePath, extension);
    }

    return sourcePath.endsWith(extension) ? [sourcePath] : [];
  });

const readSection = (source: string, heading: string, nextHeading: string) => {
  const match = source.match(
    new RegExp(
      String.raw`## ${heading}\n(?<section>[\s\S]*?)\n## ${nextHeading}`,
      'u',
    ),
  );

  if (!match?.groups?.section) {
    throw new Error(
      `STABILIZATION.md is missing the ${heading} section before ${nextHeading}`,
    );
  }

  return match.groups.section;
};

describe('stabilization source', () => {
  it('keeps the approved event status mapped to published product language', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const eventStatusComponent = readSource(
      'src/app/shared/components/event-status/event-status.component.ts',
    );
    const eventApprovalDocument = readSource(
      'tests/docs/events/event-approval.doc.ts',
    );

    expect(product).toContain(
      'Publishing is the approval act. There is no separate "approved but not published" state for now.',
    );
    expect(eventStatusComponent).toContain("case 'APPROVED'");
    expect(eventStatusComponent).toContain("return 'Published'");
    expect(eventApprovalDocument).toContain(
      "expect(approvedEvent.status).toBe('APPROVED')",
    );
    expect(eventApprovalDocument).toContain('final **Published** state');
    expect(source).toContain('label the persisted `APPROVED` review state as');
    expect(source).toContain('internal enum unchanged');
  });

  it('keeps legal pages from inventing fallback legal copy', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const legalPageComponent = readSource(
      'src/app/core/legal-page/legal-page.component.ts',
    );
    const legalLinksSpec = readSource(
      'src/app/core/tenant-legal-links.spec.ts',
    );

    expect(product).toContain(
      "Evorto should not provide fake fallback legal pages that pretend to cover a tenant's legal obligations.",
    );
    expect(product).toContain(
      'Do not: invent generic legal fallback text and treat it as production-ready.',
    );
    expect(legalPageComponent).toContain(
      'No tenant-provided legal text is configured for this page.',
    );
    expect(legalPageComponent).not.toContain(
      'This legal page has not been configured',
    );
    expect(legalLinksSpec).toContain(
      'does not invent fallback legal text for unconfigured tenant pages',
    );
    expect(source).toContain('unconfigured hosted legal pages now');
    expect(source).toContain('generic fallback legal copy');
  });

  it('keeps ESNcard template pricing behind the tenant provider', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const templateDetails = readSource(
      'src/app/templates/template-details/template-details.component.ts',
    );
    const templateDetailsTemplate = readSource(
      'src/app/templates/template-details/template-details.component.html',
    );
    const templateDetailsSpec = readSource(
      'src/app/templates/template-details/template-details.component.spec.ts',
    );

    expect(product).toContain(
      'ESN-card behavior should be opt-in because not every tenant is an ESN section.',
    );
    expect(product).toContain('- hard-coded ESN-only assumptions');
    expect(templateDetails).toContain('templateEsnDiscountVisible');
    expect(templateDetails).toContain(
      "provider.type === 'esnCard')?.status ===",
    );
    expect(templateDetailsTemplate).toContain('esnEnabled: esnEnabled()');
    expect(templateDetailsSpec).toContain(
      'shows ESNcard template discounts only when the tenant provider is enabled',
    );
    expect(source).toContain(
      'shows them on template detail only while the current tenant ESNcard provider is enabled',
    );
  });

  it('keeps same-event registration mutual exclusion explicit', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const registrationService = readSource(
      'src/server/effect/rpc/handlers/events/event-registration.service.ts',
    );
    const registrationServiceSpec = readSource(
      'src/server/effect/rpc/handlers/events/event-registration.service.spec.ts',
    );

    expect(product).toContain(
      'Registration options are mutually exclusive per event.',
    );
    expect(product).toContain(
      'A user cannot be both an organizer/helper and a participant for the same event.',
    );
    expect(registrationService).toContain("status: { NOT: 'CANCELLED' }");
    expect(registrationService).toContain(
      "return { _tag: 'AlreadyRegistered' } as const",
    );
    expect(registrationServiceSpec).toContain(
      'rejects a second registration for the same event before looking up another option',
    );
    expect(source).toContain(
      'Registration writes enforce approved event status, tenant scope, open/close windows, role eligibility, one active registration per user/event',
    );
    expect(source).toContain('same-event second registrations across options');
  });

  it('keeps QR image access aligned with the product paper-ticket model', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const qrHandler = readSource('src/server/http/qr-code.web-handler.ts');
    const qrHandlerSpec = readSource(
      'src/server/http/qr-code.web-handler.spec.ts',
    );
    const createIdSource = readSource('src/db/create-id.ts');
    const createIdSpec = readSource('src/db/create-id.spec.ts');
    const eventRegistrationSchema = readSource(
      'src/db/schema/event-registrations.ts',
    );

    expect(product).toContain('QR links behave like paper tickets');
    expect(product).toContain(
      'possession of the unguessable ticket URL is enough to render the QR image',
    );
    expect(product).toContain(
      'Check-in must validate registration status and show enough attendee identity',
    );
    expect(qrHandler).toContain("registration.status !== 'CONFIRMED'");
    expect(qrHandler).not.toContain('Authentication required');
    expect(qrHandlerSpec).toContain(
      'allows ticket possession to fetch a confirmed registration QR image',
    );
    expect(qrHandlerSpec).toContain(
      'uses the registration tenant domain in the encoded scan URL',
    );
    expect(qrHandlerSpec).toContain(
      'does not generate QR images for pending registrations',
    );
    expect(createIdSource).toContain(
      "import { init } from '@paralleldrive/cuid2'",
    );
    expect(createIdSource).toContain('const length = 20');
    expect(eventRegistrationSchema).toContain('...modelOfTenant');
    expect(createIdSpec).toContain(
      'creates non-sequential ids suitable for ticket links',
    );
    expect(createIdSpec).toContain('/^[a-z0-9]{20}$/u');
    expect(source).toContain('paper-ticket model');
    expect(source).toContain('scan/check-in details');
    expect(source).toContain('scanner authorization');
  });

  it('keeps the review status honest about the event archival data-model blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const architecture = readSource('ARCHITECTURE.md');
    const eventSchema = readSource('src/db/schema/event-instances.ts');
    const archiveSchema = readSource(
      'src/db/schema/event-archive-snapshots.ts',
    );
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'Preserve non-personal event records after the event is archived.',
    );
    expect(architecture).toContain(
      'support archival at the data-model level for relaunch',
    );
    expect(eventSchema).toContain('export const eventReviewStatus = pgEnum');
    expect(eventSchema).toContain("'REJECTED'");
    expect(archiveSchema).toContain(
      "eventArchiveSnapshots = pgTable('event_archive_snapshots'",
    );
    expect(archiveSchema).toContain('EventArchiveRegistrationSummary');
    expect(archiveSchema).toContain('EventArchiveOptionSummary');
    expect(archiveSchema).not.toMatch(
      /userId|creatorId|reviewedBy|email|firstName|lastName/u,
    );
    expect(statusTable).toContain('| Events');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain('event archival snapshot model');
    expect(source).toMatch(
      /event archival snapshot model\s+now stores non-personal event timing/u,
    );
    expect(source).toMatch(
      /Automatic archival remains out of scope without an\s+explicit\s+product decision/u,
    );
  });

  it('keeps the review status honest about the paid transfer relaunch coverage', () => {
    const source = readSource('STABILIZATION.md');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(statusTable).toContain('| Registrations');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain('unpaid transfer boundaries');
    expect(statusTable).toContain(
      'paid transfer/direct-resale checkout handoff',
    );
    expect(statusTable).toContain('source-refund completion fallback');
    expect(statusTable).toContain(
      'public resale listings remain outside relaunch scope',
    );
    expect(statusTable).not.toContain(
      'Free/paid registration, guests, add-ons, waitlist, negative states, cancellation/refund, and transfer boundaries have server, app, spec, and docs coverage.',
    );
  });

  it('keeps the review status honest about registration email notification blockers', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const outboxSchema = readSource(
      'src/db/schema/email-notification-outbox.ts',
    );
    const registrationHandler = readSource(
      'src/server/effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const registrationHandlerSpec = readSource(
      'src/server/effect/rpc/handlers/events/events-registration.handlers.spec.ts',
    );
    const emailDispatcher = readSource(
      'src/server/email/email-notification-dispatcher.ts',
    );
    const emailConfig = readSource(
      'src/server/config/email-notifications-config.ts',
    );
    const serverEntry = readSource('src/server.ts');
    const packageJson = readSource('package.json');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain('Email is the first notification channel.');
    expect(product).toContain(
      'successful registration confirmation, including QR code',
    );
    expect(product).toContain('waitlist spot available');
    expect(product).toContain('registration cancelled by participant or admin');
    expect(product).toContain('transfer completed');
    expect(outboxSchema).toContain("'registrationConfirmed'");
    expect(outboxSchema).toContain("'registrationCancelled'");
    expect(outboxSchema).toContain("'registrationTransferred'");
    expect(outboxSchema).toContain("'waitlistSpotAvailable'");
    expect(registrationHandler).toContain(
      'buildRegistrationTransferredEmailNotification',
    );
    expect(registrationHandler).toContain('emailNotificationOutbox');
    expect(registrationHandler).toContain("'registrationTransferred'");
    expect(registrationHandlerSpec).toContain(
      'builds transfer-completed email copy for the new registration owner',
    );
    expect(packageJson).not.toContain('"resend"');
    expect(emailDispatcher).toContain('https://api.resend.com/emails');
    expect(emailDispatcher).toContain("'pending', 'failed'");
    expect(emailDispatcher).toContain("status: 'sent'");
    expect(emailDispatcher).toContain("status: 'failed'");
    expect(emailConfig).toContain('EMAIL_OUTBOX_DISPATCH_ENABLED');
    expect(emailConfig).toContain('EMAIL_FROM_ADDRESS');
    expect(emailConfig).toContain('RESEND_API_KEY');
    expect(serverEntry).toContain('EmailNotificationDispatcher.Default');
    expect(serverEntry).toContain('dispatcher.runScheduled');
    expect(statusTable).toContain('provider dispatch have coverage');
    expect(statusTable).not.toContain(
      'provider dispatch still need implementation',
    );
    expect(statusTable).toContain('| Registrations');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain(
      'registration confirmation/cancellation/transfer-completed/waitlist email outbox records',
    );
    expect(source).toMatch(
      /unpaid registration transfer now writes\s+a tenant-scoped `registrationTransferred` email outbox record/u,
    );
    expect(source).toMatch(
      /disabled-by-default Resend-backed email outbox dispatcher/u,
    );
    expect(source).toMatch(
      /Registration confirmation,\s+cancellation, transfer, and waitlist spot-available now record durable email\s+outbox rows/u,
    );
  });

  it('keeps the review status honest about receipt-reviewed email delivery', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const outboxSchema = readSource(
      'src/db/schema/email-notification-outbox.ts',
    );
    const financeHandler = readSource(
      'src/server/effect/rpc/handlers/finance/finance-receipts.handlers.ts',
    );
    const financeSpec = readSource(
      'src/server/effect/rpc/handlers/finance/finance.handlers.spec.ts',
    );
    const emailDispatcher = readSource(
      'src/server/email/email-notification-dispatcher.ts',
    );
    const receiptApprovalDetail = readSource(
      'src/app/finance/receipt-approval-detail/receipt-approval-detail.component.ts',
    );
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'Receipt review should support email notification when a receipt is reviewed.',
    );
    expect(outboxSchema).toContain("'receiptReviewed'");
    expect(outboxSchema).toContain('recipientEmail');
    expect(outboxSchema).toContain('textBody');
    expect(financeHandler).toContain('emailNotificationOutbox');
    expect(financeHandler).toContain('buildReceiptReviewedEmailNotification');
    expect(financeSpec).toContain(
      'enqueues a receipt-reviewed email notification with the review update',
    );
    expect(statusTable).toContain('| Finance/receipts');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain(
      'receipt review now enqueues receipt-reviewed email outbox records',
    );
    expect(statusTable).toContain(
      'Resend-backed outbox dispatcher processes pending/failed email records when enabled',
    );
    expect(source).toMatch(
      /receipt review now writes a\s+tenant-scoped `receiptReviewed` email outbox record/u,
    );
    expect(emailDispatcher).toContain('https://api.resend.com/emails');
    expect(emailDispatcher).toContain("'pending', 'failed'");
    expect(receiptApprovalDetail).toContain('Submitter email queued');
    expect(source).toMatch(
      /review detail page, success\s+feedback, finance docs, and source coverage now say receipt review queues a\s+submitter email/u,
    );
  });

  it('keeps the review status honest about the tenant operations-policy blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const tenantSettingsIdentity = readSource(
      'src/app/admin/general-settings/general-settings.identity.ts',
    );
    const tenantSettingsComponent = readSource(
      'src/app/admin/general-settings/general-settings.component.html',
    );
    const adminRpcContract = readSource(
      'src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts',
    );
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'limits on how many events a person can register for in a configured time frame',
    );
    expect(product).toContain('payment settings');
    expect(product).toContain('- review/publishing workflow settings');
    expect(product).toContain('- registration limits');
    expect(product).toContain('- email sender name');
    expect(tenantSettingsComponent).toContain('Email sender');
    expect(tenantSettingsComponent).toMatch(/review policy/iu);
    expect(tenantSettingsComponent).toContain('Registration limit');
    expect(tenantSettingsComponent).toContain('Stripe account management');
    expect(adminRpcContract).toContain('emailSenderName');
    expect(adminRpcContract).toContain('registrationLimitCount');
    expect(adminRpcContract).toContain('registrationLimitWindowDays');
    expect(adminRpcContract).not.toMatch(/reviewPolicy|review_policy/u);
    expect(adminRpcContract).not.toMatch(/stripeAccountId|stripe_account_id/u);
    expect(statusTable).toContain('| Registrations');
    expect(statusTable).toContain('| Tenant/global admin');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain(
      'review policy and tenant-admin Stripe account management are now explicit tenant settings',
    );
    expect(source).toMatch(
      /registration path enforces configured tenant participant\s+registration limits/u,
    );
    expect(source).toMatch(
      /Tenant\/global admin now exposes the relaunch operations\s+policy settings for review\/publishing, registration limits, and Stripe account\s+management as typed tenant configuration/u,
    );
  });

  it('keeps tenant brand-asset settings guards tied to upload lifecycle state', () => {
    const source = readSource('STABILIZATION.md');
    const component = readSource(
      'src/app/admin/general-settings/general-settings.component.ts',
    );
    const template = readSource(
      'src/app/admin/general-settings/general-settings.component.html',
    );
    const spec = readSource(
      'src/app/admin/general-settings/general-settings.component.spec.ts',
    );

    expect(component).toContain('brandAssetMutationPending');
    expect(component).toContain('uploadingBrandAsset !== null');
    expect(template).toContain(
      'brandAssetMutationPending: uploadBrandAssetMutation.isPending()',
    );
    expect(template).toContain('uploadingBrandAsset: uploadingBrandAsset()');
    expect(spec).toContain(
      'blocks tenant settings saves while a brand asset upload is active',
    );
    expect(source).toMatch(
      /tenant settings save blocking while brand-asset upload lifecycle state\s+is active/u,
    );
    expect(source).toContain(
      'Tenant brand-asset lifecycle pass: tenant settings saves now stay disabled',
    );
  });

  it('keeps the review status honest about the receipt-reviewed email blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const outboxSchema = readSource(
      'src/db/schema/email-notification-outbox.ts',
    );
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'Receipt review should support email notification when a receipt is reviewed.',
    );
    expect(statusTable).toContain('| Finance/receipts');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain(
      'receipt review now enqueues receipt-reviewed email outbox records',
    );
    expect(outboxSchema).toContain("'receiptReviewed'");
    expect(source).toMatch(
      /receipt review now writes a\s+tenant-scoped `receiptReviewed` email outbox record/u,
    );
    expect(source).toMatch(
      /Resend-backed email outbox dispatcher processes pending\s+and failed rows/u,
    );
  });

  it('keeps the review status honest about the home-tenant warning support', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const profileComponent = readSource(
      'src/app/profile/user-profile/user-profile.component.ts',
    );
    const profileHomeTenantSpec = readSource(
      'tests/specs/profile/user-profile-home-tenant.spec.ts',
    );
    const rpcRequestHandler = readSource(
      'src/server/effect/rpc/app-rpcs.request-handler.ts',
    );
    const rpcRequestHandlerSpec = readSource(
      'src/server/effect/rpc/app-rpcs.request-handler.spec.ts',
    );
    const usersSchema = readSource('src/db/schema/users.ts');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'A user should ideally have a home tenant so the app can warn when they are browsing a tenant that is not where they usually belong.',
    );
    expect(usersSchema).toMatch(
      /homeTenantId.*references\(\(\) => tenants\.id/u,
    );
    expect(profileComponent).toContain('profileHomeTenantWarning');
    expect(profileHomeTenantSpec).toContain(
      'profile warns when browsing outside the user home tenant',
    );
    expect(profileHomeTenantSpec).toContain(".getByRole('status')");
    expect(rpcRequestHandler).toContain(
      'communicationEmail: context.user.communicationEmail',
    );
    expect(rpcRequestHandler).toContain(
      'homeTenantId: context.user.homeTenantId',
    );
    expect(rpcRequestHandlerSpec).toContain(
      'keeps profile fields needed by users.self in the RPC context header',
    );
    expect(statusTable).toContain('| Profile/account flows');
    expect(statusTable).toContain('| Stabilized');
    expect(statusTable).toContain(
      'authenticated Browser profile-warning UX are covered',
    );
    expect(source).toMatch(
      /Profile\/account home-tenant data model and\s+profile warning UI are implemented/u,
    );
    expect(source).toContain(
      'A focused authenticated Playwright spec covers the visible warning',
    );
    expect(source).toContain(
      'authenticated in-app Browser pass verified the warning after normal Auth0 login',
    );
  });

  it('keeps the Browser review queue aligned with repeat manual app-flow review', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');

    expect(queue).toContain('For repeat Browser review');
    expect(queue).toContain('generated `BASE_URL` from `.env.dev`');
    expect(queue).toContain('local ports can be explicitly pinned for Auth0');
    expect(queue).not.toMatch(/http:\/\/localhost:\d+/u);
    expect(queue).toContain('Anonymous event discovery');
    expect(queue).toContain('Participant registration/profile');
    expect(queue).toContain('Organizer authoring and check-in');
    expect(queue).toContain('Tenant admin and finance');
    expect(queue).toContain('Global admin relaunch scope');
    expect(queue).toContain('Deterministic provider checks');
    expect(queue).toContain('tests/specs/events/events.test.ts');
    expect(queue).toContain('tests/specs/events/unlisted-visibility.test.ts');
    expect(queue).toContain('tests/docs/events/register.doc.ts');
    expect(queue).toContain('tests/docs/profile/*.doc.ts');
    expect(queue).toContain('bun run test:e2e:create-account');
    expect(queue).toContain('tests/specs/admin/global-admin-tenants.spec.ts');
    expect(queue).toContain(
      'tests/specs/permissions/global-admin-route-guard.spec.ts',
    );
    expect(queue).not.toContain('tests/docs/admin/global-admin.doc.ts');
    expect(queue).toContain('bun run test:e2e:esncard-provider');
    expect(queue).toContain(
      'tests/specs/profile/user-profile-esncard-provider.spec.ts',
    );
    expect(queue).toContain('isolated E2E tenant');
    expect(queue).toContain('active `localhost` tenant');
    expect(queue).toContain('TEST-ESN-0001');
    expect(queue).toContain('local review-state drift');
    expect(queue).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps Review Next scoped to the real remaining watchpoints', () => {
    const source = readSource('STABILIZATION.md');
    const reviewNext = source.split('## Review Next\n')[1];

    expect(reviewNext).toContain(
      'first manual in-app Browser queue pass has been completed',
    );
    expect(reviewNext).toContain('deterministic ESNcard provider test');
    expect(reviewNext).toContain('provider add/refresh/remove outcomes');
    expect(reviewNext).toContain('custom-domain');
    expect(reviewNext).toContain('multi-domain onboarding');
    expect(reviewNext).toContain('tenant impersonation');
    expect(reviewNext).toContain('documented deferred scope');
    expect(reviewNext).toContain('Docker-backed');
    expect(reviewNext).toContain('system-Chrome coverage');
    expect(reviewNext).toContain('manual Browser review pass');
    expect(reviewNext).toContain('visible profile discount-card UX');
    expect(reviewNext).toContain(
      'evidence drift and relaunch-scope watchpoints',
    );
    expect(reviewNext).not.toContain(
      'remaining product and relaunch-scope blockers',
    );
    expect(reviewNext).not.toContain('no active Codex browser pane');
    expect(reviewNext).not.toContain('Transport closed');
    expect(reviewNext).not.toContain('fallback Playwright browser MCP');
    expect(source).not.toContain(
      'Browser walkthrough coverage for anonymous event browsing is enough',
    );
    expect(source).toContain(
      'The first manual in-app Browser walkthrough has now covered the full',
    );
    expect(source).toContain(
      'repeat Browser review should still use the generated `BASE_URL`',
    );
    expect(source).toContain('first in-app Browser queue pass are healthy');
    expect(source).not.toContain(
      'in-app Browser control still times out before manual review can run',
    );
    expect(source).not.toContain('once the local runtime is available');
    expect(source).not.toContain(
      'manual runtime review once in-app Browser navigation is available',
    );
    expect(source).not.toContain(
      'in-app Browser connection still times out during manual global-admin navigation',
    );
    expect(source).not.toContain('Must setup test before interacting');
    expect(source).not.toContain('human Browser pass remains blocked');
    expect(source).not.toContain('visible profile UX review remains blocked');
    expect(source).not.toContain(
      'lists the Browser-backed coverage still\n' +
        '  needed from the remaining stabilization gaps',
    );
  });

  it('keeps the generated-docs refresh checkpoint tied to current evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current generated-docs refresh checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).not.toMatch(/http:\/\/localhost:\d+/u);
    expect(checkpoint).toContain('29 passed (3.7m)');
    expect(checkpoint).toContain('17 generated pages and 57 screenshots');
    expect(checkpoint).toContain(
      'intentionally quoted\n  `User: understanding unlisted events` title',
    );
    expect(checkpoint).toContain('global-admin product docs\n  stayed absent');
    expect(checkpoint).toContain('no\n  obvious snackbar bars');
    expect(checkpoint).toContain('blank/loading captures');
    expect(checkpoint).toContain('half-transition images');
  });

  it('keeps the PR readiness checkpoint current without pinning stale heads', () => {
    const source = readSource('STABILIZATION.md');
    const dockerCompose = readSource('docker-compose.yml');
    const endToEndWorkflow = readSource('.github/workflows/e2e-baseline.yml');
    const ciStartDockerStackHelper = readSource(
      'helpers/testing/ci-start-docker-stack.sh',
    );
    const packageJson = readSource('package.json');
    const readinessCheckpoint = source.match(
      /Recent PR readiness checkpoint:[\s\S]*?\n\n## Browser Review Queue/u,
    )?.[0];

    expect(readinessCheckpoint).toBeDefined();
    expect(readinessCheckpoint).not.toMatch(/[0-9a-f]{40}/u);
    expect(readinessCheckpoint).toContain('current PR head');
    expect(readinessCheckpoint).toContain('split Playwright E2E matrix');
    expect(readinessCheckpoint).toContain('Playwright E2E (functional-1)');
    expect(readinessCheckpoint).toContain('Playwright E2E (functional-2)');
    expect(readinessCheckpoint).toContain('Playwright E2E (docs)');
    expect(readinessCheckpoint).toMatch(/roughly\s+ten minutes/u);
    expect(readinessCheckpoint).toContain('low-to-high teens');
    expect(readinessCheckpoint).toContain('functional project is sharded');
    expect(readinessCheckpoint).toContain('slower functional shard');
    expect(readinessCheckpoint).toContain('out after 10 minutes');
    expect(readinessCheckpoint).toMatch(/bounded\s+`on-failure` restarts/u);
    expect(readinessCheckpoint).toContain(
      'transient `423 Client Error: Locked`',
    );
    expect(readinessCheckpoint).toContain('180 seconds');
    expect(readinessCheckpoint).toContain('60-second metadata wait');
    expect(readinessCheckpoint).toContain(
      'prints Compose status and service logs',
    );
    expect(readinessCheckpoint).toMatch(
      /generated\s+screenshot\s+stabilization/u,
    );
    expect(readinessCheckpoint).toContain('run in parallel');
    expect(readinessCheckpoint).toMatch(
      /Chromium-only Playwright browser\s+install/u,
    );
    expect(endToEndWorkflow).toContain('timeout-minutes: 25');
    expect(endToEndWorkflow).toContain('NEON_LOCAL_METADATA_WAIT_SECONDS: 180');
    expect(endToEndWorkflow).toContain(
      'chmod 0777 "${NEON_LOCAL_METADATA_DIR}"',
    );
    expect(endToEndWorkflow).toContain('matrix:');
    expect(endToEndWorkflow).toContain(
      'suite: [functional-1, functional-2, docs]',
    );
    expect(endToEndWorkflow).toContain(
      "if: startsWith(matrix.suite, 'functional-')",
    );
    expect(endToEndWorkflow).toContain('--shard=1/2');
    expect(endToEndWorkflow).toContain('--shard=2/2');
    expect(endToEndWorkflow).toContain("if: matrix.suite == 'docs'");
    expect(dockerCompose).toContain('restart: on-failure:5');
    expect(endToEndWorkflow).not.toContain(
      'Neon Local branch startup hit a transient project lock',
    );
    expect(endToEndWorkflow).not.toContain('return 75');
    expect(endToEndWorkflow).toContain(
      'name: playwright-test-results-${{ matrix.suite }}',
    );
    expect(endToEndWorkflow).toContain(
      'run: bash helpers/testing/ci-start-docker-stack.sh',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 5m bun run docker:check',
    );
    expect(ciStartDockerStackHelper).toContain('start_status=$?');
    expect(ciStartDockerStackHelper).toContain('return "${start_status}"');
    expect(endToEndWorkflow).not.toContain('compose_status=$?');
    expect(packageJson).toContain(
      '"docker:start": "bun run docker:check && dotenv -c dev -- docker compose down && dotenv -c dev -- docker compose up --build -d"',
    );
    expect(endToEndWorkflow).not.toContain('docker compose up -d evorto');
    expect(ciStartDockerStackHelper).toContain(
      'db db-expiration db-setup minio minio-init evorto stripe',
    );
    expect(readinessCheckpoint).toMatch(
      /The PR\s+has\s+no\s+unresolved review threads\s+at/u,
    );
    expect(readinessCheckpoint).toMatch(
      /final stabilization cleanup and\s+Browser evidence continue/u,
    );
    expect(readinessCheckpoint).toMatch(
      /formal\s+bot\s+review\s+is\s+expected\s+only\s+after\s+the\s+PR\s+is\s+marked\s+ready/u,
    );
    expect(readinessCheckpoint).not.toContain(
      '9b65634b66840aa72dc53c4a5bef742036f049ac',
    );
    expect(readinessCheckpoint).not.toContain('22m26s');
    expect(readinessCheckpoint).not.toContain(
      'unlisted-admin generated-docs menu retry',
    );
    expect(readinessCheckpoint).not.toContain(
      'Node.js 20 actions are deprecated',
    );
    expect(readinessCheckpoint).not.toContain('workflow-pin update');
    expect(readinessCheckpoint).not.toContain(
      '4cfd4d960f1831055153fab0b3321ed55e937284',
    );
    expect(readinessCheckpoint).not.toContain(
      '0d5c1b74de5db7504f2bd833c2e0859adae1a18d',
    );
    expect(readinessCheckpoint).not.toContain(
      '33b163773afeafd93716a21b52ca253ef273a544',
    );
    expect(readinessCheckpoint).not.toContain(
      '584da0dd32867764716132eb2dcdd0bea3e32869',
    );
    expect(readinessCheckpoint).not.toContain('9m16s');
    expect(readinessCheckpoint).not.toContain('13m31s');
    expect(readinessCheckpoint).not.toContain('7m25s');
    expect(readinessCheckpoint).not.toContain('15m18s');
    expect(readinessCheckpoint).not.toContain(
      '96f3f64351c68b645070a63534c839944ffd5440',
    );
    expect(readinessCheckpoint).not.toContain('16m02s');
    expect(readinessCheckpoint).not.toContain(
      '7b39be0f3a89e1fd14982114e8cbf98a5c59af48',
    );
    expect(readinessCheckpoint).not.toContain(
      'fe3c4a669d444b643dbddd6aefea226574d7673d',
    );
    expect(readinessCheckpoint).not.toContain(
      'in-app Browser manual pass is still blocked',
    );
    expect(readinessCheckpoint).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('opts GitHub JavaScript actions into the Node 24 runtime before the hosted runner cutover', () => {
    const workflowPaths = listFiles('.github/workflows', '.yml').filter(
      (workflowPath) => {
        const workflowSource = readSource(workflowPath);
        return /uses:\s+actions\/(?:checkout|upload-artifact)@/u.test(
          workflowSource,
        );
      },
    );

    expect(workflowPaths).toContain('.github/workflows/e2e-baseline.yml');
    for (const workflowPath of workflowPaths) {
      expect(readSource(workflowPath), workflowPath).toContain(
        'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true',
      );
    }
  });

  it('keeps paid transfer and direct resale aligned with checkout refund completion', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const architecture = readSource('ARCHITECTURE.md');
    const webhook = readSource('src/server/http/stripe-webhook.web-handler.ts');
    const eventDetailsTemplate = readSource(
      'src/app/events/event-details/event-details.component.html',
    );
    const organizerTransferDialog = readSource(
      'src/app/events/event-organize/registration-transfer-dialog.component.html',
    );
    const webhookReplay = readSource(
      'tests/specs/finance/stripe-webhook-replay.spec.ts',
    );

    expect(source).toContain('Paid transfer/resale money movement');
    expect(source).toContain(
      'product-defined Stripe Checkout replacement and refund workflow',
    );
    expect(product).toContain(
      'A participant should be able to transfer or resell a registration through Evorto.',
    );
    expect(product).toContain(
      'New participant completes their registration and payment.',
    );
    expect(product).toContain(
      "Existing participant's registration is cancelled.",
    );
    expect(product).toContain(
      'Existing participant receives a refund through Stripe.',
    );
    expect(architecture).toContain(
      'Stripe is the source of truth for payment state.',
    );
    expect(architecture).toContain('transfer/resale flow');
    expect(source).toContain('fresh Stripe Checkout');
    expect(source).toContain('Decision: Option B, matching `PRODUCT.md`.');
    expect(source).toMatch(
      /cover the product-defined direct transfer\/resale workflow;\s+public resale\s+listing marketplaces remain outside relaunch scope/u,
    );
    expect(webhook).toContain(
      'Failed to create Stripe refund for transferred registration',
    );
    expect(webhook).toContain('insertPendingTransferRefundRecord');
    expect(eventDetailsTemplate).toContain('the source refund path');
    expect(organizerTransferDialog).toContain(
      'registrations use transfer codes for replacement checkout and source',
    );
    expect(webhookReplay).toContain('refundAmount: -2500');
    expect(webhookReplay).toContain('refundManuallyCreated: true');
    expect(source).not.toContain(
      'original-registration refund completion and resale-specific workflows still require follow-up',
    );
    expect(source).not.toContain('resale-specific workflows still need');
  });

  it('keeps the Playwright inventory clear about watchlist versus blockers', () => {
    const source = readSource('tests/test-inventory.md');

    expect(source).toContain('## Stabilization Coverage Watchlist');
    expect(source).not.toContain('## Stabilization Coverage Still Needed');
    expect(source).toContain(
      'Most are now covered by deterministic specs, generated docs, or source guards',
    );
    expect(source).toContain(
      'first in-app Browser manual review queue pass has now covered',
    );
    expect(source).toMatch(
      /satisfying the product-defined direct transfer or\s+resale workflow\.\s+Public resale listing marketplaces remain outside relaunch\s+scope/u,
    );
    expect(source).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps finance docs in the baseline docs project', () => {
    const stabilization = readSource('STABILIZATION.md');
    const playwrightConfig = readSource('playwright.config.ts');
    const inventory = readSource('tests/test-inventory.md');

    expect(stabilization).toContain('Finance docs in CI baseline');
    expect(stabilization).toContain('Decision: Option B.');
    expect(stabilization).toContain(
      'Finance docs are product-facing relaunch coverage',
    );
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /docs\/.*\.doc\.ts$/`,
    );
    expect(playwrightConfig).not.toMatch(
      /docs-baseline[\s\S]*testIgnore:[\s\S]*finance/u,
    );
    expect(inventory).toContain('docs/finance/finance-overview.doc.ts');
    expect(inventory).toContain(
      'docs/finance/receipt-review-reimbursement.doc.ts',
    );
  });

  it('keeps quality guidance honest about blocked Browser review', () => {
    const source = readSource('QUALITY.md');

    expect(source).toContain('If Browser is unavailable because the plugin');
    expect(source).toMatch(/control transport is not\s+healthy/u);
    expect(source).toMatch(
      /Do not treat Playwright, screenshots, or system Chrome as a\s+substitute for a requested in-app Browser walkthrough\./u,
    );
    expect(source).toMatch(
      /If Browser could not be used, name the blocker and summarize the fallback\s+validation separately\./u,
    );
  });

  it('keeps scanner camera fallback actions readable', () => {
    const template = readSource(
      'src/app/scanning/scanner/scanner.component.html',
    );
    const source = readSource('STABILIZATION.md');

    expect(template).toContain('bg-error-container text-on-error-container');
    expect(template).toContain(
      'border-on-error-container text-on-error-container',
    );
    expect(template).toContain('role="alert"');
    expect(template).toContain('Try camera again');
    expect(source).toMatch(
      /scanner\s+error state now uses the error-container surface/u,
    );
  });

  it('keeps app code on TanStack Query boolean status narrowing', () => {
    const sourceFiles = [
      ...listFiles('src/app', '.html'),
      ...listFiles('src/app', '.ts'),
    ];

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /\b\w+Query\.status\(\)\s*(?:={2,3}|!={1,2})\s*["'](?:pending|success|error)["']/u,
      );
    }
  });

  it('keeps app templates away from TanStack Query data alias narrowing', () => {
    const sourceFiles = listFiles('src/app', '.html');

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /@if\s*\([^)]*\b\w+Query\.data\(\)\s*;\s*as\s+\w+/u,
      );
    }
  });
});
