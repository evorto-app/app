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
    expect(queue).toContain('tests/docs/admin/global-admin.doc.ts');
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

  it('keeps create-from-template coverage aligned with reusable add-ons and questions', () => {
    const source = readSource('STABILIZATION.md');
    const inventory = readSource('tests/test-inventory.md');
    const eventSpec = readSource('tests/specs/events/events.test.ts');
    const templateDocumentation = readSource(
      'tests/docs/templates/templates.doc.ts',
    );
    const templateSpec = readSource('tests/specs/templates/templates.test.ts');
    const seedSpec = readSource('tests/specs/seed/seed-baseline.test.ts');
    const createEventMapperSpec = readSource(
      'src/app/templates/template-create-event/template-create-event.mapper.spec.ts',
    );
    const createEventComponentSpec = readSource(
      'src/app/templates/template-create-event/template-create-event.component.spec.ts',
    );
    const simpleTemplateServiceSpec = readSource(
      'src/server/effect/rpc/handlers/templates/simple-template.service.spec.ts',
    );
    const templateRpcSchemaSpec = readSource(
      'src/server/effect/rpc/handlers/templates/templates-rpcs.schema.spec.ts',
    );
    const reviewNext = source.slice(source.indexOf('## Review Next'));

    expect(templateDocumentation).toContain('#### Reusable add-ons');
    expect(templateDocumentation).toContain('#### Registration questions');
    expect(templateDocumentation).toContain(
      'Expected template docs flow to persist the reusable add-on',
    );
    expect(templateDocumentation).toContain(
      'Expected template docs flow to persist the registration question',
    );
    expect(templateSpec).toContain(
      'create template with reusable add-ons and registration questions',
    );
    expect(templateSpec).toContain(
      'Expected reusable add-on registration option attachment',
    );
    expect(templateSpec).toContain(
      'Expected reusable registration question to be persisted',
    );
    expect(seedSpec).toContain('seededAddOns.length');
    expect(seedSpec).toContain('seededQuestions.length');
    expect(createEventMapperSpec).toContain(
      'preserving source option ids for server-side copying',
    );
    expect(createEventMapperSpec).toContain(
      "expect('addOns' in model).toBe(false)",
    );
    expect(createEventComponentSpec).toContain(
      'keeps the create-event add-on boundary explicit',
    );
    expect(createEventComponentSpec).toContain(
      'standalone before-event and during-event add-on sales are not available yet',
    );
    expect(simpleTemplateServiceSpec).toContain(
      'builds reusable template add-on inserts from simple add-on input',
    );
    expect(simpleTemplateServiceSpec).toContain(
      'attaches reusable add-ons to the selected simple registration option kind',
    );
    expect(templateRpcSchemaSpec).toContain(
      'accepts optional registration questions in simple template writes and find-one responses',
    );
    expect(templateRpcSchemaSpec).toContain(
      'rejects reusable add-ons without a simple registration option target',
    );
    expect(eventSpec).toContain('templateEventAddons.findFirst');
    expect(eventSpec).toContain('addonToTemplateRegistrationOptions.findFirst');
    expect(eventSpec).toContain('templateRegistrationQuestions.findFirst');
    expect(eventSpec).toContain('eventAddons.findFirst');
    expect(eventSpec).toContain('addonToEventRegistrationOptions.findFirst');
    expect(eventSpec).toContain('eventRegistrationQuestions.findFirst');
    expect(eventSpec).toContain('sourceTemplateQuestionId');
    expect(eventSpec).toContain(
      'Expected template add-on to be copied to created event',
    );
    expect(inventory).toContain('event create-from-template coverage checks');
    expect(inventory).toContain('copied reusable add-ons');
    expect(inventory).toContain('sourceTemplateQuestionId');
    expect(inventory).toContain('reusable add-on/question Review Next');
    expect(inventory).toContain('server RPC helper/schema coverage');
    expect(source).toContain('Event-creation template add-on/question pass');
    expect(source).toContain('Source coverage ties that Review\nNext claim');
    expect(source).toContain('server RPC helper/schema coverage');
    expect(reviewNext).toContain(
      'page-backed create-event flow now assert that reusable add-ons and questions',
    );
  });

  it('keeps generated-doc publishing explicit and list discovery non-mutating', () => {
    const source = readSource('STABILIZATION.md');
    const inventory = readSource('tests/test-inventory.md');
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts: Record<string, string>;
    };
    const rootAgents = readSource('AGENTS.md');
    const testsReadme = readSource('tests/README.md');
    const documentationReporter = readSource(
      'tests/support/reporters/documentation-reporter.ts',
    );
    const reviewNext = source.match(/## Review Next[\s\S]*$/u)?.[0];

    expect(reviewNext).toBeDefined();
    expect(reviewNext).toContain(
      'Normal generated docs output now stays local',
    );
    expect(reviewNext).toContain('test:e2e:docs:publish');
    expect(source).toContain(
      'Normal local docs output now stays in this repository',
    );
    expect(source).toContain('test-results/docs');
    expect(source).toContain('bun run test:e2e:reporter-paths');
    expect(source).toContain(
      'Publishing into the sibling documentation checkout',
    );
    expect(source).toContain('bun run test:e2e:docs:publish');
    expect(testsReadme).toContain(
      'Playwright list/discovery commands do not clean or write generated docs',
    );
    expect(rootAgents).toContain(
      'Local Playwright package scripts that run `playwright test`',
    );
    expect(rootAgents).toContain('`test:e2e:docs:publish`');
    expect(testsReadme).toContain(
      'Local Playwright package scripts that run `playwright test`',
    );
    expect(testsReadme).toContain('test-results/docs');
    expect(testsReadme).toContain('bun run test:e2e:docs:publish');
    expect(inventory).toContain(
      'Playwright `--list` discovery does not clean or write generated docs output',
    );
    for (const scriptName of [
      'test:e2e',
      'test:e2e:ui',
      'test:e2e:integration',
      'test:e2e:create-account',
      'test:e2e:esncard-provider',
      'test:e2e:authenticated-viewports',
      'test:e2e:mcp-browser-planner',
      'test:e2e:mcp-browser-authenticated-planner',
      'test:e2e:layout-helper',
      'test:e2e:public-general-viewports',
      'test:e2e:reporter-paths',
      'test:e2e:doc-screenshot',
      'test:e2e:docs',
    ]) {
      expect(packageJson.scripts[scriptName]).toContain(
        'bun helpers/testing/run-playwright.ts',
      );
      expect(packageJson.scripts[scriptName]).not.toContain(
        'bun run env:runtime',
      );
      expect(packageJson.scripts[scriptName]).not.toContain('DOCS_OUT_DIR=');
      expect(packageJson.scripts[scriptName]).not.toContain(
        'DOCS_IMG_OUT_DIR=',
      );
      expect(packageJson.scripts[scriptName]).not.toContain('dotenv -c dev --');
    }
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "DOCS_OUT_DIR: 'test-results/docs'",
    );
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "DOCS_IMG_OUT_DIR: 'test-results/docs/images'",
    );
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "spawn('bun', ['run', 'env:runtime']",
    );
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "'node_modules/.bin/dotenv'",
    );
    expect(readSource('helpers/testing/run-playwright.spec.ts')).toContain(
      'runs Playwright through dotenv with local generated-doc output paths',
    );
    expect(readSource('helpers/testing/run-playwright.spec.ts')).toContain(
      'does not run Playwright when the runtime environment refresh fails',
    );
    expect(packageJson.scripts['test:e2e:reporter-paths']).toContain(
      '--no-webserver',
    );
    expect(packageJson.scripts['test:e2e:docs:publish']).toContain(
      'DOCS_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(packageJson.scripts['test:e2e:docs:publish']).toContain(
      'DOCS_IMG_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/public/docs',
    );
    expect(documentationReporter).toContain('private get listOnly(): boolean');
    expect(documentationReporter).toContain(
      "return this.options.listOnly ?? process.argv.includes('--list');",
    );
    expect(documentationReporter).toContain('if (this.listOnly)');
    expect(documentationReporter).toContain('return;');
  });

  it('keeps the latest Browser route checkpoint tied to in-app Browser evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Browser route checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('in-app Browser selected the `iab` tab');
    expect(checkpoint).toContain('/events');
    expect(checkpoint).toContain('seeded event cards');
    expect(checkpoint).toContain('Soccer Match 1');
    expect(checkpoint).toContain('event header');
    expect(checkpoint).toContain('participant registration card');
    expect(checkpoint).toContain('inclusive VAT label');
    expect(checkpoint).toContain('payment CTA');
    expect(checkpoint).toContain(
      'Browser console warning/error logs were\n  empty',
    );
    expect(checkpoint).toContain('list and detail checks');
    expect(checkpoint).not.toContain('system Chrome');
    expect(checkpoint).not.toContain('standalone Playwright');
    expect(checkpoint).not.toContain('transport setup');
    expect(checkpoint).not.toContain('Transport closed');
  });

  it('keeps the latest Browser template-denial checkpoint tied to the guarded shell', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Browser template-denial checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('regular-user in-app Browser');
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('/templates');
    expect(checkpoint).toContain('/403?originalPath=%2Ftemplates');
    expect(checkpoint).toContain('not-allowed page');
    expect(checkpoint).toContain('Missing required permission');
    expect(checkpoint).toContain('stayed absent from the rendered page');
    expect(checkpoint).toContain('Browser warning/error logs were empty');
    expect(checkpoint).toContain('template overview access');
    expect(checkpoint).toContain('durable regression\n  check');
    expect(checkpoint).not.toContain('reproduced the old template shell');
    expect(checkpoint).not.toContain('failing later at the RPC boundary');
  });

  it('keeps Review Next scoped to the real remaining watchpoints', () => {
    const source = readSource('STABILIZATION.md');
    const quality = readSource('QUALITY.md');
    const authenticationSetup = readSource(
      'tests/setup/authentication.setup.ts',
    );
    const testInventory = readSource('tests/test-inventory.md');
    const testsReadme = readSource('tests/README.md');
    const reviewNext = source.split('## Review Next\n')[1];
    const normalizedReviewNext = normalizeWhitespace(reviewNext);

    expect(reviewNext).toContain(
      'first manual in-app Browser queue pass has been completed',
    );
    expect(normalizedReviewNext).toContain('Historical Docker recovery');
    expect(normalizedReviewNext).toContain(
      'Docker start-path blockers, and unhealthy-container cleanup evidence remain recorded as diagnostics',
    );
    expect(normalizedReviewNext).toContain(
      'later current-state Browser evidence supersedes the stale blocked summary',
    );
    expect(normalizedReviewNext).not.toContain(
      'fresh current-head Browser route/mobile layout evidence is currently blocked',
    );
    expect(normalizedReviewNext).not.toContain(
      'unhealthy generated `evorto-4dddca18-db-1`',
    );
    expect(normalizedReviewNext).not.toMatch(
      /generated project can be shut down cleanly/u,
    );
    expect(normalizedReviewNext).not.toContain('Docker Desktop is restarted');
    expect(normalizedReviewNext).toContain(
      'The latest local public General viewport Playwright browser sweep passed',
    );
    expect(normalizedReviewNext).toContain(
      'direct in-app Browser tab API also rechecked the full anonymous General route set',
    );
    expect(normalizedReviewNext).toContain(
      '320x740, 390x844, and 1440x900 on local head `1ab95b1c5`',
    );
    expect(normalizedReviewNext).toContain(
      'no horizontal overflow, clipped controls, rendered application-error text, or Browser console errors',
    );
    expect(normalizedReviewNext).toContain(
      'durable public General viewport spec reran against the same Docker app',
    );
    expect(normalizedReviewNext).toContain(
      'fresh focused in-app Browser mobile refresh at local head `a2c1d2e70`',
    );
    expect(normalizedReviewNext).toContain(
      'rechecked all anonymous General routes at 320x740 and 390x844',
    );
    expect(normalizedReviewNext).toContain(
      'no horizontal overflow, clipped visible controls, rendered application-error text, or Browser warning/error log failures',
    );
    expect(normalizedReviewNext).toContain(
      'fresh current-head direct in-app Browser sweep at local head `6b975474c`',
    );
    expect(normalizedReviewNext).toContain(
      'rechecked all anonymous General routes at 320x740, 390x844, and 1440x900',
    );
    expect(normalizedReviewNext).toContain(
      'no horizontal overflow, top/side clipped visible controls, rendered application-error text, or Browser warning/error logs',
    );
    expect(normalizedReviewNext).toContain(
      '390x844 event-list screenshot showed readable Material cards and fixed mobile bottom navigation fitting without overlap',
    );
    expect(normalizedReviewNext).toContain(
      'bottom-edge event-card continuation classified as normal scroll content',
    );
    expect(normalizedReviewNext).toContain(
      'current authenticated in-app Browser probe',
    );
    expect(normalizedReviewNext).toContain('local head `c0c83ce2b`');
    expect(normalizedReviewNext).toContain(
      'checked `/admin/settings`, `/global-admin/tenants`, and `/profile`',
    );
    expect(normalizedReviewNext).toContain('320x740, 390x844, and 1440x900');
    expect(normalizedReviewNext).toContain(
      'no Auth0 redirect, horizontal overflow, clipped visible controls, rendered application-error text, or Browser warning/error logs',
    );
    expect(normalizedReviewNext).toContain(
      'fresh current-head Browser refresh at PR head `fb77d966c`',
    );
    expect(normalizedReviewNext).toContain(
      'reopened `/events` at 320x740 and `/legal/terms`, `/legal/privacy`, and `/404` at 390x844',
    );
    expect(normalizedReviewNext).toContain(
      'Events console output contained only app info logs',
    );
    expect(normalizedReviewNext).toContain(
      'Playwright config now uses the repo runtime config provider',
    );
    expect(normalizedReviewNext).toContain(
      'real environment variables still taking precedence',
    );
    expect(normalizedReviewNext).toContain(
      'env -u DATABASE_URL -u BASE_URL -u APP_HOST_PORT -u COMPOSE_PROJECT_NAME -u NEON_LOCAL_HOST_PORT bunx playwright test --list',
    );
    expect(normalizedReviewNext).toContain(
      'prior `DATABASE_URL`-undefined config-import blocker is fixed',
    );
    expect(normalizedReviewNext).toContain(
      'base Playwright fixture now uses the same runtime config provider',
    );
    expect(normalizedReviewNext).toContain(
      'bridges the validated `STRIPE_TEST_ACCOUNT_ID` into `process.env`',
    );
    expect(normalizedReviewNext).toContain('mcp-browser-planner');
    expect(normalizedReviewNext).toContain('tests/setup/mcp-browser.seed.ts');
    expect(normalizedReviewNext).toContain(
      'bunx playwright test --project=mcp-browser-planner --no-deps tests/setup/mcp-browser.seed.ts --reporter=line',
    );
    expect(normalizedReviewNext).toContain(
      'Playwright-test Browser planner setup now recognizes that project/seed pair',
    );
    expect(normalizedReviewNext).toContain('opens the seeded `/legal/terms`');
    expect(normalizedReviewNext).toContain('resizes it to 320x740');
    expect(normalizedReviewNext).toContain(
      'mcp-browser-planner-terms-mobile.png',
    );
    expect(normalizedReviewNext).toContain('mcp-browser-authenticated-planner');
    expect(normalizedReviewNext).toContain(
      'tests/setup/mcp-browser-authenticated.seed.ts',
    );
    expect(normalizedReviewNext).toContain(
      'normal database/auth setup and open `/admin/settings`, `/global-admin/tenants`, and `/profile`',
    );
    expect(normalizedReviewNext).toContain(
      'bun run test:e2e:mcp-browser-authenticated-planner',
    );
    expect(normalizedReviewNext).toContain(
      'logged-in starting points without running the full authenticated viewport pack',
    );
    expect(normalizedReviewNext).toContain('Callback URL mismatch.');
    expect(normalizedReviewNext).toContain(
      'reports the evaluated `BASE_URL`, `APP_HOST_PORT`, and current Auth0 URL',
    );
    expect(authenticationSetup).toContain('Callback URL mismatch.');
    expect(authenticationSetup).toContain(
      'Auth0 rejected the local login callback for BASE_URL=',
    );
    expect(authenticationSetup).toContain("process.env['APP_HOST_PORT']");
    expect(authenticationSetup).toContain('Current Auth0 URL: ${page.url()}');
    expect(authenticationSetup).toContain('waitForAuth0UsernameInput(page)');
    expect(testsReadme).toContain(
      'Auth0 callback URLs are registered out-of-band',
    );
    expect(testsReadme).toContain('APP_HOST_PORT=4200 bun run docker:start');
    expect(testsReadme).toContain('Callback URL mismatch.');
    expect(testInventory).toContain('Callback URL mismatch.');
    expect(normalizedReviewNext).not.toContain('Browser setup recovery');
    expect(normalizedReviewNext).toContain(
      'evidence drift, relaunch-scope watchpoints, and richer authenticated Browser evidence',
    );
    expect(normalizedReviewNext).not.toContain(
      'MCP server process reload/initialization',
    );
    expect(normalizedReviewNext).not.toContain(
      'generated Compose project has no running app container',
    );
    expect(reviewNext).not.toContain(
      'older port-4200 app container belongs to another worktree',
    );
    expect(quality).toContain('record the Browser\nblocker explicitly');
    expect(quality).toContain(
      'Do not treat Playwright, screenshots, or system Chrome as a\nsubstitute for a requested in-app Browser walkthrough.',
    );
    expect(reviewNext).toMatch(/deterministic ESNcard\s+provider test/u);
    expect(reviewNext).toMatch(/Provider\s+add\/refresh\/remove\s+outcomes/u);
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
    expect(
      readSource('helpers/testing/generated-documentation-source.spec.ts'),
    ).toContain('helpers/testing/run-playwright.ts');
    expect(
      readSource('helpers/testing/generated-documentation-source.spec.ts'),
    ).toContain(
      '/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(reviewNext).toContain('durable email outbox rows');
    expect(reviewNext).toContain('receiptReviewed');
    expect(reviewNext).toContain('Resend-backed dispatcher');
    expect(reviewNext).toContain('homeTenantId');
    expect(reviewNext).toContain('communicationEmail');
    expect(reviewNext).toContain('notification-email rendering');
    expect(reviewNext).toContain('operations-policy settings');
    expect(reviewNext).toContain('registration limits');
    expect(reviewNext).toContain('Stripe account management');
    expect(reviewNext).toMatch(/evidence\s+drift, relaunch-scope/u);
    expect(normalizedReviewNext).toMatch(
      /richer authenticated Browser evidence/u,
    );
    expect(source).toContain('Current relaunch-scope Browser checkpoint');
    expect(source).toContain(
      'stabilizationEvidence=relaunch-scope-browser-fixed-*',
    );
    expect(source).toContain('Primary domain hint');
    expect(source).toContain('/tmp/evorto-relaunch-scope-20260604-mobile.jpg');
    expect(source).toContain('local head\n  `c0c83ce2b`');
    expect(source).toContain('`/admin/settings`, `/global-admin/tenants`');
    expect(source).toContain('seeded global-admin profile');
    expect(source).toMatch(/All nine route\/viewport checks reported/u);
    expect(source).toMatch(/zero Browser warning\/error logs/u);
    expect(source).toContain('320x740 `/admin/settings` screenshot');
    expect(source).toContain(
      '/tmp/evorto-auth-surfaces-20260604-320-admin-settings.png',
    );
    expect(
      readSource('helpers/testing/relaunch-scope-source.spec.ts'),
    ).toContain(
      'keeps the tenant-domain relaunch boundary aligned across docs and UI',
    );
    expect(
      readSource('helpers/testing/relaunch-scope-source.spec.ts'),
    ).toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(
      readSource('helpers/testing/relaunch-scope-source.spec.ts'),
    ).toContain(
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    );
    expect(reviewNext).not.toContain('become events. Normal generated docs');
    expect(reviewNext).not.toContain(
      'normal generated docs output is published by default',
    );
    expect(reviewNext).not.toContain('custom-domain automation is implemented');
    expect(reviewNext).not.toContain('tenant impersonation is implemented');
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
    expect(source).toContain('first in-app Browser queue pass');
    expect(source).toContain('Current Browser runtime evidence');
    expect(source).toContain(
      'Browser plugin Node-backed in-app Browser\n  runtime',
    );
    expect(source).toContain('generated `.env.dev` `BASE_URL`');
    expect(source).toContain(
      'prints the non-secret generated `BASE_URL`, `COMPOSE_PROJECT_NAME`, and `NEON_LOCAL_HOST_PORT`',
    );
    expect(source).toContain('without ad hoc shell `dotenv` probes');
    expect(source).toContain('/events` route');
    expect(source).toContain('`Upcoming Events`\n  tenant feed');
    expect(source).toContain('public event-link DOM snapshots');
    expect(source).toContain('public Font Awesome install paths');
    expect(source).toContain('sets a two-hour Neon Local branch TTL');
    expect(source).toContain(
      'timeout-bounds project-label discovery and force-removal for leftover Compose containers',
    );
    expect(source).not.toContain(
      'current CI and local Docker build/start validation remain blocked before app startup by an invalid Font Awesome registry token',
    );
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
    const inventory = readSource('tests/test-inventory.md');
    const generatedDocumentationSource = readSource(
      'helpers/testing/generated-documentation-source.spec.ts',
    );
    const reporterAttachmentsSource = readSource(
      'tests/support/reporters/documentation-reporter/attachments.ts',
    );
    const reporterPathsSpec = readSource(
      'tests/specs/reporting/reporter-paths.test.ts',
    );
    const documentationScreenshotSpec = readSource(
      'tests/specs/screenshot/doc-screenshot.test.ts',
    );
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current generated-docs refresh checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).not.toMatch(/http:\/\/localhost:\d+/u);
    expect(checkpoint).toContain('29 passed (3.7m)');
    expect(checkpoint).toContain('17\n  generated pages and 57 screenshots');
    expect(checkpoint).toContain(
      'intentionally quoted\n  `User: understanding unlisted events` title',
    );
    expect(checkpoint).toContain(
      'current global-admin\n  generated-doc source',
    );
    expect(checkpoint).toContain('six pinned screenshot-backed states');
    expect(checkpoint).toContain(
      'unrelated unlisted-admin product\n  docs stay absent',
    );
    expect(checkpoint).toContain('no obvious snackbar bars');
    expect(checkpoint).toContain('blank/loading captures');
    expect(checkpoint).toMatch(/half-transition\s+images/u);
    expect(source).toContain('captioned figure\n  output');
    expect(source).toContain('uncaptioned raw markdown image');
    expect(source).toContain('misplaced caption');
    expect(source).toContain('escaped caption attributes');
    expect(documentationScreenshotSpec).toContain(
      'doc-screenshot waits for descriptive loading text before capture',
    );
    expect(documentationScreenshotSpec).toContain(
      'doc-screenshot waits for finite transitions before capture',
    );
    expect(documentationScreenshotSpec).toContain(
      'doc-screenshot waits for transient snackbars before capture',
    );
    expect(documentationScreenshotSpec).toContain(
      'doc-screenshot does not fail on persistent snackbars',
    );
    expect(documentationScreenshotSpec).toContain(
      'doc-screenshot waits for stable target bounds before capture',
    );
    expect(source).toContain('docs screenshot-stability checkpoint');
    expect(source).toContain('target locator bounds to stabilize');
    expect(source).toContain('RAF-polled synchronous geometry snapshots');
    expect(source).toContain('without introducing fixed timeout sleeps');
    expect(source).toContain('generated-doc evidence-quality rules');
    expect(source).toContain(
      'generated-docs evidence-quality guard checkpoint',
    );
    expect(source).toContain('explanatory markdown');
    expect(source).toContain('shared\n  highlighted screenshot helper');
    expect(source).toContain('documentation reporter barrel');
    expect(source).toContain('literal');
    expect(source).toContain('screenshot caption');
    expect(source).toContain('at least four words');
    expect(source).toMatch(/terse\s+section\/list label/u);
    expect(source).toContain('captured image');
    expect(source).toContain('highlighted focus-target\n  pixels');
    expect(source).toContain('proves');
    expect(source).toContain('generic page-root screenshot targets');
    expect(source).toContain('aliased\ngeneric shell locator targets');
    expect(source).toContain(
      'helper functions returning generic shell\nlocators',
    );
    expect(source).toContain(
      'unfiltered broad `section`, `article`, `form`, and `app-*`',
    );
    expect(source).toContain('aliased broad locator targets');
    expect(source).toContain(
      'Helper functions returning unfiltered\nbroad locators are rejected',
    );
    expect(source).toContain('direct single-control `getByRole`');
    expect(source).toContain('`getByPlaceholder` screenshot targets');
    expect(source).toContain('single-control CSS locator targets');
    expect(source).toContain('Single-option ARIA targets');
    expect(source).toContain(
      'single-control-looking test-id screenshot targets',
    );
    expect(source).toContain('getByTestId');
    expect(source).toContain('helper-returned targets');
    expect(source).toContain('ARIA role selectors');
    expect(source).toContain('Material control hosts');
    expect(source).toContain('icon-only and media-only screenshot targets');
    expect(source).toContain("getByRole('img')");
    expect(source).toContain('direct icon/media screenshot targets');
    expect(source).toContain('target arrays');
    expect(source).toContain('aliased `takeScreenshot` imports');
    expect(source).toMatch(/local screenshot\s+wrapper declarations/u);
    expect(source).toContain('Synthetic failing examples');
    expect(source).toContain('app-root');
    expect(source).toContain('tests/docs/roles/about-permissions.doc.ts');
    expect(source).toContain('PERMISSION_GROUPS');
    expect(inventory).toContain('current 16 documentation source files');
    expect(inventory).toContain(
      'at least 120 characters of explanatory markdown',
    );
    expect(inventory).toMatch(/pins the current per-flow\s+screenshot counts/u);
    expect(inventory).toContain(
      'manifest that must include every image-backed docs',
    );
    expect(inventory).toContain('quietly drop image-backed states');
    expect(inventory).toContain('shared `takeScreenshot` helper');
    expect(inventory).toMatch(/documentation\s+reporter\s+barrel/u);
    expect(inventory).toContain('meaningful literal caption');
    expect(inventory).toContain('at least 24 characters and four words');
    expect(inventory).toMatch(/terse\s+section\/list labels/u);
    expect(inventory).toMatch(/generic page-root\s+screenshot targets/u);
    expect(inventory).toContain(
      'aliased generic locators and\n  helper-returned generic locators inside screenshot arguments and arrays',
    );
    expect(inventory).toContain(
      'unfiltered broad `section`, `article`, `form`, and `app-*`\n  component-host screenshot targets',
    );
    expect(inventory).toContain(
      'aliased broad locators and\n  helper-returned broad locators inside screenshot arguments and arrays',
    );
    expect(inventory).toMatch(/role\/text\/label\/placeholder\s+locators/u);
    expect(inventory).toContain('single-control CSS locator targets');
    expect(inventory).toContain('helper-returned single-control locators');
    expect(inventory).toContain('single-option ARIA targets');
    expect(inventory).toContain('ARIA role selectors');
    expect(inventory).toContain('Material control hosts/classes');
    expect(inventory).toMatch(/single-control-looking\s+`getByTestId`/u);
    expect(inventory).toContain("getByRole('img')");
    expect(inventory).toMatch(/icon\/media targets such as `svg`/u);
    expect(inventory).toMatch(
      /target arrays\s+and helper-returned icon\/media locators/u,
    );
    expect(inventory).toContain('helper-internal screenshot imports');
    expect(inventory).toMatch(/local screenshot\s+wrappers/u);
    expect(inventory).toContain('self-tests those bypass examples');
    expect(inventory).toContain('weak-caption');
    expect(inventory).toContain('missing-highlight');
    expect(inventory).toContain('uncaptioned image attachments');
    expect(inventory).toContain('orphan image-caption attachments');
    expect(inventory).toContain('runtime');
    expect(inventory).toContain('failure');
    expect(inventory).toContain('rejects');
    expect(inventory).toContain('raw');
    expect(inventory).toContain('`page.screenshot` calls');
    expect(inventory).toContain('generated `{% figure %}` blocks');
    expect(inventory).toContain('escapes caption attributes');
    expect(inventory).toContain(
      'only text-only\n  permission-reference exception',
    );
    expect(generatedDocumentationSource).toContain(
      'keeps generated documentation pages explanatory and image-backed',
    );
    expect(generatedDocumentationSource).toContain(
      'keeps product-important documentation areas represented by generated docs',
    );
    expect(generatedDocumentationSource).toContain(
      'imageBackedDocumentationAreas',
    );
    expect(generatedDocumentationSource).toContain(
      'creating an event from a template',
    );
    expect(generatedDocumentationSource).toContain(
      'configuring roles and capabilities',
    );
    expect(generatedDocumentationSource).toContain('legal/privacy settings');
    expect(generatedDocumentationSource).toContain(
      'expect(documentFiles.length).toBe(16)',
    );
    expect(generatedDocumentationSource).toContain('markdownTextLength');
    expect(generatedDocumentationSource).toContain(
      'toBeGreaterThanOrEqual(120)',
    );
    expect(generatedDocumentationSource).toContain('countTakeScreenshotCalls');
    expect(generatedDocumentationSource).toContain('expectedScreenshotCounts');
    expect(generatedDocumentationSource).toContain(
      'expectedImageBackedDocuments',
    );
    expect(generatedDocumentationSource).toContain(
      '[...expectedScreenshotCounts.keys()].toSorted()',
    );
    expect(generatedDocumentationSource).toContain(
      "['tests/docs/events/register.doc.ts', 13]",
    );
    expect(generatedDocumentationSource).toContain(
      "['tests/docs/templates/templates.doc.ts', 8]",
    );
    expect(generatedDocumentationSource).toContain(
      'textOnlyReferenceDocuments',
    );
    expect(generatedDocumentationSource).toContain(
      'tests/docs/roles/about-permissions.doc.ts',
    );
    expect(generatedDocumentationSource).toContain('takeScreenshot(');
    expect(generatedDocumentationSource).toContain('page.screenshot(');
    expect(generatedDocumentationSource).toContain(
      'findWeakScreenshotCaptions',
    );
    expect(generatedDocumentationSource).toContain(
      'importsSharedScreenshotHelper',
    );
    expect(generatedDocumentationSource).toContain(
      'findGenericScreenshotTargets',
    );
    expect(generatedDocumentationSource).toContain(
      'findUnfilteredBroadScreenshotTargets',
    );
    expect(generatedDocumentationSource).toContain('broadTargetAliases');
    expect(generatedDocumentationSource).toContain('broadTargetFunctions');
    expect(generatedDocumentationSource).toContain(
      'returnsUnfilteredBroadLocator',
    );
    expect(generatedDocumentationSource).toContain('broadFormSurface');
    expect(generatedDocumentationSource).toContain('aliasedBroadSection');
    expect(generatedDocumentationSource).toContain(
      'findSingleControlScreenshotTargets',
    );
    expect(generatedDocumentationSource).toContain('singleControlFunctions');
    expect(generatedDocumentationSource).toContain(
      'returnsSingleControlLocator',
    );
    expect(generatedDocumentationSource).toContain('saveButtonSurface');
    expect(generatedDocumentationSource).toContain(
      'findIconOrMediaScreenshotTargets',
    );
    expect(generatedDocumentationSource).toContain('iconOrMediaFunctions');
    expect(generatedDocumentationSource).toContain('returnsIconOrMediaLocator');
    expect(generatedDocumentationSource).toContain('tenantLogoSurface');
    expect(generatedDocumentationSource).toContain(
      'findScreenshotHelperBypasses',
    );
    expect(generatedDocumentationSource).toContain(
      'detects unfiltered broad documentation screenshot targets',
    );
    expect(generatedDocumentationSource).toContain(
      'detects single-control documentation screenshot targets',
    );
    expect(generatedDocumentationSource).toContain(
      'detects icon-only and media-only documentation screenshot targets',
    );
    expect(generatedDocumentationSource).toContain('getByPlaceholder');
    expect(generatedDocumentationSource).toContain(
      'ts.isArrayLiteralExpression(node)',
    );
    expect(generatedDocumentationSource).toContain(
      'detects screenshot helper bypass patterns before generated docs can use them',
    );
    expect(generatedDocumentationSource).toContain(
      'takeScreenshot as grabImage',
    );
    expect(generatedDocumentationSource).toContain('localScreenshot');
    expect(generatedDocumentationSource).toContain(
      'documentation-reporter/take-screenshot',
    );
    expect(generatedDocumentationSource).toContain('genericSelectors');
    expect(generatedDocumentationSource).toContain('genericTargetAliases');
    expect(generatedDocumentationSource).toContain('returnsGenericLocator');
    expect(generatedDocumentationSource).toContain('mainShellSurface');
    expect(generatedDocumentationSource).toContain(
      "'../../support/reporters/documentation-reporter'",
    );
    expect(generatedDocumentationSource).toContain('captionText.length < 24');
    expect(generatedDocumentationSource).toContain('caption: string');
    expect(generatedDocumentationSource).toContain(
      'caption.trim().length < 24',
    );
    expect(generatedDocumentationSource).toContain(
      'Documentation screenshots require a descriptive caption',
    );
    expect(generatedDocumentationSource).toContain(
      "testInfo.attach('image-caption'",
    );
    expect(reporterAttachmentsSource).toContain('escapeAttribute');
    expect(reporterAttachmentsSource).toContain(
      'caption="${escapeAttribute(body.toString())}"',
    );
    expect(reporterAttachmentsSource).toContain('uncaptionedImage');
    expect(reporterAttachmentsSource).toContain(
      'Documentation image attachment in ${test.title} is missing a paired image-caption attachment.',
    );
    expect(reporterAttachmentsSource).toContain(
      'Documentation image-caption attachment in ${test.title} is missing a preceding image attachment.',
    );
    expect(reporterPathsSpec).toContain('{% figure src="');
    expect(reporterPathsSpec).toContain('&quot;active&quot; &amp; pending');
    expect(reporterPathsSpec).toContain(
      'documentation reporter rejects uncaptioned image attachments',
    );
    expect(reporterPathsSpec).toContain(
      'documentation reporter rejects orphan image-caption attachments',
    );
    expect(reporterPathsSpec).toContain(
      'Documentation image attachment in Uncaptioned image is missing a paired image-caption attachment.',
    );
    expect(reporterPathsSpec).toContain(
      'Documentation image-caption attachment in Orphan caption is missing a preceding image attachment.',
    );
    expect(reporterPathsSpec).toContain(
      'documentation screenshot helper rejects weak runtime captions',
    );
    expect(reporterPathsSpec).toContain(
      'Documentation screenshots require a descriptive caption',
    );
    expect(reporterPathsSpec).toContain(
      'documentation screenshot helper captures the highlighted target',
    );
    expect(reporterPathsSpec).toContain(
      'documentation screenshot helper rejects captures without the highlighted target',
    );
    expect(reporterPathsSpec).toContain(
      'Documentation screenshots must include the highlighted focus target',
    );
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
    expect(ciStartDockerStackHelper).toContain(
      'timeout 12m node_modules/.bin/dotenv -c dev -- docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build --progress=plain db-setup evorto',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 5m node_modules/.bin/dotenv -c dev -- docker compose up --no-build -d',
    );
    expect(ciStartDockerStackHelper).toContain('start_status=$?');
    expect(ciStartDockerStackHelper).toContain(
      'Docker Compose build/start timed out before the workflow step timeout',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 90s node_modules/.bin/dotenv -c dev -- docker compose down --timeout 60 --remove-orphans',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 5m node_modules/.bin/dotenv -c dev -- bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(ciStartDockerStackHelper).toContain(
      'docker builder prune -af || true',
    );
    expect(ciStartDockerStackHelper).toContain('bun run docker:ps || true');
    expect(ciStartDockerStackHelper).toContain('return "${start_status}"');
    expect(endToEndWorkflow).not.toContain('compose_status=$?');
    expect(packageJson).toContain(
      '"docker:reset": "bun run docker:check && dotenv -c dev -- docker compose down"',
    );
    expect(packageJson).toContain(
      '"docker:start": "bun run docker:reset && dotenv -c dev -- docker compose up --build -d"',
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
    expect(readinessCheckpoint).not.toContain(
      'current GitHub token is missing',
    );
    expect(readinessCheckpoint).not.toContain('1Password SSH agent');
    expect(readinessCheckpoint).not.toContain('remain local-only');
    expect(readinessCheckpoint).not.toContain('token is refreshed');
    expect(readinessCheckpoint).not.toContain(
      'remote PR head still reports the\n  older docs failure',
    );

    expect(postMainSyncCheckpoint).toBeDefined();
    expect(postMainSyncCheckpoint).toContain('At that older checkpoint');
    expect(postMainSyncCheckpoint).toMatch(
      /remote PR\s+head was aligned with the local branch/u,
    );
    expect(postMainSyncCheckpoint).toContain(
      'later CI reliability commits left\n  the local branch ahead',
    );
    expect(postMainSyncCheckpoint).not.toContain(
      'current PR head is aligned with the local',
    );
    expect(postMainSyncCheckpoint).not.toContain(
      'are now pushed\n  to the PR branch over SSH',
    );
  });

  it('keeps the latest Browser-queue PR checkpoint aligned with pushed remote state', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const ciCheckpoint = queue.match(
      /Current CI Compose alignment checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];
    const checkpoint = queue.match(
      /Earlier readiness refresh checkpoint:[\s\S]*?(?=\n- Current |\n- Earlier |\n\n## Review Next|\n$)/u,
    )?.[0];
    const reviewDriftCheckpoint = queue.match(
      /Current review-drift checkpoint:[\s\S]*?(?=\n- Current |\n- Earlier |\n\n## Review Next|\n$)/u,
    )?.[0];
    const postCiBrowserCheckpoint = queue.match(
      /Current post-CI Browser sanity checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(ciCheckpoint).toBeDefined();
    expect(ciCheckpoint).toContain('keeps the Docker\n  preflight');
    expect(ciCheckpoint).toContain('regular detached Compose start');
    expect(ciCheckpoint).toContain('explicit Compose build');
    expect(ciCheckpoint).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose up --no-build -d',
    );
    expect(ciCheckpoint).toContain('docker builder prune -af');
    expect(ciCheckpoint).toContain(
      'routing through reset-from-zero `bun run docker:start`',
    );
    expect(ciCheckpoint).not.toContain(
      'calls\n  `bun run docker:start` instead',
    );

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('Earlier readiness refresh checkpoint');
    expect(checkpoint).not.toContain('SSH push is working again');
    expect(checkpoint).not.toMatch(
      /PR\s+head is current with the local branch/u,
    );
    expect(checkpoint).toMatch(
      /PR\s+remained draft,\s+mergeable,\s+and merge-blocked/u,
    );
    expect(checkpoint).toContain('mergeable');
    expect(checkpoint).toContain('draft/status state');
    expect(checkpoint).toMatch(/pushed\s+head was not CI-green/u);
    expect(checkpoint).toMatch(/resolves\s+`PARENT_BRANCH_ID`/u);
    expect(checkpoint).toContain('Neon project default/primary branch');
    expect(checkpoint).toContain('GitHub secret is absent');
    expect(checkpoint).toContain(
      'exports the resolved parent into `GITHUB_ENV`',
    );
    expect(checkpoint).toMatch(/fails before\s+Docker/u);
    expect(checkpoint).toContain('Neon API cannot prove a parent branch');
    expect(checkpoint).toContain('ephemeral E2E branch');
    expect(checkpoint).toContain('active project `main` branch');
    expect(checkpoint).toContain('parent-branch secret');
    expect(checkpoint).toContain('GitHub E2E log for that\n  historical head');
    expect(checkpoint).toContain('br-soft-forest-a9khi8e8');
    expect(checkpoint).toContain('ran stale Neon branch cleanup');
    expect(checkpoint).toContain('dependency-install blocker');
    expect(checkpoint).toContain('Copilot');
    expect(checkpoint).toContain('dependency-install');
    expect(checkpoint).toMatch(/private\s+Font Awesome install blocker/u);
    expect(checkpoint).toMatch(/public\s+Font\s+Awesome Free icon exports/u);
    expect(checkpoint).toMatch(/deleting\s+the\s+project `.npmrc`/u);
    expect(checkpoint).toMatch(/removing\s+Font\s+Awesome token setup/u);
    expect(checkpoint).toMatch(/Docker,\s+Compose,\s+Copilot,\s+and E2E/u);
    expect(checkpoint).toContain('CodeQL');
    expect(checkpoint).toContain('CodeRabbit');
    expect(checkpoint).toMatch(/Display\s+the\s+branch\s+stack/u);
    expect(checkpoint).toMatch(/Analyze\s+were green/u);
    expect(checkpoint).toMatch(/without\s+expiration\s+metadata/u);
    expect(checkpoint).toMatch(/two-hour\s+active-test TTL/u);
    expect(checkpoint).not.toContain(
      'Missing required secret: PARENT_BRANCH_ID',
    );
    expect(checkpoint).not.toMatch(/next\s+pushed head should now move past/u);
    expect(checkpoint).toMatch(/exactly one branch,\s+`main`/u);
    expect(checkpoint).toContain('focused runtime-preflight');
    expect(checkpoint).toContain('skip-inventory');
    expect(checkpoint).toContain('stabilization source guards');
    expect(checkpoint).toContain('WebStorm diagnostics');
    expect(checkpoint).toMatch(/attempted in-app\s+Browser `\/events`/u);
    expect(checkpoint).toMatch(/expected database-backed app error/u);
    expect(checkpoint).toContain('connectivity evidence rather than');
    expect(checkpoint).toContain('Later post-push CI evidence superseded');
    expect(checkpoint).toContain('fully green E2E/Copilot/checks head');
    expect(checkpoint).not.toContain(
      'all three split E2E jobs\n  completed successfully',
    );
    expect(checkpoint).not.toContain('next pushed head must prove');
    expect(checkpoint).not.toContain('local advisory-pre-pull commit');
    expect(checkpoint).not.toContain('SSH signing');
    expect(checkpoint).not.toContain('HTTPS `workflow` scope');
    expect(checkpoint).not.toContain('Docker image pre-pull timeout');
    expect(checkpoint).not.toContain('partial GitHub Actions evidence');
    expect(checkpoint).not.toContain('SSH fetch/push still fails');
    expect(checkpoint).not.toContain('workflow-scoped HTTPS push');
    expect(checkpoint).not.toContain('remote PR head remains stale');
    expect(checkpoint).not.toContain('remote PR head remains stale and draft');
    expect(checkpoint).not.toContain('older generated-docs failure');
    expect(checkpoint).not.toContain('communication with agent failed');
    expect(checkpoint).not.toContain('lanes rerunning');

    expect(reviewDriftCheckpoint).toBeDefined();
    expect(reviewDriftCheckpoint).toContain(
      'fresh thread-aware GitHub review-thread',
    );
    expect(reviewDriftCheckpoint).toContain(
      'zero unresolved inline review threads',
    );
    expect(reviewDriftCheckpoint).toContain('no global-admin\n  product docs');
    expect(reviewDriftCheckpoint).toContain(
      'no unquoted colon-bearing YAML frontmatter titles',
    );
    expect(reviewDriftCheckpoint).toContain('PR branch is now aligned');
    expect(reviewDriftCheckpoint).toContain('gh auth setup-git');
    expect(reviewDriftCheckpoint).toContain('HTTPS\n  credential-helper push');
    expect(reviewDriftCheckpoint).toContain('SSH signing failed');
    expect(reviewDriftCheckpoint).not.toContain(
      'communication with agent failed',
    );

    expect(postCiBrowserCheckpoint).toBeDefined();
    expect(postCiBrowserCheckpoint).toContain('adjusted CI startup path');
    expect(postCiBrowserCheckpoint).toContain('generated `BASE_URL`');
    expect(postCiBrowserCheckpoint).toContain('ci-compose-green-refresh');
    expect(postCiBrowserCheckpoint).toContain('Events | Development');
    expect(postCiBrowserCheckpoint).toContain('Soccer Match 1');
    expect(postCiBrowserCheckpoint).toContain(
      'route/content\n  reachability rather than fresh console evidence',
    );

    const credentialCheckpoint = queue.match(
      /Current credential-state Browser refresh checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(credentialCheckpoint).toBeDefined();
    expect(credentialCheckpoint).toContain('pushed and realigned');
    expect(credentialCheckpoint).toContain(
      'GitHub CLI HTTPS credential-helper path',
    );
    expect(credentialCheckpoint).toContain('credential-state-refresh-browser');
    expect(credentialCheckpoint).toContain('review-thread-clean-refresh');
    expect(credentialCheckpoint).toContain('Upcoming Events');
    expect(credentialCheckpoint).toContain(
      'no rendered application error\n  text',
    );
    expect(credentialCheckpoint).toContain(
      'stale `section-app/legacy-app` Apollo\n  warnings',
    );
    expect(credentialCheckpoint).toContain('route/content\n  evidence only');
    expect(credentialCheckpoint).toContain('clean-console evidence');
    expect(credentialCheckpoint).not.toContain(
      'fresh no-console-warning claim',
    );
    expect(credentialCheckpoint).not.toContain('two commits ahead');
    expect(credentialCheckpoint).not.toContain('remote PR head');
    expect(credentialCheckpoint).not.toContain('HTTPS\n  `workflow` scope');
  });

  it('keeps the earlier post-SSH main-sync checkpoint scoped as historical after later pushed commits', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Earlier post-SSH main-sync checkpoint:[\s\S]*?(?=\n- Current |\n- Earlier |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('SSH-backed origin fetch');
    expect(checkpoint).toContain('git town sync --stack');
    expect(checkpoint).toContain('completed without conflicts');
    expect(checkpoint).toContain('`origin/main` was an ancestor');
    expect(checkpoint).not.toContain('local branch is clean');
    expect(checkpoint).not.toContain(
      'aligned with `origin/codex/stabilization-flow-coverage`',
    );
    expect(checkpoint).toMatch(/thread-aware PR review\s+inspection/u);
    expect(checkpoint).toContain('zero review threads');
    expect(checkpoint).toMatch(/GitHub reported the PR as\s+mergeable/u);
    expect(checkpoint).toContain(
      'Later pushed CI follow-up commits supersede this older sync\n  checkpoint',
    );
    expect(checkpoint).toMatch(
      /blocked only because the PR is\s+intentionally still\s+draft/u,
    );
    expect(checkpoint).not.toContain('merge conflict');
    expect(checkpoint).not.toContain('remote PR head remains stale');
    expect(checkpoint).not.toContain('local-only');
    expect(checkpoint).not.toContain('SSH fetch/push still fails');
    expect(checkpoint).not.toContain('workflow-scoped HTTPS push');
  });

  it('keeps the CI dependency-install retry tied to the observed Bun cache failure and public icon installs', () => {
    const source = readSource('STABILIZATION.md');
    const workflow = readSource('.github/workflows/e2e-baseline.yml');
    const copilotSetupWorkflow = readSource(
      '.github/workflows/copilot-setup-steps.yml',
    );
    const packageJson = JSON.parse(readSource('package.json')) as {
      dependencies?: Record<string, string>;
    };
    const lockfile = readSource('bun.lock');
    const bunfig = readSource('bunfig.toml');
    const dockerignore = readSource('.dockerignore');
    const dockerfile = readSource('Dockerfile');
    const fontAwesomeCiHelper = readSource(
      'helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    const ciInstallHelper = readSource(
      'helpers/testing/install-ci-dependencies.sh',
    );
    const composeFile = readSource('docker-compose.yml');
    const ciBuildCacheCompose = readSource(
      '.github/docker-compose.build-cache.yml',
    );
    const ciDependencyCacheAction = readSource(
      '.github/actions/setup-bun-dependency-caches/action.yml',
    );
    const workflowDependencyInstallSources = listFiles(
      '.github/workflows',
      '.yml',
    )
      .filter((workflowPath) =>
        readSource(workflowPath).includes(
          'run: bash helpers/testing/install-ci-dependencies.sh',
        ),
      )
      .toSorted();
    const directWorkflowInstallSources = listFiles('.github/workflows', '.yml')
      .filter((workflowPath) =>
        readSource(workflowPath).includes('bun install'),
      )
      .toSorted();
    const workflowDockerBuildLines = listFiles('.github/workflows', '.yml')
      .flatMap((workflowPath) =>
        readSource(workflowPath)
          .split('\n')
          .map((line, index) => ({
            line,
            location: `${workflowPath}:${index + 1}`,
          })),
      )
      .filter(
        ({ line }) =>
          line.includes('docker compose') && /(^|\s)build(\s|$)/u.test(line),
      );
    const uncachedWorkflowDockerBuildLines = workflowDockerBuildLines.filter(
      ({ line }) => !line.includes('.github/docker-compose.build-cache.yml'),
    );
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current CI dependency-install reliability checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(workflowDependencyInstallSources).toEqual([
      '.github/workflows/copilot-setup-steps.yml',
      '.github/workflows/e2e-baseline.yml',
    ]);
    expect(directWorkflowInstallSources).toEqual([]);
    expect(uncachedWorkflowDockerBuildLines).toEqual([]);
    for (const workflowPath of workflowDependencyInstallSources) {
      const workflowSource = readSource(workflowPath);
      expect(workflowSource).toContain(
        'uses: ./.github/actions/setup-bun-dependency-caches',
      );
      expect(workflowSource).not.toContain('bun-version: "1.3.11"');
      expect(workflowSource).toContain(
        'BUN_PACKAGE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.package-cache-hit }}',
      );
      expect(workflowSource).toContain(
        'BUN_DEPENDENCY_TREE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.dependency-tree-cache-hit }}',
      );
      expect(workflowSource).toContain(
        'run: bash helpers/testing/install-ci-dependencies.sh',
      );
      expect(workflowSource).toContain(
        'Save Bun dependency tree from package cache',
      );
      expect(workflowSource).not.toContain('FONT_AWESOME_TOKEN');
      expect(workflowSource).not.toContain('npm.fontawesome.com');
    }
    expect(ciDependencyCacheAction).toContain(
      'Prepare public Font Awesome registry',
    );
    expect(ciDependencyCacheAction).toContain(
      'run: bash helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    expect(ciDependencyCacheAction).toContain('default: "1.3.11"');
    expect(ciDependencyCacheAction).toContain(
      'bun-version: ${{ inputs.bun-version }}',
    );
    expect(ciDependencyCacheAction).toContain('Restore Bun package cache');
    expect(ciDependencyCacheAction).toContain('id: bun-package-cache');
    expect(ciDependencyCacheAction).toContain('path: ~/.bun/install/cache');
    expect(ciDependencyCacheAction).toContain(
      "key: ${{ runner.os }}-bun-${{ inputs.bun-version }}-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(ciDependencyCacheAction).toContain('Restore Bun dependency tree');
    expect(ciDependencyCacheAction).toContain('id: bun-dependency-tree-cache');
    expect(ciDependencyCacheAction).toContain('path: node_modules');
    expect(ciDependencyCacheAction).toContain(
      "key: ${{ runner.os }}-bun-node-modules-${{ inputs.bun-version }}-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(fontAwesomeCiHelper).toContain('Repository .npmrc is not supported');
    expect(fontAwesomeCiHelper).toContain(
      "privateRegistry = ['npm', 'fontawesome', 'com'].join('.')",
    );
    expect(fontAwesomeCiHelper).toContain(
      'Font Awesome must stay on free public npm packages in CI.',
    );
    expect(fontAwesomeCiHelper).toContain(
      'npm_config_userconfig="${RUNNER_TEMP:-/tmp}/npmrc-public-fontawesome"',
    );
    expect(fontAwesomeCiHelper).toContain(
      'npm_config_globalconfig="${RUNNER_TEMP:-/tmp}/npmrc-empty-global"',
    );
    expect(fontAwesomeCiHelper).toContain('NPM_CONFIG_GLOBALCONFIG=');
    expect(fontAwesomeCiHelper).toContain('npm_config_globalconfig=');
    expect(fontAwesomeCiHelper).toContain(
      'fontawesome_token_environment_names=(',
    );
    expect(fontAwesomeCiHelper).toContain('FONT_AWESOME_TOKEN');
    expect(fontAwesomeCiHelper).toContain('FONTAWESOME_TOKEN');
    expect(fontAwesomeCiHelper).toContain('FONTAWESOME_NPM_AUTH_TOKEN');
    expect(fontAwesomeCiHelper).toContain('FONTAWESOME_PACKAGE_TOKEN');
    expect(fontAwesomeCiHelper).toContain(
      'unset "${fontawesome_token_environment_name}"',
    );
    expect(fontAwesomeCiHelper).toContain(
      'echo "${fontawesome_token_environment_name}="',
    );
    expect(copilotSetupWorkflow).not.toContain(
      'bun install --frozen-lockfile --cache-dir ~/.bun/install/cache',
    );
    expect(copilotSetupWorkflow).toContain('Set up Bun dependency caches');
    expect(copilotSetupWorkflow).toContain(
      'uses: ./.github/actions/setup-bun-dependency-caches',
    );
    expect(copilotSetupWorkflow).toContain('CI_DEPENDENCY_INSTALL_MODE: warm');
    expect(copilotSetupWorkflow).not.toContain('FONT_AWESOME_TOKEN');
    expect(copilotSetupWorkflow).not.toContain('npm.fontawesome.com');
    expect(workflow).toContain(
      'run: bash helpers/testing/install-ci-dependencies.sh',
    );
    expect(workflow).toContain('CI_DEPENDENCY_INSTALL_MODE: warm');
    expect(workflow).toContain('CI_DEPENDENCY_INSTALL_MODE: offline-required');
    expect(workflow).toContain('Set up Bun dependency caches');
    expect(workflow).toContain(
      'uses: ./.github/actions/setup-bun-dependency-caches',
    );
    expect(workflow).toContain('Restore Docker build cache');
    expect(workflow).toContain('COMPOSE_DOCKER_CLI_BUILD: 1');
    expect(workflow).toContain('DOCKER_BUILDKIT: 1');
    expect(workflow).toContain(
      'DOCKER_BUILD_CACHE_DIR: /tmp/evorto-docker-build-cache',
    );
    expect(workflow).toContain('Set up Docker Buildx');
    expect(workflow).toContain('id: setup-buildx');
    expect(workflow).toContain('uses: docker/setup-buildx-action@v4');
    expect(workflow).toContain('version: latest');
    expect(workflow).toContain('warm-ci-caches:');
    expect(workflow).toContain('name: Warm CI dependency caches');
    expect(workflow).toContain(
      'Prune expired Neon branches before cache installs',
    );
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-prune-neon-local-branches.sh',
    );
    expect(workflow).toContain('needs: warm-ci-caches');
    expect(workflow).toContain('max-parallel: 1');
    expect(workflow).toContain('path: ${{ env.DOCKER_BUILD_CACHE_DIR }}');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-docker-build-bun-1.3.11-${{ hashFiles('Dockerfile', 'docker-compose.yml', '.github/docker-compose.build-cache.yml', 'package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('BUILDKIT_BUN_CACHE_DIR: buildkit-bun-cache');
    expect(workflow).toContain('Restore Docker Bun cache mount');
    expect(workflow).toContain('id: docker-bun-cache-mount');
    expect(workflow).toContain('path: ${{ env.BUILDKIT_BUN_CACHE_DIR }}');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-docker-bun-cache-mount-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('Require warmed Docker Bun cache mount');
    expect(workflow).toContain(
      'Docker Bun cache mount hit: ${{ steps.docker-bun-cache-mount.outputs.cache-hit }}',
    );
    expect(workflow).toContain(
      'Docker Bun cache mount was not restored after warm-ci-caches. Refusing Docker builds that could repeat Font Awesome package downloads inside each E2E worker.',
    );
    expect(workflow).toContain('Inject Docker Bun cache mount');
    expect(workflow).toContain(
      'uses: reproducible-containers/buildkit-cache-dance@v3.4.0',
    );
    expect(workflow).toContain(
      'builder: ${{ steps.setup-buildx.outputs.name }}',
    );
    expect(workflow).toContain('"target": "/home/bun/.bun/install/cache"');
    expect(workflow).toContain('"id": "bun-install-cache"');
    expect(workflow).toContain(
      'skip-extraction: ${{ steps.docker-bun-cache-mount.outputs.cache-hit }}',
    );
    expect(workflow).toContain('skip-extraction: true');
    expect(workflow).toContain('Prepare Docker build cache directory');
    expect(workflow).toContain('mkdir -p "${DOCKER_BUILD_CACHE_DIR}"');
    expect(workflow).toContain('Warm Docker build cache');
    expect(workflow).toContain('timeout 8m docker build');
    expect(workflow).toContain('--target dependencies');
    expect(workflow).toContain(
      '--cache-from type=gha,scope=evorto-dependencies',
    );
    expect(workflow).toContain(
      '--cache-to type=gha,scope=evorto-dependencies,mode=max',
    );
    expect(workflow).not.toContain(
      'timeout 20m docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build --progress=plain db-setup evorto',
    );
    expect(workflow).toContain(
      'PLAYWRIGHT_BROWSERS_PATH: /home/runner/.cache/ms-playwright',
    );
    expect(workflow).toContain('Restore Playwright browser cache');
    expect(workflow).toContain('Warm Playwright browser cache');
    expect(workflow).toContain(
      'key: ${{ runner.os }}-playwright-1.59.1-chromium',
    );
    expect(workflow).toContain('uses: actions/cache/restore@v4');
    expect(ciBuildCacheCompose).toContain('type=gha');
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-db-setup');
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-app');
    expect(ciBuildCacheCompose).toContain(
      'type=gha,scope=evorto-db-setup,mode=max',
    );
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-app,mode=max');
    expect(ciInstallHelper).toContain(
      'Bun package cache hit: ${package_cache_hit}',
    );
    expect(ciInstallHelper).toContain('Bun package cache restored:');
    expect(ciInstallHelper).toContain(
      'find "${bun_cache_dir}" -mindepth 1 -maxdepth 1 -print -quit',
    );
    expect(ciInstallHelper).toContain(
      'Bun dependency tree cache hit: ${dependency_tree_cache_hit}',
    );
    expect(ciInstallHelper).toContain(
      'Bun dependency tree cache was not restored; installing offline from the warmed package cache before falling back to the serial cache warmer registry install.',
    );
    expect(ciInstallHelper).toContain(
      'bun install --frozen-lockfile --offline --cache-dir "${bun_cache_dir}"',
    );
    expect(workflow).toContain('Save warmed Bun package cache');
    expect(workflow).toContain('Save warmed Bun dependency tree');
    expect(workflow).toContain('uses: actions/cache/save@v4');
    expect(workflow).toContain(
      "if: steps.bun-dependency-caches.outputs.package-cache-hit != 'true'",
    );
    expect(workflow).toContain(
      'key: ${{ steps.bun-dependency-caches.outputs.package-cache-primary-key }}',
    );
    expect(workflow).toContain(
      "if: steps.bun-dependency-caches.outputs.dependency-tree-cache-hit != 'true'",
    );
    expect(workflow).toContain(
      'key: ${{ steps.bun-dependency-caches.outputs.dependency-tree-cache-primary-key }}',
    );
    expect(workflow).toContain(
      'CI_DEPENDENCY_INSTALL_MISSING_CACHE_MESSAGE: Bun dependency tree cache was not restored after warm-ci-caches. Refusing a parallel registry install to avoid repeated Font Awesome package downloads.',
    );
    expect(ciInstallHelper).toContain(
      'Retrying once without clearing the package cache',
    );
    expect(workflow).not.toContain('bun pm cache rm');
    expect(ciDependencyCacheAction).toContain(
      'Prepare public Font Awesome registry',
    );
    expect(ciDependencyCacheAction).toContain(
      'run: bash helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    expect(workflow).not.toContain('Configure Font Awesome registry auth');
    expect(workflow).not.toContain('Validate Font Awesome registry auth');
    expect(workflow).not.toContain('Remove Font Awesome registry auth');
    expect(workflow).not.toContain('FONT_AWESOME_TOKEN');
    expect(workflow).not.toContain('npm.fontawesome.com');
    expect(copilotSetupWorkflow).not.toContain(
      'bun install --frozen-lockfile --cache-dir ~/.bun/install/cache',
    );
    expect(copilotSetupWorkflow).toContain('Set up Bun dependency caches');
    expect(copilotSetupWorkflow).toContain(
      'uses: ./.github/actions/setup-bun-dependency-caches',
    );
    expect(copilotSetupWorkflow).toContain(
      'PLAYWRIGHT_BROWSERS_PATH: /home/runner/.cache/ms-playwright',
    );
    expect(copilotSetupWorkflow).toContain('Restore Playwright browser cache');
    expect(copilotSetupWorkflow).toContain(
      'key: ${{ runner.os }}-playwright-1.59.1-chromium',
    );
    expect(copilotSetupWorkflow).toContain(
      'BUN_PACKAGE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.package-cache-hit }}',
    );
    expect(copilotSetupWorkflow).toContain(
      'BUN_DEPENDENCY_TREE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.dependency-tree-cache-hit }}',
    );
    expect(copilotSetupWorkflow).toContain('CI_DEPENDENCY_INSTALL_MODE: warm');
    expect(copilotSetupWorkflow).not.toContain('bun pm cache rm');
    expect(copilotSetupWorkflow).not.toContain(
      'Configure Font Awesome registry auth',
    );
    expect(copilotSetupWorkflow).not.toContain(
      'Validate Font Awesome registry auth',
    );
    expect(copilotSetupWorkflow).not.toContain(
      'Remove Font Awesome registry auth',
    );
    expect(copilotSetupWorkflow).not.toContain('FONT_AWESOME_TOKEN');
    expect(copilotSetupWorkflow).not.toContain('npm.fontawesome.com');
    expect(packageJson.dependencies).toHaveProperty(
      '@fortawesome/free-solid-svg-icons',
    );
    expect(packageJson.dependencies).toHaveProperty(
      '@fortawesome/free-brands-svg-icons',
    );
    expect(packageJson.dependencies).not.toHaveProperty(
      '@fortawesome/duotone-regular-svg-icons',
    );
    expect(lockfile).toContain('@fortawesome/free-solid-svg-icons');
    expect(lockfile).not.toContain('@fortawesome/duotone-regular-svg-icons');
    expect(lockfile).not.toContain('npm.fontawesome.com');
    expect(bunfig).toContain('[install.scopes]');
    expect(bunfig).toContain('"@fortawesome" = "https://registry.npmjs.org/"');
    expect(dockerignore).toContain('.npmrc');
    expect(dockerfile).not.toContain('FONT_AWESOME_TOKEN');
    expect(dockerfile).not.toContain('npm.fontawesome.com');
    expect(dockerfile).toContain(
      'NPM_CONFIG_USERCONFIG=/tmp/npmrc-public-fontawesome',
    );
    expect(dockerfile).toContain(
      'npm_config_userconfig=/tmp/npmrc-public-fontawesome',
    );
    expect(dockerfile).toContain(
      'NPM_CONFIG_GLOBALCONFIG=/tmp/npmrc-empty-global',
    );
    expect(dockerfile).toContain(
      'npm_config_globalconfig=/tmp/npmrc-empty-global',
    );
    expect(dockerfile).toContain(
      "'@fortawesome:registry=https://registry.npmjs.org/'",
    );
    expect(dockerfile).toContain('RUN : > /tmp/npmrc-empty-global');
    expect(dockerfile).toContain(
      'id=bun-install-cache,target=/home/bun/.bun/install/cache,uid=1000,gid=1000,sharing=locked',
    );
    expect(dockerfile).toContain('FROM base AS dependencies');
    expect(dockerfile).toContain('FROM dependencies AS build');
    expect(dockerfile).toContain(
      'FROM dependencies AS production-dependencies',
    );
    expect(dockerfile).toContain('RUN rm -rf node_modules');
    expect(dockerfile).toContain(
      'bun install --frozen-lockfile --production --offline --cache-dir /home/bun/.bun/install/cache',
    );
    expect(dockerfile).not.toContain(
      'bun install --frozen-lockfile --production --cache-dir /home/bun/.bun/install/cache',
    );
    expect(ciBuildCacheCompose).toContain('cache_from:');
    expect(ciBuildCacheCompose).toContain(
      'type=local,src=${DOCKER_BUILD_CACHE_DIR:-/tmp/evorto-docker-build-cache}',
    );
    expect(ciBuildCacheCompose).toContain('cache_to:');
    expect(ciBuildCacheCompose).toContain(
      'type=local,dest=${DOCKER_BUILD_CACHE_DIR:-/tmp/evorto-docker-build-cache},mode=max',
    );
    expect(composeFile).not.toContain('FONT_AWESOME_TOKEN');
    expect(checkpoint).toContain('Playwright E2E (functional-2)');
    expect(checkpoint).toContain('copilot-setup-steps');
    expect(checkpoint).toContain('Bun cache');
    expect(checkpoint).toMatch(
      /bun install --frozen-lockfile --cache-dir\s+~\/\.bun\/install\/cache/u,
    );
    expect(checkpoint).toContain('actions/cache/save@v4');
    expect(checkpoint).toContain('immediately saves');
    expect(checkpoint).toContain('before Playwright browser');
    expect(checkpoint).toContain('integrity-check errors');
    expect(checkpoint).toContain('@effect/language-service');
    expect(checkpoint).toContain('@angular/material');
    expect(checkpoint).toContain('drizzle-kit');
    expect(checkpoint).toContain('Both workflows that install dependencies');
    expect(checkpoint).toContain('normal frozen-lockfile install');
    expect(checkpoint).toContain(
      'retry without deleting `~/.bun/install/cache`',
    );
    expect(checkpoint).not.toContain('bun pm cache rm');
    expect(checkpoint).toContain('private Font Awesome dependency path');
    expect(checkpoint).toContain('tracked `.npmrc` is gone');
    expect(checkpoint).toContain('public npm packages only');
    expect(checkpoint).toContain('@shared/icons/fontawesome');
    expect(checkpoint).toContain('bun install --frozen-lockfile');
    expect(checkpoint).toContain('passes locally without registry auth');
    expect(checkpoint).toContain('latest pushed PR head');
    expect(checkpoint).toContain('all three E2E matrix jobs');
    expect(checkpoint).toContain('green pushed-head');
    expect(checkpoint).not.toContain('current Copilot setup');
    expect(checkpoint).toContain('primary');
    expect(checkpoint).toContain('~/.bun/install/cache');
    expect(checkpoint).toContain('downloaded/extracted only one package');
    expect(checkpoint).toContain('public Font Awesome');
    expect(checkpoint).toContain('BuildKit Bun cache mount');
    expect(checkpoint).toContain('buildkit-bun-cache');
    expect(checkpoint).toContain(
      'reproducible-containers/buildkit-cache-dance@v3.4.0',
    );
    expect(checkpoint).toContain('skip-extraction: true');
    expect(checkpoint).toContain('@fortawesome/duotone-regular-svg-icons');
    expect(checkpoint).toContain('npm.fontawesome.com');
    expect(checkpoint).toContain('stay out of package');
    expect(checkpoint).toContain('workflow sources');
    expect(checkpoint).toContain('exactly one branch, `main`');
    expect(checkpoint).toContain('zero active-test');
    expect(checkpoint).toContain(
      'retry without deleting `~/.bun/install/cache`',
    );
    expect(checkpoint).toMatch(/CI\s+reliability/u);
    expect(checkpoint).toContain('small worst-case retry cost');
    expect(checkpoint).toMatch(/persistent\s+lockfile,\s+registry/u);
    expect(checkpoint).not.toContain('fresh no-console-warning claim');
  });

  it('keeps local Docker preflight readiness wording precise', () => {
    const source = readSource('STABILIZATION.md');
    const localRuntime = readSection(
      source,
      'Local Runtime/Developer Workflow',
      'Prioritized Cleanup Backlog',
    );

    expect(localRuntime).toContain('Docker container start path');
    expect(localRuntime).toContain('public npm packages only');
    expect(localRuntime).toContain(
      "this worktree's required runtime variables are present",
    );
    expect(localRuntime).toContain(
      'Earlier Docker preflight retries failed only at the disposable container start-path probe',
    );
    expect(localRuntime).toContain(
      'host Docker engine could inspect config but could not start containers',
    );
    expect(localRuntime).toContain(
      'current running-Docker Browser evidence in the review queue supersedes that historical local blocker',
    );
    expect(localRuntime).not.toContain(
      'current Docker preflight now fails only',
    );
    expect(localRuntime).not.toContain(
      "this worktree's Docker preflight passes with all required runtime variables present",
    );
  });

  it('keeps the CI image-pull retry tied to the observed Docker Hub timeout', () => {
    const source = readSource('STABILIZATION.md');
    const workflow = readSource('.github/workflows/e2e-baseline.yml');
    const ciStartDockerStackHelper = readSource(
      'helpers/testing/ci-start-docker-stack.sh',
    );
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current CI image-pull reliability checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-start-docker-stack.sh',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 3m node_modules/.bin/dotenv -c dev -- docker compose pull --quiet --ignore-buildable --policy missing',
    );
    expect(ciStartDockerStackHelper).toContain('for attempt in 1 2 3 4; do');
    expect(ciStartDockerStackHelper).toContain(
      'Docker Compose image pre-pull failed after ${attempt} attempts.',
    );
    expect(ciStartDockerStackHelper).toContain(
      'Continuing to Compose startup, which can still pull missing images.',
    );
    expect(ciStartDockerStackHelper).toContain(
      'delay_seconds=$((attempt * 15))',
    );
    expect(ciStartDockerStackHelper).toContain(
      'Docker Compose image pre-pull failed on attempt ${attempt}. Retrying in ${delay_seconds}s before startup.',
    );
    expect(checkpoint).toContain('Playwright E2E (docs)');
    expect(checkpoint).toContain('Docker Hub timed out');
    expect(checkpoint).toContain('oven/bun:1.3.11-alpine');
    expect(checkpoint).toContain('db-expiration');
    expect(checkpoint).toContain('Functional shards passed on the same head');
    expect(checkpoint).toContain('docs rerun then\n  passed Docker startup');
    expect(checkpoint).toContain('generated-doc upload');
    expect(checkpoint).toContain('pre-pulls non-buildable Compose images');
    expect(checkpoint).toContain('regular detached Compose startup');
    expect(checkpoint).toContain('one retry was still\n  too narrow');
    expect(checkpoint).toContain('parallel CI load');
    expect(checkpoint).toContain('Playwright E2E (functional-2)');
    expect(checkpoint).toContain('minio-init');
    expect(checkpoint).toContain('stripe');
    expect(checkpoint).toContain('four bounded attempts');
    expect(checkpoint).toContain('short backoff');
    expect(checkpoint).toContain('regular detached Compose startup');
    expect(checkpoint).toContain('startup diagnostics');
    expect(checkpoint).toContain('favoring reliability');
    expect(checkpoint).toContain('small worst-case delay');
    expect(checkpoint).toContain('bounded-backoff follow-up head');
    expect(checkpoint).toContain('passed\n  CodeQL');
    expect(checkpoint).toContain('Analyze');
    expect(checkpoint).toContain('Copilot setup');
    expect(checkpoint).toContain('Git Town');
    expect(checkpoint).toContain('CodeRabbit');
    expect(checkpoint).toContain('still failed before startup');
    expect(checkpoint).toContain('Docker Hub header timeouts');
    expect(checkpoint).toContain('advisory warmup');
    expect(checkpoint).toContain('logs a warning');
    expect(checkpoint).toContain(
      'continues to the normal Compose startup path',
    );
    expect(checkpoint).toContain('build/start retry path');
    expect(checkpoint).toContain('Playwright E2E (docs)');
    expect(checkpoint).toContain('Playwright E2E (functional-1)');
    expect(checkpoint).toContain('Playwright E2E (functional-2)');
  });

  it('keeps historical Browser fallback scope separate from completed manual evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Historical Browser connector fallback checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain(
      "Browser plugin's\n  Node-backed in-app Browser runtime",
    );
    expect(checkpoint).toContain('page was not initialized before interaction');
    expect(checkpoint).toContain(
      'does not supersede the completed first manual in-app Browser queue pass',
    );
    expect(checkpoint).toContain('prior Browser-backed route/content');
    expect(checkpoint).toContain('evidence-only CI/doc changes');
    expect(checkpoint).toContain('fallback route checks');
    expect(checkpoint).toContain('HTTP route sanity');
    expect(checkpoint).toContain('/events');
    expect(checkpoint).toContain(
      'stabilizationEvidence=ci-image-pull-retry-green-head',
    );
    expect(checkpoint).toContain(
      'stabilizationEvidence=ci-pull-bounded-backoff',
    );
    expect(checkpoint).toContain(
      'stabilizationEvidence=historical-browser-blocker-wording',
    );
    expect(checkpoint).toContain(
      'historical\n  Browser-blocker wording cleanup',
    );
    expect(checkpoint).toMatch(/reachability\/security\s+headers/u);
    expect(checkpoint).toMatch(
      /rather than a Browser walkthrough or console\s+review/u,
    );
    expect(checkpoint).not.toContain('manual Browser review remains blocked');
    expect(checkpoint).not.toContain('Transport closed');
    expect(checkpoint).not.toContain('Must setup test before interacting');
  });

  it('keeps the current Browser runtime reconnect checkpoint tied to in-app evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Browser runtime reconnect checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain(
      "Browser plugin's Node-backed\n  in-app Browser runtime reconnected",
    );
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('/events');
    expect(checkpoint).toContain(
      'stabilizationEvidence=browser-node-runtime-reconnected',
    );
    expect(checkpoint).toContain('local\n  app shell');
    expect(checkpoint).toContain(
      'stabilizationEvidence=evidence-index-browser-runtime-retry',
    );
    expect(checkpoint).toContain('current tenant feed');
    expect(checkpoint).toContain('Upcoming Events');
    expect(checkpoint).toContain('public event links');
    expect(checkpoint).toContain(
      'instead of\n  the earlier seeded `Soccer Match 1` fixture list',
    );
    expect(checkpoint).toContain('Browser DOM snapshot');
    expect(checkpoint).toMatch(/no rendered\s+application\s+error\s+text/u);
    expect(checkpoint).toContain(
      'supersedes the older\n  fallback-only status',
    );
    expect(checkpoint).not.toContain('HTTP route sanity');
    expect(checkpoint).not.toContain('page was not initialized');
    expect(checkpoint).not.toContain('Must setup test before interacting');
  });

  it('keeps the CI compose diagnostics checkpoint tied to the green follow-up run', () => {
    const source = readSource('STABILIZATION.md');
    const workflow = readSource('.github/workflows/e2e-baseline.yml');
    const ciStartDockerStackHelper = readSource(
      'helpers/testing/ci-start-docker-stack.sh',
    );
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current CI Compose alignment checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-start-docker-stack.sh',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 12m node_modules/.bin/dotenv -c dev -- docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build --progress=plain db-setup evorto',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 5m node_modules/.bin/dotenv -c dev -- docker compose up --no-build -d',
    );
    expect(ciStartDockerStackHelper).toContain(
      'Docker Compose build/start timed out before the workflow step timeout',
    );
    expect(ciStartDockerStackHelper).toContain(
      'docker builder prune -af || true',
    );
    expect(ciStartDockerStackHelper).toContain('bun run docker:ps || true');
    expect(checkpoint).toContain('regular detached Compose start');
    expect(checkpoint).toContain('explicit Compose build');
    expect(checkpoint).toContain(
      'reports a GitHub error annotation on timeout',
    );
    expect(checkpoint).toContain(
      'stabilizationEvidence=ci-compose-timeout-diagnostics',
    );
    expect(checkpoint).toContain('does\n  not claim seeded event-list content');
    expect(checkpoint).toMatch(/current\s+PR\s+head/u);
    expect(checkpoint).toContain('Docker build/start timeout');
    expect(checkpoint).toContain('the docs and first functional shards passed');
    expect(checkpoint).toContain('first functional shards passed');
    expect(checkpoint).toContain('Playwright E2E (functional-2)');
    expect(checkpoint).toContain('docs');
    expect(checkpoint).toContain('Later pushed CI evidence superseded');
    expect(checkpoint).toContain('retryable\n  split-build startup path');
    expect(checkpoint).not.toMatch(/awaits the next pushed CI\s+run/u);
  });

  it('does not describe superseded push blockers as current Browser queue state', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');

    expect(queue).toContain('Historical push-blocker PR sync checkpoint');
    expect(queue).toContain('Historical docs-CI stabilization checkpoint');
    expect(queue).toContain('later checkpoints supersede the old');
    expect(queue).toContain('Later\n  readiness checkpoints supersede');
    expect(queue).not.toContain('Current PR sync checkpoint');
    expect(queue).not.toContain('Current docs-CI stabilization checkpoint');
    expect(queue).not.toContain('PR remains local-only at this checkpoint');
    expect(queue).not.toContain('GitHub still reports the older remote head');
    expect(queue).not.toContain(
      "still\n  failing on GitHub's older remote head",
    );
    expect(queue).not.toContain('fix remains local-only');
    expect(queue).not.toContain('SSH signing still fails');
    expect(queue).not.toContain('HTTPS push remains unusable');
  });

  it('keeps the live Browser route refresh tied to current Soccer event evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current live Browser route refresh checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('Docker stack stayed healthy');
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('in-app Browser opened `/events`');
    expect(checkpoint).toContain('seeded `Soccer Match 1` event link');
    expect(checkpoint).toContain('Soccer Match 1 | Development');
    expect(checkpoint).toContain('registration/payment');
    expect(checkpoint).toContain('inclusive-VAT signals');
    expect(checkpoint).toContain('Browser\n  warning/error logs were empty');
    expect(checkpoint).not.toContain('first event link');
    expect(checkpoint).not.toContain('Browser review was blocked');
  });

  it('keeps the current public General Browser refresh tied to current-head mobile evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current public General Browser refresh checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('PR head\n  `fb77d966c`');
    expect(checkpoint).toContain('`bun run docker:start` rebuilt');
    expect(checkpoint).toContain('offline Bun production dependency cache');
    expect(checkpoint).toContain('Font Awesome packages');
    expect(checkpoint).toContain('/events` at 320x740');
    expect(checkpoint).toContain('Murnau, Munich, and Soccer Match events');
    expect(checkpoint).toContain('document and body widths stayed at 305px');
    expect(checkpoint).toContain(
      '`/legal/terms`, `/legal/privacy`, and `/404` at 390x844',
    );
    expect(checkpoint).toContain('document and body widths\n  stayed at 375px');
    expect(checkpoint).toContain('mobile bottom navigation');
    expect(checkpoint).toContain('no horizontal overflow');
    expect(checkpoint).toContain('clipped\n  visible controls');
    expect(checkpoint).toContain('rendered application-error text');
    expect(checkpoint).toContain('only app info logs');
    expect(checkpoint).not.toContain('system Chrome');
    expect(checkpoint).not.toContain('standalone Playwright');
  });

  it('keeps the current Browser unlisted-event checkpoint tied to list hiding and direct access', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Browser unlisted-event checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('current `localhost` seed');
    expect(checkpoint).toContain('temporarily marked');
    expect(checkpoint).toContain('restored it after\n  Browser review');
    expect(checkpoint).toContain('Bavarian Forest Trip 1');
    expect(checkpoint).toContain('in-app Browser `/events` reload');
    expect(checkpoint).toContain('no longer showed that\n  event');
    expect(checkpoint).toContain('/events/cb6fd355fe42785bb255');
    expect(checkpoint).toContain(
      'title, description, participant\n  registration option',
    );
    expect(checkpoint).toContain('login-required registration action');
    expect(checkpoint).toContain(
      'Fresh Browser\n  warning/error logs were empty',
    );
    expect(checkpoint).not.toContain('system Chrome');
    expect(checkpoint).not.toContain('admin sees unlisted');
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

    expect(source).toContain('Updated: 2026-06-05');
    expect(source).toContain('## Stabilization Coverage Watchlist');
    expect(source).not.toContain('## Stabilization Coverage Still Needed');
    expect(source).toContain(
      'Most are now covered by deterministic specs, generated docs, or source guards',
    );
    expect(source).toContain(
      'first in-app Browser manual review queue pass has now covered',
    );
    expect(source).toContain(
      'first authenticated Browser review pass has covered the global-admin',
    );
    expect(source).toContain('docs/admin/global-admin.doc.ts');
    expect(source).toContain(
      'global-admin generated docs focused on implemented relaunch tenant\n  operations',
    );
    expect(source).toContain(
      '/global-admin/tenants/:tenantId/edit` allow/deny behavior in page-backed\n  runtime',
    );
    expect(source).toContain(
      'in-app Browser\n    profile refresh also verified the seeded submitted receipt card',
    );
    expect(source).toContain('/profile#receipts');
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
    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('authenticated regular-user in-app Browser');
    expect(checkpoint).toContain('/scan');
    expect(checkpoint).toContain('retryable camera\n  fallback');
    expect(checkpoint).toContain('Try camera again');
    expect(checkpoint).toContain('phone camera');
    expect(checkpoint).toContain('Browser warning/error logs were empty');
  });

  it('keeps the current Browser profile discounts checkpoint tied to visible ESNcard state', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Browser profile-discounts checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('active `localhost` tenant');
    expect(checkpoint).toContain('ESNcard test-provider review');
    expect(checkpoint).toContain('regular user');
    expect(checkpoint).toContain('TEST-ESN-0001');
    expect(checkpoint).toContain('cache-busted in-app Browser reload');
    expect(checkpoint).toContain('/profile#discounts');
    expect(checkpoint).toContain('Discount Cards');
    expect(checkpoint).toContain('verified\n  seeded card');
    expect(checkpoint).toContain('refresh/remove actions');
    expect(checkpoint).toContain('Save ESN card');
    expect(checkpoint).toContain('Browser\n  warning/error logs were empty');
    expect(checkpoint).not.toContain('system Chrome');
    expect(checkpoint).not.toContain('direct `#discounts` link');
  });

  it('keeps the current Browser profile events and receipts checkpoint tied to visible cards', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Browser profile events\/receipts checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('cache-busted in-app Browser reloads');
    expect(checkpoint).toContain('/profile#events');
    expect(checkpoint).toContain('/profile#receipts');
    expect(checkpoint).toContain('authenticated regular-user\n  session');
    expect(checkpoint).toContain('confirmed checked-in `Murnau City Tour 2`');
    expect(checkpoint).toContain('no-payment');
    expect(checkpoint).toContain('cancellation/transfer-unavailable');
    expect(checkpoint).toContain('event-page action');
    expect(checkpoint).toContain('profile-receipt.pdf');
    expect(checkpoint).toContain('Munich City Tour 2');
    expect(checkpoint).toContain('submitted\n  status');
    expect(checkpoint).toContain('12.50 €');
    expect(checkpoint).toContain('Browser warning/error logs were empty');
    expect(checkpoint).not.toContain('system Chrome');
    expect(checkpoint).not.toContain('standalone Playwright');
  });

  it('keeps the current inventory evidence refresh honest about Browser scope', () => {
    const source = readSource('STABILIZATION.md');
    const inventory = readSource('tests/test-inventory.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current inventory evidence refresh checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('tests/test-inventory.md');
    expect(checkpoint).toContain('submitted-receipt Browser review');
    expect(checkpoint).toContain(
      'generated-doc/functional\n  profile receipt coverage',
    );
    expect(checkpoint).toContain(
      'authenticated Browser `/profile#receipts`\n  checkpoint',
    );
    expect(checkpoint).toContain('current in-app\n  Browser sanity pass');
    expect(checkpoint).toContain('generated `BASE_URL` `/events` route');
    expect(checkpoint).toContain('Soccer Match 1');
    expect(checkpoint).toContain('auth-gated HTTP response failure');
    expect(checkpoint).toContain(
      'public route sanity rather than new authenticated profile\n  evidence',
    );
    expect(checkpoint).toContain('June 3 stabilization date');
    expect(checkpoint).toContain(
      'source coverage pins that timestamp to this active evidence refresh',
    );
    expect(checkpoint).toContain(
      'exactly three credential-gated\n  `test.skip` calls',
    );
    expect(checkpoint).toContain('zero `test.fixme` calls');
    expect(checkpoint).toContain('no unclassified Playwright\n  skips');
    expect(checkpoint).toContain(
      'requires each allowlisted credential\n  skip to name the exact required environment variables',
    );
    expect(checkpoint).toContain(
      'inventory must document the skipped file plus the same credential\n  variable names',
    );
    expect(checkpoint).toContain('Auth0 Management and Stripe webhook gates');
    expect(checkpoint).toContain(
      'stabilizationEvidence=inventory-date-refresh-clean',
    );
    expect(checkpoint).toContain('Events | Development');
    expect(checkpoint).toContain('showed the seeded `Soccer Match 1`');
    expect(checkpoint).toContain('no rendered application error text');
    expect(checkpoint).toContain(
      'earlier scanner warnings from the reused browser session by timestamp',
    );
    expect(checkpoint).toContain(
      'route/content evidence rather than clean-console evidence',
    );
    expect(checkpoint).toContain('local head `75a9a462f`');
    expect(checkpoint).toContain(
      'helpers/testing/playwright-skip-inventory.spec.ts',
    );
    expect(checkpoint).toMatch(/with 15 tests/u);
    expect(checkpoint).toMatch(/only\s+the three credential-gated skips/u);
    expect(checkpoint).toMatch(/zero fixmes/u);
    expect(checkpoint).toMatch(/no\s+focused-only Playwright\s+declarations/u);
    expect(checkpoint).toContain('page.pause()');
    expect(checkpoint).toContain('`debugger` hooks');
    expect(checkpoint).toContain('waitForTimeout');
    expect(checkpoint).toContain('setTimeout');
    expect(checkpoint).not.toContain('fresh no-console-warning claim');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('collectFocusedOnlyEntries');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('forbidOnly: environment.CI');
    expect(readSource('playwright.config.ts')).toContain(
      'forbidOnly: environment.CI',
    );
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('collectPlaywrightRuntimeModifierEntries');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain(String.raw`test(?:\.describe)?`);
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('runtimeModifierPattern');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('test.describe.skip');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('test.describe.only');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('test.describe.configure');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('test.slow');
    expect(
      readSource('helpers/testing/playwright-skip-inventory.spec.ts'),
    ).toContain('collectInteractiveDebugEntries');
    expect(inventory).toContain('`test.describe.skip`');
    expect(inventory).toContain(
      'rejects focused-only `.only` and\n  `test.describe.only`',
    );
    expect(inventory).toContain('Playwright `forbidOnly` remains enabled');
    expect(inventory).toContain(
      'Runtime-affecting modifiers such as\n  `test.describe.configure(...)` and `test.slow()`',
    );
    expect(inventory).toContain(
      'The current runtime-modifier allowlist is\n  limited to `docs/events/register.doc.ts`',
    );
    expect(inventory).toContain('mutates shared registration state');
    expect(inventory).toContain('Stripe/webhook work');
    expect(inventory).toMatch(
      /interactive\s+`page\.pause\(\)`\/`debugger`\s+hooks/u,
    );
    expect(source).toContain(
      'New Playwright skips/fixmes, including\n`test.describe.skip`, should be added only as explicit credential gates',
    );
    expect(source).toContain(
      'honest Browser-backed stabilization placeholders',
    );
    expect(source).toContain(
      'runtime-affecting modifiers such as `test.describe.configure(...)`',
    );
    expect(source).toContain(
      'and `test.slow()` allowlisted with local reasons',
    );
    expect(source).toContain('rejects committed focused-only\n`.only`');
    expect(source).toContain('rejects interactive\n`page.pause()`/`debugger`');
    expect(source).toContain('rejects fixed `.waitForTimeout(...)` waits');
    expect(source).toContain('fixed `setTimeout` sleeps');
    expect(source).toContain('time-based waits');
    expect(inventory).toContain('Updated: 2026-06-05');
    expect(inventory).toContain(
      'in-app Browser\n    profile refresh also verified the seeded submitted receipt card',
    );
    expect(inventory).not.toContain(
      'Manual Browser\n    review remains useful once the in-app Browser connection is reliable',
    );
  });

  it('keeps the Neon branch-expiration checkpoint tied to runtime guard evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Neon branch-expiration guard checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('runtime source coverage');
    expect(checkpoint).toContain('too-many-branches cleanup');
    expect(checkpoint).toContain('Docker Compose keeps `db-expiration`');
    expect(checkpoint).toContain('same\n  metadata mount as `db`');
    expect(checkpoint).toContain('gates `db-setup` and `evorto`');
    expect(checkpoint).toContain('writable metadata directory');
    expect(checkpoint).toContain('two-hour branch TTL');
    expect(checkpoint).toContain('waits 180 seconds for metadata');
    expect(checkpoint).toContain('prunes stale\n  branches before E2E startup');
    expect(checkpoint).toContain(
      'missing expiration metadata has\n  aged beyond the two-hour active-test TTL',
    );
    expect(checkpoint).toContain(
      'giving the Neon Local `db` container a 60-second stop\n  window inside a bounded command',
    );
    expect(checkpoint).toContain('running bounded Compose down');
    expect(checkpoint).toContain('force-removing leftover Compose containers');
    expect(checkpoint).toContain('metadata-backed branch\n  cleanup helper');
    expect(checkpoint).toContain('detached Compose startup');
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain(
      'stabilizationEvidence=neon-branch-expiration-guard',
    );
    expect(checkpoint).toContain('Events | Development');
    expect(checkpoint).toContain('Soccer Match 1');
    expect(checkpoint).toContain('no rendered\n  application error text');
    expect(checkpoint).toContain(
      'earlier scanner\n  warnings from the reused browser session by timestamp',
    );
    expect(checkpoint).toContain(
      'route/content evidence rather than clean-console evidence',
    );
    expect(checkpoint).not.toContain('fresh no-console-warning claim');
  });

  it('keeps the applied-fixes evidence-drift checkpoint tied to current Browser evidence', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current applied-fixes evidence-drift checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint?.replaceAll(/\n\s*/gu, ' ')).toContain(
      'Fixes Applied In This Pass',
    );
    expect(checkpoint).toContain('stale audit-only "None" note');
    expect(checkpoint).toContain(
      'focused server, app, Playwright, docs, Browser, runtime, and\n  CI cleanup slices',
    );
    expect(checkpoint).toContain('Source coverage pins the section');
    expect(checkpoint).toContain('rejects the old no-op wording');
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain(
      'stabilizationEvidence=applied-fixes-drift-cleanup',
    );
    expect(checkpoint).toContain('Events | Development');
    expect(checkpoint).toContain('Soccer Match 1');
    expect(checkpoint).toContain('no rendered\n  application error text');
    expect(checkpoint).toContain(
      'earlier scanner\n  warnings from the reused browser session by timestamp',
    );
    expect(checkpoint).toContain(
      'route/content evidence rather than clean-console evidence',
    );
    expect(checkpoint).not.toContain('fresh no-console-warning claim');
  });

  it('keeps the credential-state Browser refresh scoped to route evidence after push realignment', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current credential-state Browser refresh checkpoint:[\s\S]*?(?=\n- Current |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('pushed and realigned');
    expect(checkpoint).toContain('GitHub CLI HTTPS credential-helper path');
    expect(checkpoint).not.toContain('two commits ahead');
    expect(checkpoint).not.toContain('remote PR head');
    expect(checkpoint).not.toContain('HTTPS\n  `workflow` scope');
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain(
      'stabilizationEvidence=credential-state-refresh-browser',
    );
    expect(checkpoint).toContain('current public event feed');
    expect(checkpoint).toContain('Upcoming Events');
    expect(checkpoint).toContain('no rendered\n  application error text');
    expect(checkpoint).toContain('older warnings');
    expect(checkpoint).toContain('Apollo timeout entries');
    expect(checkpoint).toContain(
      'stale\n  `section-app/legacy-app` cache paths',
    );
    expect(checkpoint).toContain(
      'route/content\n  evidence rather than clean-console evidence',
    );
    expect(checkpoint).toContain('review-thread-clean-refresh');
    expect(checkpoint).toContain('route/content\n  evidence only');
    expect(checkpoint).not.toContain('fresh no-console-warning claim');
    expect(checkpoint).not.toContain('Browser warning/error logs were empty');
    expect(checkpoint).not.toContain('current PR head is aligned');
  });

  it('keeps the latest pushed evidence refresh tied to the latest fully green coverage head', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current pushed evidence refresh checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain(
      'latest fully green coverage\n  evidence head',
    );
    expect(checkpoint).toContain('PR #62 remained');
    expect(checkpoint).toContain('mergeable');
    expect(checkpoint).toContain('merge-blocked only by draft/status state');
    expect(checkpoint).toMatch(/documentation-only\s+evidence refresh commit/u);
    expect(checkpoint).toContain('a0113b27bf49d47bc1477e156738484d51a21c41');
    expect(checkpoint).toContain('zero review threads');
    expect(checkpoint).toContain('CodeRabbit');
    expect(checkpoint).toContain('status context');
    expect(checkpoint).toContain('skipped for draft PRs');
    expect(checkpoint).toContain('formal bot review');
    expect(checkpoint).toContain('marked ready');
    expect(checkpoint).toContain('origin/main');
    expect(checkpoint).toContain('35ebb9a2b37606a4bdc5ac2ea53378eed2600d6d');
    expect(checkpoint).toMatch(/ancestor of the local\s+branch/u);
    expect(checkpoint).toContain('no current main merge conflict');
    expect(checkpoint).toMatch(/local\s+branch was clean and aligned/u);
    expect(checkpoint).toContain('origin/codex/stabilization-flow-coverage');
    expect(checkpoint).toMatch(/Fresh\s+GitHub checks/u);
    expect(checkpoint).toContain('Analyze');
    expect(checkpoint).toContain('CodeQL');
    expect(checkpoint).toContain('Git Town');
    expect(checkpoint).toContain('Copilot setup');
    expect(checkpoint).toContain('Playwright E2E docs');
    expect(checkpoint).toMatch(/Playwright E2E\s+functional-1/u);
    expect(checkpoint).toMatch(/Playwright E2E\s+functional-2/u);
    expect(checkpoint).toContain('all passed after the public');
    expect(checkpoint).toMatch(
      /event-detail viewport\s+coverage refresh commit/u,
    );
    expect(checkpoint).toContain('Docker startup');
    expect(checkpoint).toMatch(/Neon branch-expiration\s+confirmation/u);
    expect(checkpoint).toContain('generated-docs shard');
    expect(checkpoint).toMatch(/both\s+functional shards/u);
    expect(checkpoint).toMatch(/artifact\s+uploads/u);
    expect(checkpoint).toMatch(/format,\s+lint/u);
    expect(checkpoint).toMatch(
      /focused\s+stabilization\/skip-inventory source guards/u,
    );
    expect(checkpoint).toMatch(/WebStorm\s+errors-only diagnostics/u);
    expect(checkpoint).toMatch(
      /public General\s+viewport coverage checkpoint/u,
    );
    expect(checkpoint).toMatch(/this\s+non-moving evidence refresh/u);
    expect(checkpoint).toContain('public-general-viewports.spec.ts');
    expect(checkpoint).toContain('320x740');
    expect(checkpoint).toContain('390x844');
    expect(checkpoint).toContain('1440x900');
    expect(checkpoint).toContain('/events');
    expect(checkpoint).toContain('/events/:id');
    expect(checkpoint).toContain('/legal/imprint');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('expected route content');
    expect(checkpoint).toContain('no horizontal overflow');
    expect(checkpoint).toContain('no horizontally clipped visible controls');
    expect(checkpoint).toContain(
      'stabilizationEvidence=fb4a3671-mobile-events',
    );
    expect(checkpoint).toMatch(/Events route\s+heading/u);
    expect(checkpoint).toMatch(/current tenant feed/u);
    expect(checkpoint).toContain(
      'stabilizationEvidence=public-general-viewport-spec-8cfe2965',
    );
    expect(checkpoint).toContain('tenant-missing legal-text message');
    expect(checkpoint).toMatch(
      /reset\s+(?:the\s+)?temporary\s+Browser viewport override/u,
    );
    expect(checkpoint).toContain('Soccer Match 1');
    expect(checkpoint).toMatch(
      /route\/layout\s+evidence rather than seeded-event\s+content evidence/u,
    );
    expect(checkpoint).toMatch(/wider\s+public General\/legal viewport sweep/u);
    expect(checkpoint).toContain('current local in-app Browser refresh');
    expect(checkpoint).toContain('unpushed head\n  `92ed02dac`');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toMatch(
      /explicit\s+390x844,\s+320x740,\s+and 1440x900/u,
    );
    expect(checkpoint).toMatch(/no\s+Browser error logs/u);
    expect(checkpoint).toContain('no horizontal overflow');
    expect(checkpoint).toContain('no\n  horizontally clipped visible controls');
    expect(checkpoint).toContain('390x844 `/404` screenshot');
    expect(checkpoint).toMatch(/Material-style bottom navigation/u);
    expect(checkpoint).toMatch(/viewport override was reset/u);
    expect(checkpoint).toMatch(/[Aa]uthenticated\s+tenant General\s+settings/u);
    expect(checkpoint).toMatch(
      /page-backed\s+Playwright\s+spec\/docs\s+coverage/u,
    );
    expect(checkpoint).toMatch(/prior authenticated Browser\s+review/u);
    expect(checkpoint).not.toContain('older remote head');
    expect(checkpoint).not.toContain('pre-sweep pushed head');
    expect(checkpoint).not.toContain('pending GitHub E2E check run');
    expect(checkpoint).not.toContain('remained pending');
    expect(checkpoint).not.toContain('has finished');
    expect(checkpoint).not.toContain(
      '2ec03eda4f9bec47590c472906cfefab90450c13',
    );
    expect(checkpoint).not.toContain(
      '8b39511056dbe3341a7d1b46962734677aee8079',
    );
    expect(checkpoint).not.toContain(
      'd5286954529ae1e62b8f316a964560ad7692a46e',
    );
    expect(checkpoint).not.toContain(
      'd887cf8fad8d9d80c4da422987becb6071cd3196',
    );
    expect(checkpoint).not.toContain(
      'fefe6c984e79cd310a6c07097aa37e044b2427b5',
    );
    expect(checkpoint).not.toContain(
      'fb4a3671f6effc3e52a743571d011f90230a8921',
    );
    expect(checkpoint).not.toContain('two commits ahead');
    expect(checkpoint).not.toContain('1Password agent signing');
    expect(checkpoint).not.toContain('lacks `workflow` scope');
    expect(checkpoint).not.toContain('Browser warning/error logs were empty');
    expect(checkpoint).not.toContain('CI status is green');
  });

  it('keeps the earlier Font Awesome cleanup CI and Neon checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Earlier Font Awesome cleanup CI and Neon checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n- Earlier |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('PR #62 head');
    expect(checkpoint).toContain('74714fc1038a018fa0987a104c3c8ad0b4b31bd1');
    expect(checkpoint).toContain('origin/codex/stabilization-flow-coverage');
    expect(checkpoint).toContain('private Font Awesome registry-auth boundary');
    expect(checkpoint).toContain('private Duotone package');
    expect(checkpoint).toContain('project `.npmrc`');
    expect(checkpoint).toContain('@shared/icons/fontawesome');
    expect(checkpoint).toContain('public npm packages only');
    expect(checkpoint).toContain('bun install --frozen-lockfile');
    expect(checkpoint).toContain(
      'passed\n  locally without Font Awesome registry auth',
    );
    expect(checkpoint).toMatch(
      /later pushed heads moved past\s+the old token failure/u,
    );
    expect(checkpoint).toContain(
      'current local-ahead cache and source-guard follow-ups',
    );
    expect(checkpoint).not.toMatch(/next pushed head\s+should move past/u);
    expect(checkpoint).not.toContain('CodeQL was still running');
    expect(checkpoint).toContain('PARENT_BRANCH_ID');
    expect(checkpoint).toContain('br-soft-forest-a9khi8e8');
    expect(checkpoint).toContain('current head');
    expect(checkpoint).toContain('bounded Neon Local container stop');
    expect(checkpoint).toContain('bounded Compose down with orphan removal');
    expect(checkpoint).toContain('leftover container force-removal');
    expect(checkpoint).toContain(
      'bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(checkpoint).toContain('no Neon Local metadata');
    expect(checkpoint).toMatch(/two-hour\s+active-test TTL/u);
    expect(checkpoint).toContain(
      'total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h',
    );
    expect(checkpoint).toMatch(/exactly\s+one branch,\s+`main`/u);
    expect(checkpoint).toContain('local live Neon API check');
    expect(checkpoint).toContain('focused runtime-preflight');
    expect(checkpoint).toContain('stabilization source guards');
    expect(checkpoint).toContain('WebStorm errors-only diagnostics');
    expect(checkpoint).toContain('stale Playwright webServer container');
    expect(checkpoint).toContain('removed stopped/created service containers');
    expect(checkpoint).toContain(
      'no longer timed out waiting for the webServer',
    );
    expect(checkpoint).toContain('public icon dependency fix');
    expect(checkpoint).toContain('no successful Docker');
    expect(checkpoint).toContain('HTTP 500 for `/events`');
    expect(checkpoint).toMatch(/not reliable\s+evidence/u);
    expect(checkpoint).toContain('viewport-diagnostic slice');
    expect(checkpoint).toContain('covered-control');
    expect(checkpoint).toContain('center-point coordinates');
    expect(checkpoint).toContain(
      'Playwright public General viewport spec discovery',
    );
    expect(checkpoint).toMatch(/exactly\s+one branch total:\s+`main`/u);
    expect(checkpoint).toContain('vertical clipping');
    expect(checkpoint).toContain('fixed/sticky controls');
    expect(checkpoint).toContain('320x740, 390x844, and 1440x900');
    expect(checkpoint).toContain('labelled viewport steps');
    expect(checkpoint).toContain(
      'mobile/general-page matrix cannot be declared without being run',
    );
    expect(checkpoint).not.toContain('Docker startup completed');
    expect(checkpoint).not.toContain('Playwright assertions ran');
    expect(checkpoint).not.toContain(
      'Analyze, CodeQL,\n  CodeRabbit, and Display the branch stack passed on the same pushed head',
    );
  });

  it('keeps the runtime status summary honest after the Font Awesome blocker moved', () => {
    const source = readSource('STABILIZATION.md');
    const baseTestFixture = readSource('tests/support/fixtures/base-test.ts');
    const mcpSeed = readSource('tests/setup/mcp-browser.seed.ts');
    const mcpAuthenticatedSeed = readSource(
      'tests/setup/mcp-browser-authenticated.seed.ts',
    );
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts: Record<string, string>;
    };
    const playwrightConfig = readSource('playwright.config.ts');
    const testInventory = readSource('tests/test-inventory.md');
    const testsReadme = readSource('tests/README.md');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(statusTable).toContain('| Local runtime/developer workflow');
    expect(statusTable).toContain('| Watchpoint | medium');
    expect(statusTable).toContain('Env preflight');
    expect(statusTable).toContain('Neon Local cleanup');
    expect(source).toContain('public Font Awesome install paths');
    expect(statusTable).toContain('CI teardown cleanup');
    expect(statusTable).toContain('first in-app Browser queue pass');
    expect(statusTable).toContain(
      'Historical Docker start-path and unhealthy-container blockers remain recorded as diagnostics',
    );
    expect(statusTable).toContain(
      'later current-state Browser evidence supersedes them',
    );
    expect(statusTable).not.toContain(
      'Fresh current-head Browser verification is currently blocked below the app tooling layer',
    );
    expect(statusTable).not.toContain(
      'unhealthy generated `evorto-4dddca18-db-1`',
    );
    expect(statusTable).not.toMatch(/Docker Desktop is restarted/u);
    expect(statusTable).toContain(
      'public General viewport Playwright browser sweep passed locally',
    );
    expect(statusTable).toContain(
      'direct in-app Browser tab API sweeps rechecked the full anonymous General route set',
    );
    expect(statusTable).toContain('320x740, 390x844, and 1440x900');
    expect(statusTable).toContain('local head `1ab95b1c5`');
    expect(statusTable).toContain(
      'focused in-app Browser mobile refresh rechecked all anonymous General routes',
    );
    expect(statusTable).toContain('320x740 and 390x844');
    expect(statusTable).toContain('local head `a2c1d2e70`');
    expect(statusTable).toContain(
      'current-head direct in-app Browser sweep at local head `6b975474c`',
    );
    expect(statusTable).toContain('top/side clipped visible controls');
    expect(statusTable).toContain(
      'current authenticated in-app Browser probe at local head `c0c83ce2b`',
    );
    expect(statusTable).toContain(
      'checked `/admin/settings`, `/global-admin/tenants`, and `/profile`',
    );
    expect(statusTable).toContain(
      'no horizontal overflow, clipped visible controls, rendered application-error text, Browser warning/error logs, or Auth0 redirect',
    );
    expect(statusTable).toContain(
      'pushed-head Docker/Browser refreshes through PR head `19e5bb0bc`',
    );
    expect(statusTable).toContain(
      'rechecked all anonymous General routes at 320x740, 390x844, and 1440x900',
    );
    expect(statusTable).toContain(
      'Playwright config now uses the repo runtime config provider',
    );
    expect(statusTable).toContain(
      'direct config importers can initialize from generated `.env.dev`',
    );
    expect(statusTable).toContain(
      'Playwright-test MCP Browser planner now recognizes the dedicated `mcp-browser-planner` project',
    );
    expect(statusTable).toContain(
      'opens the seeded `/legal/terms` public General page',
    );
    expect(statusTable).toContain(
      'captures the 320x740 mobile screenshot path after config import',
    );
    expect(statusTable).toContain(
      'dedicated authenticated MCP Browser planner project',
    );
    expect(statusTable).toContain(
      'opens `/admin/settings`, `/global-admin/tenants`, and `/profile`',
    );
    expect(statusTable).toContain(
      'stable logged-in starting points without running the full viewport pack',
    );
    expect(statusTable).toContain(
      'Latest PR status refresh for pushed head `83c5f178`',
    );
    expect(statusTable).toContain(
      'CodeQL, Git Town, Copilot setup, CodeRabbit, the E2E cache warmer, `functional-1`, `functional-2`, and `docs` green',
    );
    expect(statusTable).toContain(
      'E2E run `27054906042` completed all three serialized worker shards on pushed head `83c5f178`',
    );
    expect(statusTable).toContain('warmed Bun, Docker, and Playwright caches');
    expect(statusTable).toContain(
      'each worker confirmed Neon branch expiration',
    );
    expect(statusTable).toContain('recorded Neon Local metadata');
    expect(statusTable).toContain('passed its shard');
    expect(statusTable).toContain('stopped Docker');
    expect(statusTable).toContain('ran the final Neon prune');
    expect(statusTable).toContain(
      'Repo-local Neon cleanup dry-runs after functional-1, functional-2, and docs',
    );
    expect(statusTable).toContain('`total=1`');
    expect(statusTable).toContain('`protected=1`');
    expect(statusTable).toContain('`active_test=0`');
    expect(statusTable).toContain('`stale_deleted=0`');
    expect(statusTable).toContain(
      'only protected `main` remained once every worker released Neon Local',
    );
    expect(statusTable).not.toContain(
      'Current PR status refreshes show visible checks green',
    );
    expect(statusTable).not.toContain('Current PR status refreshes show head');
    expect(statusTable).not.toContain('merge blocked only by draft status');
    expect(statusTable).not.toMatch(/green on the current PR head/u);
    expect(playwrightConfig).toContain(
      "import { makeRuntimeConfigProvider } from './src/server/config/provider';",
    );
    expect(playwrightConfig).toContain(
      'const runtimeConfigProvider = Effect.runSync(makeRuntimeConfigProvider());',
    );
    expect(playwrightConfig).toContain(
      'Effect.provideService(ConfigProvider.ConfigProvider, runtimeConfigProvider)',
    );
    expect(playwrightConfig).toContain("name: 'mcp-browser-planner'");
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /mcp-browser\.seed\.ts$/`,
    );
    expect(playwrightConfig).toContain(
      "name: 'mcp-browser-authenticated-planner'",
    );
    expect(playwrightConfig).toContain("dependencies: ['setup']");
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /mcp-browser-authenticated\.seed\.ts$/`,
    );
    expect(baseTestFixture).toContain(
      "import { makeRuntimeConfigProvider } from '../../../src/server/config/provider';",
    );
    expect(baseTestFixture).toContain(
      'const runtimeConfigProvider = Effect.runSync(makeRuntimeConfigProvider());',
    );
    expect(baseTestFixture).toContain(
      "process.env['STRIPE_TEST_ACCOUNT_ID'] ??= environment.STRIPE_TEST_ACCOUNT_ID;",
    );
    expect(mcpSeed).toContain(
      "test('open public General page for MCP Browser planning'",
    );
    expect(mcpSeed).toContain("await page.goto('/legal/terms');");
    expect(mcpSeed).toContain(
      "await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible();",
    );
    expect(mcpAuthenticatedSeed).toContain(
      'test.use({ storageState: adminStateFile });',
    );
    expect(mcpAuthenticatedSeed).toContain(
      'test.use({ storageState: gaStateFile });',
    );
    expect(mcpAuthenticatedSeed).toContain(
      'test.use({ storageState: userStateFile });',
    );
    expect(mcpAuthenticatedSeed).toContain(
      "await page.goto('/admin/settings');",
    );
    expect(mcpAuthenticatedSeed).toContain(
      "await page.goto('/global-admin/tenants');",
    );
    expect(mcpAuthenticatedSeed).toContain("await page.goto('/profile');");
    expect(mcpAuthenticatedSeed).toContain(
      "page.getByRole('button', { name: 'Edit profile' })",
    );
    expect(packageJson.scripts).toHaveProperty('test:e2e:mcp-browser-planner');
    expect(packageJson.scripts['test:e2e:mcp-browser-planner']).toContain(
      '--project=mcp-browser-planner',
    );
    expect(packageJson.scripts['test:e2e:mcp-browser-planner']).toContain(
      '--no-webserver',
    );
    expect(packageJson.scripts['test:e2e:mcp-browser-planner']).toContain(
      'bun helpers/testing/run-playwright.ts',
    );
    expect(packageJson.scripts['test:e2e:mcp-browser-planner']).toContain(
      '--no-deps',
    );
    expect(packageJson.scripts).toHaveProperty(
      'test:e2e:mcp-browser-authenticated-planner',
    );
    expect(
      packageJson.scripts['test:e2e:mcp-browser-authenticated-planner'],
    ).toContain('--project=mcp-browser-authenticated-planner');
    expect(testInventory).toContain('tests/setup/mcp-browser.seed.ts');
    expect(testInventory).toContain('mcp-browser-planner');
    expect(testInventory).toContain('test:e2e:mcp-browser-planner');
    expect(testInventory).toContain(
      'tests/setup/mcp-browser-authenticated.seed.ts',
    );
    expect(testInventory).toContain('mcp-browser-authenticated-planner');
    expect(testsReadme).toContain('bun run test:e2e:mcp-browser-planner');
    expect(testsReadme).toContain('opens the public Terms page');
    expect(testsReadme).toContain(
      'bun run test:e2e:mcp-browser-authenticated-planner',
    );
    expect(testsReadme).toContain(
      'opens tenant-admin General settings, global-admin Tenants, and Profile',
    );
    expect(playwrightConfig).not.toContain(
      'Effect.provideService(\n      ConfigProvider.ConfigProvider,\n      ConfigProvider.fromEnv(),\n    )',
    );
    expect(statusTable).not.toContain(
      '| Local runtime/developer workflow                | Stabilized',
    );
    expect(source).toContain(
      'timeout-bounds project-label discovery and force-removal for leftover Compose containers during shutdown',
    );
    expect(source).not.toContain(
      'current CI and local Docker build/start validation remain blocked before app startup by an invalid Font Awesome registry token',
    );
    expect(source).not.toContain(
      'the current Browser runtime reconnect are healthy',
    );
  });

  it('keeps page-backed Playwright tenant seeding unique across repeat no-deps runs', () => {
    const source = readSource('STABILIZATION.md');
    const inventory = readSource('tests/test-inventory.md');
    const testsReadme = readSource('tests/README.md');
    const parallelFixture = readSource(
      'tests/support/fixtures/parallel-test.ts',
    );

    expect(parallelFixture).toContain(
      "import { seed as seedFalso } from '@ngneat/falso';",
    );
    expect(parallelFixture).toContain('executionSeedNonce');
    expect(parallelFixture).toContain('crypto.randomBytes(4).toString');
    expect(parallelFixture).toContain(
      'execution-${executionSeedNonce}:retry-${testInfo.retry}',
    );
    expect(parallelFixture).toContain('seedFalso(seed)');
    expect(parallelFixture).toContain('const runId = buildRunId(seed)');
    expect(testsReadme).toContain('per-process execution nonce');
    expect(testsReadme).toContain('repeated\n  `--no-deps` runs');
    expect(testsReadme).toContain('same tenant\n  primary keys');
    expect(inventory).toContain('per-process execution nonce');
    expect(inventory).toContain('repeated `--no-deps` runs');
    expect(inventory).toContain('same tenant primary keys');
    expect(source).toContain('per-process execution nonce');
    expect(source).toContain('same tenant primary keys');
  });

  it('keeps the dev-runtime Browser retry checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts: Record<string, string>;
    };
    const helpersReadme = readSource('helpers/README.md');
    const testsReadme = readSource('tests/README.md');
    const inventory = readSource('tests/test-inventory.md');
    const runtimePreflight = readSource('helpers/testing/runtime-preflight.ts');
    const composePortOwners = readSource(
      'helpers/testing/evorto-compose-port-owners.ts',
    );
    const composePortOwnersSpec = readSource(
      'helpers/testing/evorto-compose-port-owners.spec.ts',
    );
    const copyMainEnvironment = readSource(
      'helpers/testing/copy-main-environment.ts',
    );
    const runtimePreflightSpec = readSource(
      'helpers/testing/runtime-preflight.spec.ts',
    );
    const localRuntimeStatus = readSource(
      'helpers/testing/local-runtime-status.ts',
    );
    const localRuntimeStatusSpec = readSource(
      'helpers/testing/local-runtime-status.spec.ts',
    );
    const localAppRouteProbe = readSource(
      'helpers/testing/local-app-route-probe.ts',
    );
    const localAppRouteProbeSpec = readSource(
      'helpers/testing/local-app-route-probe.spec.ts',
    );
    const copyMainEnvironmentSpec = readSource(
      'helpers/testing/copy-main-environment.spec.ts',
    );

    expect(source).toContain('Earlier Browser/dev-runtime retry checkpoint');
    expect(source).toContain('`bun run dev:start` built the');
    expect(source).toContain('loopback port 4224');
    expect(source).toContain('/events` returned HTTP 500');
    expect(source).toContain('server-side Effect stack');
    expect(source).toContain('IPv6 loopback only');
    expect(source).toContain('generated dev `DATABASE_URL` pointing at');
    expect(source).toContain('localhost:55443');
    expect(source).toContain('older\n  Docker app on port 4200');
    expect(source).toContain('not current-branch Browser evidence');
    expect(source).toContain('probes the configured public app route');
    expect(source).toContain(
      'stale or broken port-4200 stack cannot be mistaken for current Browser evidence',
    );
    expect(source).toContain(
      'HTTP-error route-probe message now points operators at `bun run docker:check`',
    );
    expect(source).toContain('share one Docker Compose port-owner\nparser');
    expect(source).toContain('another `evorto-*` project\nowns');
    expect(source).toContain('without\nstopping that stack automatically');
    expect(source).toContain('runs `dev:check` before Angular starts');
    expect(source).toContain('binds the dev server to `0.0.0.0`');
    expect(source).toContain('covered-control detection');
    expect(source).toMatch(/Fresh Browser layout evidence\s+still requires/u);
    expect(source).toContain('then-current Font Awesome install blocker');
    expect(source).not.toMatch(
      /from the\s+current Font Awesome install blocker/u,
    );
    expect(source).not.toContain('current local source slice');
    expect(source).not.toContain('dev-runtime Browser evidence passed');
    expect(packageJson.scripts['dev:check']).toBe(
      'bun run env:runtime && dotenv -c dev -- bun helpers/testing/runtime-preflight.ts dev',
    );
    expect(packageJson.scripts['dev:bootstrap']).toBe(
      'bun run env:copy-main -- --if-missing && bun run dev:check',
    );
    expect(packageJson.scripts['dev:start']).toContain('bun run dev:bootstrap');
    expect(packageJson.scripts['dev:start']).toContain('--host 0.0.0.0');
    expect(helpersReadme).toContain(
      'a generated `.env.dev` that points at\na closed Neon Local port fails before the dev server starts returning SSR HTTP\n500 pages',
    );
    expect(helpersReadme).toContain('Use `bun run dev:status`');
    expect(helpersReadme).toContain('A closed port is\nreported as a skip');
    expect(helpersReadme).toContain(
      'identify whether another Evorto Compose\nproject owns the selected port',
    );
    expect(helpersReadme).toContain('route probe skips the HTTP request');
    expect(helpersReadme).toContain('leaves\nthat other stack running');
    expect(localRuntimeStatus).toContain('local-app-route-probe.ts');
    expect(localAppRouteProbe).toContain(
      "const defaultRoutePath = '/legal/terms'",
    );
    expect(localAppRouteProbe).toContain('No app currently serves');
    expect(localAppRouteProbe).toContain('returned HTTP ${response.status}');
    expect(localAppRouteProbe).toContain(
      'Run bun run docker:check to confirm whether another Evorto stack owns the selected port',
    );
    expect(localAppRouteProbe).toContain('findOtherEvortoComposePortOwners');
    expect(runtimePreflight).toContain(
      'findOtherEvortoComposePortOwnersFromDockerPs',
    );
    expect(composePortOwners).toContain(
      'findOtherEvortoComposePortOwnersFromDockerPs',
    );
    expect(composePortOwners).toContain("project.startsWith('evorto-')");
    expect(composePortOwnersSpec).toContain(
      'returns other Evorto Compose projects publishing the selected port',
    );
    expect(composePortOwnersSpec).toContain(
      'ignores unrelated projects, non-matching ports, and malformed rows',
    );
    expect(localAppRouteProbe).toContain(
      'Skipping app route probe for ${probeUrl.toString()} because another Evorto Compose project is publishing that port.',
    );
    expect(localAppRouteProbe).toContain(
      'COMPOSE_PROJECT_NAME=${project} docker compose down',
    );
    expect(localAppRouteProbeSpec).toContain(
      'does not fail when no app is currently listening',
    );
    expect(localAppRouteProbeSpec).toContain(
      'fails when an already-running local app returns an HTTP error',
    );
    expect(localAppRouteProbeSpec).toContain(
      'skips route probing when another Evorto checkout owns the local port',
    );
    expect(localAppRouteProbeSpec).toContain(
      'before using this app for Browser evidence',
    );
    expect(testsReadme).toContain(
      'If the generated local `DATABASE_URL`\n  points at a closed Neon Local port',
    );
    expect(runtimePreflight).toContain('developerSecretsFileCheck');
    expect(runtimePreflight).toContain('missingRequiredVariableDetails');
    expect(runtimePreflight).toContain(
      'Missing variables may be recoverable from the main checkout secrets file.',
    );
    expect(runtimePreflight).toContain(
      'Run `bun run env:copy-main -- --if-missing` to copy only `.env` from the default main checkout, then retry the original command.',
    );
    expect(runtimePreflight).toContain(
      'MAIN_CHECKOUT_DIR=/path/to/repo bun run env:copy-main -- --if-missing',
    );
    expect(runtimePreflight).toContain(
      'For a fresh dev-server worktree, run `bun run dev:bootstrap`.',
    );
    expect(runtimePreflight).toContain(
      'Found a main-checkout developer secrets file',
    );
    expect(runtimePreflight).toContain(
      'Copy it safely with: bun run env:copy-main -- --if-missing',
    );
    expect(runtimePreflight).toContain(
      'For a fresh dev-server worktree, run: bun run dev:bootstrap',
    );
    expect(runtimePreflight).toContain(
      '`Source: ${mainCheckoutEnvironmentPath}`',
    );
    expect(runtimePreflight).toContain(
      'Do not copy .env.dev or .npmrc; .env.dev is generated per worktree',
    );
    expect(runtimePreflight).not.toContain('copyFileSync');
    expect(packageJson.scripts['env:copy-main']).toBe(
      'bun helpers/testing/copy-main-environment.ts',
    );
    expect(copyMainEnvironment).toContain('env?: NodeJS.ProcessEnv');
    expect(copyMainEnvironment).toContain(
      'const environment = options.env ?? process.env',
    );
    expect(copyMainEnvironment).toContain("environment['MAIN_CHECKOUT_DIR']");
    expect(copyMainEnvironment).toContain("path.join(mainCheckout, '.env')");
    expect(copyMainEnvironment).toContain(
      'const argv = options.argv ?? process.argv',
    );
    expect(copyMainEnvironment).toContain("argv.includes('--force')");
    expect(copyMainEnvironment).toContain("argv.includes('--if-missing')");
    expect(copyMainEnvironment).toContain(
      'already exists; leaving it unchanged',
    );
    expect(copyMainEnvironment).toContain('Do not copy .env.dev or .npmrc');
    expect(copyMainEnvironment).not.toContain("'.env.dev'");
    expect(copyMainEnvironment).toContain('export const copyMainEnvironment');
    expect(copyMainEnvironmentSpec).toContain(
      'copies only the main checkout .env into the current worktree',
    );
    expect(copyMainEnvironmentSpec).toContain(
      '@fortawesome:registry=https://npm.fontawesome.com/',
    );
    expect(copyMainEnvironmentSpec).toContain(
      "fs.existsSync(path.join(repositoryRoot, '.npmrc'))",
    );
    expect(copyMainEnvironmentSpec).toContain(
      'refuses to overwrite an existing worktree .env unless forced',
    );
    expect(copyMainEnvironmentSpec).toContain(
      'leaves an existing worktree .env unchanged when if-missing is requested',
    );
    expect(copyMainEnvironmentSpec).toContain(
      'does not require a source checkout when if-missing finds an existing worktree .env',
    );
    expect(copyMainEnvironmentSpec).toContain('MAIN_CHECKOUT_DIR');
    expect(copyMainEnvironmentSpec).toContain(String.raw`env\.example`);
    expect(copyMainEnvironmentSpec).toContain(
      "fs.existsSync(path.join(repositoryRoot, '.env.dev'))",
    );
    expect(helpersReadme).toContain('bun run env:copy-main');
    expect(helpersReadme).toContain('bun run dev:bootstrap');
    expect(helpersReadme).toContain(
      'leave it unchanged before source-checkout lookup',
    );
    expect(testsReadme).toContain('bun run env:copy-main');
    expect(testsReadme).toContain('bun run dev:bootstrap');
    expect(source).toContain('`bun run env:copy-main`');
    expect(source).toContain('`bun run dev:bootstrap`');
    expect(runtimePreflightSpec).toContain(
      'points missing-secret worktrees at the main checkout env file when it exists',
    );
    expect(runtimePreflightSpec).toContain(
      'Missing variables may be recoverable from the main checkout secrets file.',
    );
    expect(runtimePreflightSpec).toContain(
      'Run `bun run env:copy-main -- --if-missing` to copy only `.env` from the default main checkout, then retry the original command.',
    );
    expect(runtimePreflightSpec).toContain(
      'points missing-secret checkouts at the no-secret env checklist when no main env exists',
    );
    expect(helpersReadme).toContain(
      'failed required-variable row and the developer-secrets warning both point at\n`bun run env:copy-main -- --if-missing`',
    );
    expect(testsReadme).toContain('sibling main checkout `.env`');
    expect(inventory).toContain('missing-secret recovery hint');
    expect(inventory).toContain('bun run dev:bootstrap');
    expect(inventory).toContain('env:copy-main --if-missing');
    expect(inventory).toContain('package-script shell conditional');
    expect(inventory).toContain('no-ops before\n  source-checkout lookup');
    expect(inventory).toContain(
      'helpers/testing/copy-main-environment.spec.ts',
    );
    expect(inventory).toContain('overwrite refusal unless `--force`');
    expect(localRuntimeStatus).toContain('export const statusCommands');
    expect(localRuntimeStatus).toContain('export const runLocalRuntimeStatus');
    expect(localRuntimeStatus).toContain('if (import.meta.main)');
    expect(localRuntimeStatusSpec).toContain(
      'runs every local runtime status check and reports success',
    );
    expect(localRuntimeStatusSpec).toContain(
      'keeps running after failed checks and reports the failed labels together',
    );
    expect(localRuntimeStatusSpec).toContain(
      'reports command startup failures as failed status checks',
    );
    expect(inventory).toContain('helpers/testing/local-runtime-status.spec.ts');
    expect(inventory).toContain('failed labels stay\n  grouped together');
  });

  it('keeps the active-test Neon branch cleanup checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const workflow = readSource('.github/workflows/e2e-baseline.yml');
    const cleanupWorkflow = readSource(
      '.github/workflows/neon-branch-cleanup.yml',
    );
    const ciPruneHelper = readSource(
      'helpers/testing/ci-prune-neon-local-branches.sh',
    );
    const ciRuntimeValidationHelper = readSource(
      'helpers/testing/validate-ci-runtime-env.sh',
    );
    const ciStopDockerStackHelper = readSource(
      'helpers/testing/ci-stop-docker-stack.sh',
    );
    const helpersReadme = readSource('helpers/README.md');
    const testsReadme = readSource('tests/README.md');
    const inventory = readSource('tests/test-inventory.md');
    const checkpoint = source.match(
      /Current Neon active-test branch cleanup checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('PARENT_BRANCH_ID');
    expect(checkpoint).toContain('ephemeral branch');
    expect(checkpoint).toContain('DELETE_BRANCH=true');
    expect(checkpoint).toContain('exactly one branch, `main`');
    expect(checkpoint).toContain('br-soft-forest-a9khi8e8');
    expect(checkpoint).toMatch(/two-hour\s+active-test TTL/u);
    expect(checkpoint).toContain('sanitized cleanup summary');
    expect(checkpoint).toContain('total, protected, active-test');
    expect(checkpoint).toContain('stale-deleted branch counts');
    expect(checkpoint).toMatch(/active\s+branches still inside the TTL/u);
    expect(checkpoint).toContain('NEON_LOCAL_FORCE_DELETE_BRANCH_IDS');
    expect(checkpoint).toContain('confirmed-inactive young branch');
    expect(checkpoint).toContain('through `bun run neon:cleanup`');
    expect(checkpoint).toContain('refusing protected branches');
    expect(checkpoint).toContain('default CI cleanup TTL-conservative');
    expect(checkpoint).toContain('CI must not set `BRANCH_ID`');
    expect(checkpoint).toContain(
      "Neon Local's documented default project branch",
    );
    expect(normalizeWhitespace(checkpoint ?? '')).toContain(
      'persistent branch modes remain explicit local opt-ins',
    );
    expect(checkpoint).toMatch(/GitHub\s+E2E mechanism/u);
    expect(checkpoint).toContain('delete_timeline');
    expect(checkpoint).toContain('status/log/debug/stop/down/kill/remove');
    expect(checkpoint).toMatch(
      /timeout-bound Docker\s+log\/status collection and server-log copy/u,
    );
    expect(checkpoint).toContain('uses the generated dotenv');
    expect(checkpoint).toMatch(/exported dependency-free CI\s+environment/u);
    expect(checkpoint).toContain('matches startup');
    expect(checkpoint).toMatch(/exported\s+CI Compose project/u);
    expect(checkpoint).toContain('timed stop/down path wraps');
    expect(checkpoint).toContain('real Compose executable');
    expect(checkpoint).toMatch(
      /force-removes\s+leftover\s+Compose containers/u,
    );
    expect(checkpoint).toMatch(/timeout-bound project-label discovery/u);
    expect(checkpoint).toMatch(/force-remove,\s+and Neon API cleanup/u);
    expect(checkpoint).toMatch(/whole-stack\s+`compose kill` fallback/u);
    expect(checkpoint).toMatch(
      /bounds\s+the\s+whole-stack\s+`compose kill` and `compose rm`/u,
    );
    expect(checkpoint).toMatch(/10-minute cleanup\s+step timeout/u);
    expect(checkpoint).toMatch(/5-minute final\s+prune timeout/u);
    expect(checkpoint).toContain('only `main` should remain');
    expect(checkpoint).toContain('Neon Branch Cleanup');
    expect(checkpoint).toContain('hourly');
    expect(checkpoint).toContain('manual dispatch');
    expect(checkpoint).toContain('after the E2E workflow completes');
    expect(checkpoint).toContain('contents: read');
    expect(checkpoint).toContain('non-canceling `neon-branch-cleanup`');
    expect(checkpoint).toMatch(/required\s+`NEON_API_KEY`\/`NEON_PROJECT_ID`/u);
    expect(checkpoint).toMatch(/10-minute job timeout/u);
    expect(checkpoint).toMatch(/canceled\s+or crashed GitHub runner/u);
    expect(checkpoint).toMatch(/Font Awesome registry auth can\s+fail/u);
    expect(checkpoint).toMatch(/currently active\s+tests/u);
    expect(checkpoint).toContain('bde138ec9411543b2d303b94ea021854755e4c18');
    expect(checkpoint).toContain('all three matrix jobs');
    expect(checkpoint).toContain('CodeQL and Git Town passed');
    expect(checkpoint).toMatch(/final dependency-free\s+prune/u);
    expect(checkpoint).toContain(
      'total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h',
    );
    expect(checkpoint).toContain('Font Awesome\n  bandwidth-cache slice');
    expect(checkpoint).toContain('no Neon Local metadata');
    expect(checkpoint).toMatch(/workflow-scoped\s+push\s+auth/u);
    expect(checkpoint).toContain('fresh current-branch live cleanup');
    expect(checkpoint).toContain('generated `.env.dev` dotenv cascade');
    expect(checkpoint).toContain('/tmp/.neon_local/.branches');
    expect(checkpoint).toMatch(/no stale Neon\s+Local branches outside/u);
    expect(checkpoint).toMatch(/active-test rule/u);
    expect(checkpoint).toMatch(/only the protected branch remains/u);
    expect(checkpoint).toMatch(/before Docker\s+startup/u);
    expect(checkpoint).toMatch(/separate\s+dependency-free `if: always\(\)`/u);
    expect(checkpoint).toContain('not the only in-job cleanup path');
    expect(checkpoint).toContain('project (`polished-frost-79768881`)');
    expect(checkpoint).toMatch(/zero active-test branches\s+inside/u);
    expect(checkpoint).toContain('1083690b2b4518ca4ef4701dc1b92cb35286c489');
    expect(checkpoint).toContain('.github/workflows/neon-branch-cleanup.yml');
    expect(checkpoint).toMatch(/not present on the default branch/u);
    expect(checkpoint).toContain(
      'scheduled and\n  `workflow_run` cleanup hooks',
    );
    expect(checkpoint).toContain('cancel-in-progress: true');
    expect(checkpoint).toMatch(/stale same-ref\s+Docker\/Neon jobs/u);
    expect(checkpoint).toContain('standalone workflow-run cleanup');
    expect(checkpoint).toMatch(/final dependency-free\s+prune/u);
    expect(checkpoint).toMatch(/no longer\s+block the current PR head/u);
    expect(checkpoint).toMatch(/repeated Font Awesome cache warmups/u);
    expect(checkpoint).toContain('helpers/testing/validate-ci-runtime-env.sh');
    expect(checkpoint).toMatch(/same Neon credential checks/u);
    expect(checkpoint).toMatch(/additional Auth0 and Stripe checks/u);
    expect(checkpoint).toContain('cache-warmer prune');
    expect(checkpoint).toContain('scheduled `Neon Branch Cleanup`');
    expect(checkpoint).toContain(
      'wrapper exits with a notice when Neon credentials are absent',
    );
    expect(checkpoint).not.toContain('four-hour');
    expect(checkpoint).not.toContain('fourteen branches remain');

    expect(workflow).toContain('group: e2e-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain(
      'run: bash helpers/testing/validate-ci-runtime-env.sh e2e',
    );
    expect(ciRuntimeValidationHelper).toContain('require_neon_cleanup_env');
    expect(ciRuntimeValidationHelper).toContain(
      'require_secret "NEON_API_KEY"',
    );
    expect(ciRuntimeValidationHelper).toContain(
      'require_repository_variable "NEON_PROJECT_ID"',
    );
    expect(ciRuntimeValidationHelper).toContain(
      'PARENT_BRANCH_ID is not configured; Neon Local will create ephemeral E2E branches from the project default branch.',
    );
    expect(ciRuntimeValidationHelper).toContain(
      'Missing required Stripe connected account id. Set STRIPE_TEST_ACCOUNT_ID as a secret or repository variable.',
    );
    expect(ciRuntimeValidationHelper).toContain(
      'Missing required Auth0 issuer URL. Set ISSUER_BASE_URL as a secret or repository variable.',
    );
    expect(workflow).not.toContain('resolved_parent_branch_id');
    expect(workflow).not.toContain(
      'https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches',
    );

    const pruneBeforeE2EIndex = workflow.indexOf(
      'Prune expired Neon branches before E2E',
    );
    expect(pruneBeforeE2EIndex).toBeLessThan(
      workflow.indexOf('- name: Install dependencies', pruneBeforeE2EIndex),
    );
    expect(pruneBeforeE2EIndex).toBeLessThan(
      workflow.indexOf(
        'Refusing a parallel registry install to avoid repeated Font Awesome package downloads.',
        pruneBeforeE2EIndex,
      ),
    );
    expect(workflow).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose logs -f --no-color',
    );
    expect(workflow).toContain('compose() {');
    expect(workflow).toContain('if [ -x node_modules/.bin/dotenv ]; then');
    expect(workflow).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose "$@"',
    );
    expect(workflow).toContain('docker compose "$@"');
    expect(workflow).toContain('compose_timeout() {');
    expect(workflow).toContain(
      'timeout 90s node_modules/.bin/dotenv -c dev -- docker compose "$@"',
    );
    expect(workflow).toContain('timeout 90s docker compose "$@"');
    expect(workflow).toContain(
      'compose_timeout logs --no-color > test-results/docker-logs/docker-compose.log || true',
    );
    expect(workflow).toContain(
      'evorto_container_id="$(compose_timeout ps -q evorto || true)"',
    );
    expect(workflow).toContain(
      'timeout 30s docker cp "${evorto_container_id}:/app/logs/server.log" test-results/docker-logs/server.log || true',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout stop --timeout 60 db || true',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout down --timeout 60 --remove-orphans || true',
    );
    expect(workflow).not.toContain('timeout 90s compose ');
    expect(workflow).toContain('timeout-minutes: 10');
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-stop-docker-stack.sh',
    );
    expect(ciStopDockerStackHelper).toContain(
      'compose_timeout rm --force --stop -v || true',
    );
    expect(ciStopDockerStackHelper).toContain('compose_timeout kill || true');
    expect(ciStopDockerStackHelper).toContain(
      'timeout 30s docker ps -aq --filter "label=com.docker.compose.project=${compose_project_name}"',
    );
    expect(ciStopDockerStackHelper).toContain(
      'for compose_container_id in ${compose_container_ids}; do',
    );
    expect(ciStopDockerStackHelper).toContain(
      'timeout 45s docker rm -f -v "${compose_container_id}" || true',
    );
    expect(ciStopDockerStackHelper).not.toContain(
      'timeout 90s docker rm -f -v ${compose_container_ids}',
    );
    expect(ciPruneHelper).toContain(
      'NEON_LOCAL_METADATA_DIR="${NEON_LOCAL_METADATA_DIR:-/tmp/neon-local-metadata}"',
    );
    expect(ciPruneHelper).toContain('NEON_PROJECT_ID="${NEON_PROJECT_ID:-}"');
    expect(ciPruneHelper).toContain(
      'Skipping Neon cleanup because NEON_API_KEY or NEON_PROJECT_ID is not configured.',
    );
    expect(ciPruneHelper).toContain(
      'bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(ciStopDockerStackHelper).toContain(
      'timeout 5m bash helpers/testing/ci-prune-neon-local-branches.sh || true',
    );
    expect(
      ciStopDockerStackHelper.indexOf(
        'timeout 5m bash helpers/testing/ci-prune-neon-local-branches.sh || true',
      ),
    ).toBeGreaterThan(
      ciStopDockerStackHelper.lastIndexOf('remove_compose_project_containers'),
    );
    expect(workflow).toContain('Prune expired Neon branches after E2E');
    expect(workflow).toContain('timeout-minutes: 5');
    expect(workflow).toContain(
      'bash helpers/testing/ci-prune-neon-local-branches.sh 2>&1 | tee test-results/neon-local/final-prune.log',
    );
    expect(workflow).toContain('Record Neon Local branch metadata');
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-record-neon-local-metadata.sh',
    );
    expect(workflow.indexOf('Stop Docker stack')).toBeLessThan(
      workflow.indexOf('Prune expired Neon branches after E2E'),
    );
    expect(
      workflow.indexOf('Prune expired Neon branches after E2E'),
    ).toBeLessThan(workflow.indexOf('Upload Playwright test results'));

    expect(cleanupWorkflow).toContain('name: Neon Branch Cleanup');
    expect(cleanupWorkflow).toContain('workflow_dispatch:');
    expect(cleanupWorkflow).toContain('workflow_run:');
    expect(cleanupWorkflow).toContain('workflows: ["E2E Baseline"]');
    expect(cleanupWorkflow).toContain('schedule:');
    expect(cleanupWorkflow).toContain('permissions:');
    expect(cleanupWorkflow).toContain('contents: read');
    expect(cleanupWorkflow).toContain('concurrency:');
    expect(cleanupWorkflow).toContain('group: neon-branch-cleanup');
    expect(cleanupWorkflow).toContain('cancel-in-progress: false');
    expect(cleanupWorkflow).toContain('DELETE_BRANCH: true');
    expect(cleanupWorkflow).toContain(
      'NEON_API_KEY: ${{ secrets.NEON_API_KEY }}',
    );
    expect(cleanupWorkflow).toContain('NEON_LOCAL_BRANCH_TTL_HOURS: 2');
    expect(cleanupWorkflow).toContain(
      'NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}',
    );
    expect(cleanupWorkflow).toContain('timeout-minutes: 10');
    expect(cleanupWorkflow).toContain('Validate required configuration');
    expect(cleanupWorkflow).toContain(
      'run: bash helpers/testing/validate-ci-runtime-env.sh neon-cleanup',
    );
    expect(cleanupWorkflow).not.toContain('if [ -z "${NEON_API_KEY}" ]');
    expect(cleanupWorkflow).toContain(
      'Prune branches outside the active-test TTL',
    );
    expect(cleanupWorkflow).toContain(
      'run: bash helpers/testing/ci-prune-neon-local-branches.sh',
    );
    expect(helpersReadme).toContain(
      'cache warmer, E2E pre-run prune, post-teardown prune',
    );
    expect(helpersReadme).toContain(
      'exits cleanly when Neon credentials are absent',
    );
    expect(testsReadme).toContain(
      'cache-warmer, pre-run, final, and standalone-workflow prune paths',
    );
    expect(inventory).toContain('missing-credential\n  notice');
  });

  it('keeps the latest template-extra post-push CI checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current template-extra post-push CI checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('445967d29e2be2ecfaab7be3895862bcb2448241');
    expect(checkpoint).toContain('Analyze');
    expect(checkpoint).toContain('CodeQL');
    expect(checkpoint).toContain('CodeRabbit');
    expect(checkpoint).toContain('Display the branch stack');
    expect(checkpoint).toContain('Copilot setup');
    expect(checkpoint).toContain('Playwright E2E docs');
    expect(checkpoint).toContain('Playwright E2E functional-1');
    expect(checkpoint).toContain('Playwright E2E functional-2');
    expect(checkpoint).toContain('create-from-template spec');
    expect(checkpoint).toMatch(/copied\s+reusable template add-ons/u);
    expect(checkpoint).toContain('add-on registration-option attachments');
    expect(checkpoint).toContain('registration questions');
    expect(checkpoint).toContain('three active Neon Local');
    expect(checkpoint).toContain('exactly one branch: `main`');
    expect(checkpoint).toContain(
      'bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(checkpoint).toContain(
      'total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h',
    );
    expect(checkpoint).toMatch(/active-test branch invariant is\s+restored/u);
  });

  it('keeps the Font Awesome bandwidth mitigation checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const workflow = readSource('.github/workflows/e2e-baseline.yml');
    const ciStartDockerStackHelper = readSource(
      'helpers/testing/ci-start-docker-stack.sh',
    );
    const copilotWorkflow = readSource(
      '.github/workflows/copilot-setup-steps.yml',
    );
    const cleanupWorkflow = readSource(
      '.github/workflows/neon-branch-cleanup.yml',
    );
    const bunfig = readSource('bunfig.toml');
    const dockerignore = readSource('.dockerignore');
    const fontAwesomeIconUsageSpec = readSource(
      'src/app/shared/components/icon/font-awesome-icon-usage.spec.ts',
    );
    const ciBuildCacheCompose = readSource(
      '.github/docker-compose.build-cache.yml',
    );
    const fontAwesomeCiHelper = readSource(
      'helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    const ciInstallHelper = readSource(
      'helpers/testing/install-ci-dependencies.sh',
    );
    const ciDependencyCacheAction = readSource(
      '.github/actions/setup-bun-dependency-caches/action.yml',
    );
    const codexEnvironment = readSource('.codex/environments/environment.toml');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Font Awesome bandwidth mitigation checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('~/.bun/install/cache');
    expect(checkpoint).toMatch(
      /OS\/Bun-version\/package\/config\/patch-hash\s+keyed/u,
    );
    expect(checkpoint).toContain('node_modules');
    expect(checkpoint).toContain('skip the registry');
    expect(checkpoint).toContain('cache misses still run');
    expect(checkpoint).toContain('serial cache warmer');
    expect(checkpoint).toContain(
      'pushed head\n  `1083690b2b4518ca4ef4701dc1b92cb35286c489`',
    );
    expect(checkpoint).toMatch(/restored the Bun package cache/u);
    expect(checkpoint).toMatch(/restored the dependency-tree cache/u);
    expect(checkpoint).toMatch(/skipped `bun install`/u);
    expect(checkpoint).toMatch(/restored the Docker\s+Bun cache mount/u);
    expect(checkpoint).toMatch(/completed the Angular bundle/u);
    expect(checkpoint).toMatch(/full Compose app build/u);
    expect(checkpoint).toMatch(/dependencies` target/u);
    expect(checkpoint).toMatch(/8-minute timeout/u);
    expect(checkpoint).toMatch(/evorto-dependencies/u);
    expect(checkpoint).toMatch(
      /bun install --frozen-lockfile --cache-dir\s+~\/\.bun\/install\/cache/u,
    );
    expect(checkpoint).toMatch(
      /bun install --frozen-lockfile --offline --cache-dir\s+~\/\.bun\/install\/cache/u,
    );
    expect(checkpoint).toContain('actions/cache/save@v4');
    expect(checkpoint).toContain('successful warm or offline install');
    expect(checkpoint).toContain('before Playwright browser');
    expect(checkpoint).toMatch(/refreshes\s+the shared caches/u);
    expect(checkpoint).toMatch(
      /Lock,\s+package,\s+Bun config,\s+or patch changes intentionally\s+invalidate/u,
    );
    expect(checkpoint).toContain('node_modules/.bin/playwright');
    expect(checkpoint).toMatch(/no longer\s+call\s+`bunx\s+playwright`/u);
    expect(checkpoint).toContain('bun install --frozen-lockfile');
    expect(checkpoint).toContain('pushed head `49782fc8c`');
    expect(checkpoint).toContain('actions/cache/restore@v4');
    expect(checkpoint).toContain('Linux-bun-1.3.11-');
    expect(checkpoint).toContain('steps.bun-dependency-caches.outputs');
    expect(checkpoint).toContain('`false`');
    expect(checkpoint).toContain('Bun package cache restored:');
    expect(checkpoint).toContain('restore-key package cache');
    expect(checkpoint).toContain('npm.fontawesome.com');
    expect(checkpoint).toContain('FONT_AWESOME_TOKEN');
    expect(checkpoint).toContain('private Duotone');
    expect(checkpoint).toContain('current local branch');
    expect(checkpoint).toMatch(/E2E\s+cache warmer/u);
    expect(checkpoint).toMatch(/app diagnostics logging\s+guard/u);
    expect(checkpoint).toMatch(/related\s+docs\/source guards/u);
    expect(checkpoint).not.toContain('ba5518d9d');
    expect(checkpoint).toContain('workflow-file updates');
    expect(checkpoint).toMatch(/workflow-scoped\s+push\s+auth/u);
    expect(checkpoint).toMatch(/Earlier push attempts/u);
    expect(checkpoint).toMatch(/hung in the SSH transport/u);
    expect(checkpoint).toMatch(/timed out before updating/u);
    expect(checkpoint).toMatch(/branch was clean/u);
    expect(checkpoint).toContain('544b64a7a');
    expect(checkpoint).toMatch(/ahead of origin by 107\s+commits/u);
    expect(checkpoint).toContain(
      'sign_and_send_pubkey: signing failed for ED25519 "Github"',
    );
    expect(checkpoint).toMatch(/agent refused operation/u);
    expect(checkpoint).toMatch(/GitHub public-key denial/u);
    expect(checkpoint).toContain('gh auth status');
    expect(checkpoint).toMatch(/`gist`,\s+`read:org`, and `repo` scopes/u);
    expect(checkpoint).toMatch(/cannot\s+be pushed through\s+HTTPS/u);
    expect(checkpoint).toContain('local head\n  `a47e3419d`');
    expect(checkpoint).toMatch(
      /clean and 128 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toContain(
      'sign_and_send_pubkey: signing failed for ED25519 "Github"',
    );
    expect(checkpoint).toMatch(/communication with agent failed/u);
    expect(checkpoint).toMatch(/GitHub public-key denial/u);
    expect(checkpoint).toContain('.github/workflows/copilot-setup-steps.yml');
    expect(checkpoint).toContain('codex/stabilization-flow-coverage');
    expect(checkpoint).toMatch(/SSH push path remains blocked/u);
    expect(checkpoint).toContain('445967d29e2be2ecfaab7be3895862bcb2448241');
    expect(checkpoint).toMatch(/Docker\s+Compose build/u);
    expect(checkpoint).toContain('/tmp/evorto-docker-build-cache');
    expect(checkpoint).toContain('.github/docker-compose.build-cache.yml');
    expect(checkpoint).toContain('BuildKit');
    expect(checkpoint).toContain('type=gha');
    expect(checkpoint).toMatch(/Docker Buildx/u);
    expect(checkpoint).toMatch(/non-default builder/u);
    expect(checkpoint).toMatch(/current GitHub\s+Cache API support/u);
    expect(checkpoint).toMatch(/separate cache scopes/u);
    expect(checkpoint).toMatch(/cannot overwrite/u);
    expect(checkpoint).toContain('bunfig.toml');
    expect(checkpoint).toContain('@fortawesome');
    expect(checkpoint).toContain('https://registry.npmjs.org/');
    expect(checkpoint).toContain('Dockerfile');
    expect(checkpoint).toContain('/tmp/npmrc-public-fontawesome');
    expect(checkpoint).toContain('sharing=locked');
    expect(checkpoint).toMatch(/offline\s+production-dependency install/u);
    expect(checkpoint).toContain('local head `f41715149`');
    expect(checkpoint).toContain('scheduled `Neon Branch Cleanup` workflow');
    expect(checkpoint).toMatch(/does\s+not\s+run\s+dependency installation/u);
    expect(checkpoint).toMatch(
      /keeps[\s\S]*cleanup-only workflow out of the Font Awesome registry setup path/u,
    );
    expect(checkpoint).toMatch(/runner-temp\s+npm\s+user config/u);
    expect(checkpoint).toContain('`NPM_CONFIG_USERCONFIG`');
    expect(checkpoint).toContain('`npm_config_userconfig`');
    expect(checkpoint).toMatch(/inheriting a user\/account-level/u);
    expect(checkpoint).toContain('newer local cache/source-guard slices');
    expect(source).not.toMatch(/premium\/brand Font Awesome/u);
    expect(source).not.toMatch(/Font Awesome premium and brand/u);
    expect(source).not.toMatch(/registry token path intact/u);
    expect(source).not.toMatch(/Font Awesome token path exercised/u);
    expect(source).not.toMatch(/kept the Font Awesome premium/u);
    expect(workflow).toContain('Restore Docker build cache');
    expect(workflow).toContain('COMPOSE_DOCKER_CLI_BUILD: 1');
    expect(workflow).toContain('DOCKER_BUILDKIT: 1');
    expect(workflow).toContain('Set up Bun dependency caches');
    expect(workflow).toContain(
      'uses: ./.github/actions/setup-bun-dependency-caches',
    );
    expect(ciDependencyCacheAction).toContain('Restore Bun dependency tree');
    expect(ciDependencyCacheAction).toContain('id: bun-dependency-tree-cache');
    expect(ciDependencyCacheAction).toContain('id: bun-package-cache');
    expect(workflow).toContain(
      'run: bash helpers/testing/install-ci-dependencies.sh',
    );
    expect(workflow).toContain('CI_DEPENDENCY_INSTALL_MODE: warm');
    expect(workflow).toContain('CI_DEPENDENCY_INSTALL_MODE: offline-required');
    expect(ciDependencyCacheAction).toContain(
      "key: ${{ runner.os }}-bun-${{ inputs.bun-version }}-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('path: node_modules');
    expect(ciDependencyCacheAction).toContain('path: node_modules');
    expect(ciDependencyCacheAction).toContain(
      'Prepare public Font Awesome registry',
    );
    expect(ciDependencyCacheAction).toContain(
      'run: bash helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    expect(fontAwesomeCiHelper).toContain(
      "privateRegistry = ['npm', 'fontawesome', 'com'].join('.')",
    );
    expect(fontAwesomeCiHelper).toContain(
      'Font Awesome must stay on free public npm packages in CI.',
    );
    expect(fontAwesomeCiHelper).toContain(
      'npm_config_userconfig="${RUNNER_TEMP:-/tmp}/npmrc-public-fontawesome"',
    );
    expect(fontAwesomeCiHelper).toContain(
      'npm_config_globalconfig="${RUNNER_TEMP:-/tmp}/npmrc-empty-global"',
    );
    expect(fontAwesomeCiHelper).toContain('NPM_CONFIG_GLOBALCONFIG=');
    expect(fontAwesomeCiHelper).toContain('npm_config_globalconfig=');
    expect(fontAwesomeCiHelper).toContain(
      'fontawesome_token_environment_names=(',
    );
    expect(fontAwesomeCiHelper).toContain('FONT_AWESOME_TOKEN');
    expect(fontAwesomeCiHelper).toContain('FONTAWESOME_TOKEN');
    expect(fontAwesomeCiHelper).toContain('FONTAWESOME_NPM_AUTH_TOKEN');
    expect(fontAwesomeCiHelper).toContain('FONTAWESOME_PACKAGE_TOKEN');
    expect(fontAwesomeCiHelper).toContain(
      'unset "${fontawesome_token_environment_name}"',
    );
    expect(fontAwesomeCiHelper).toContain(
      'echo "${fontawesome_token_environment_name}="',
    );
    expect(ciDependencyCacheAction).toContain(
      "key: ${{ runner.os }}-bun-node-modules-${{ inputs.bun-version }}-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain(
      'BUN_PACKAGE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.package-cache-hit }}',
    );
    expect(workflow).toContain(
      'BUN_DEPENDENCY_TREE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.dependency-tree-cache-hit }}',
    );
    expect(ciInstallHelper).toContain(
      'Bun package cache hit: ${package_cache_hit}',
    );
    expect(ciInstallHelper).toContain(
      'Bun dependency tree cache hit: ${dependency_tree_cache_hit}',
    );
    expect(ciInstallHelper).toContain(
      'Bun dependency tree cache restored; skipping registry install.',
    );
    expect(ciInstallHelper).toContain('Bun package cache restored:');
    expect(ciInstallHelper).toContain(
      'find "${bun_cache_dir}" -mindepth 1 -maxdepth 1 -print -quit',
    );
    expect(ciInstallHelper).toContain(
      'Bun dependency tree cache was not restored; installing offline from the warmed package cache before falling back to the serial cache warmer registry install.',
    );
    expect(ciInstallHelper).toContain(
      'bun install --frozen-lockfile --offline --cache-dir "${bun_cache_dir}"',
    );
    expect(ciInstallHelper).toContain(
      'bun install --frozen-lockfile --cache-dir "${bun_cache_dir}"',
    );
    expect(workflow).toContain('Save warmed Bun package cache');
    expect(workflow).toContain('Save warmed Bun dependency tree');
    expect(workflow).toContain('uses: actions/cache/save@v4');
    expect(workflow).toContain(
      "if: steps.bun-dependency-caches.outputs.package-cache-hit != 'true'",
    );
    expect(workflow).toContain(
      'key: ${{ steps.bun-dependency-caches.outputs.package-cache-primary-key }}',
    );
    expect(workflow).toContain(
      "if: steps.bun-dependency-caches.outputs.dependency-tree-cache-hit != 'true'",
    );
    expect(workflow).toContain(
      'key: ${{ steps.bun-dependency-caches.outputs.dependency-tree-cache-primary-key }}',
    );
    expect(workflow).toContain(
      'CI_DEPENDENCY_INSTALL_MISSING_CACHE_MESSAGE: Bun dependency tree cache was not restored after warm-ci-caches. Refusing a parallel registry install to avoid repeated Font Awesome package downloads.',
    );
    expect(ciInstallHelper).toContain(
      'Refusing a registry install to avoid repeated Font Awesome package downloads.',
    );
    expect(workflow).toContain(
      'node_modules/.bin/playwright install --with-deps chromium',
    );
    expect(workflow).not.toContain('bunx playwright');
    expect(workflow).toContain(
      'DOCKER_BUILD_CACHE_DIR: /tmp/evorto-docker-build-cache',
    );
    expect(workflow).toContain('Set up Docker Buildx');
    expect(workflow).toContain('id: setup-buildx');
    expect(workflow).toContain('uses: docker/setup-buildx-action@v4');
    expect(workflow).toContain('version: latest');
    expect(workflow).toContain('warm-ci-caches:');
    expect(workflow).toContain('name: Warm CI dependency caches');
    expect(workflow).toContain('needs: warm-ci-caches');
    expect(workflow).toContain('max-parallel: 1');
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-start-docker-stack.sh',
    );
    expect(ciStartDockerStackHelper).toContain(
      'docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build',
    );
    expect(workflow).toContain('BUILDKIT_BUN_CACHE_DIR: buildkit-bun-cache');
    expect(workflow).toContain('Restore Docker Bun cache mount');
    expect(workflow).toContain('id: docker-bun-cache-mount');
    expect(workflow).toContain('path: ${{ env.BUILDKIT_BUN_CACHE_DIR }}');
    expect(workflow).toContain(
      "key: ${{ runner.os }}-docker-bun-cache-mount-1.3.11-${{ hashFiles('package.json', 'bun.lock', 'bunfig.toml', 'patches/**') }}",
    );
    expect(workflow).toContain('Inject Docker Bun cache mount');
    expect(workflow).toContain(
      'uses: reproducible-containers/buildkit-cache-dance@v3.4.0',
    );
    expect(workflow).toContain('"target": "/home/bun/.bun/install/cache"');
    expect(workflow).toContain('"id": "bun-install-cache"');
    expect(workflow).toContain(
      'skip-extraction: ${{ steps.docker-bun-cache-mount.outputs.cache-hit }}',
    );
    expect(workflow).toContain('skip-extraction: true');
    expect(workflow).toContain('Warm Docker build cache');
    expect(workflow).toContain('timeout 8m docker build');
    expect(workflow).toContain('--target dependencies');
    expect(workflow).toContain(
      '--cache-from type=gha,scope=evorto-dependencies',
    );
    expect(workflow).toContain(
      '--cache-to type=gha,scope=evorto-dependencies,mode=max',
    );
    expect(workflow).not.toContain(
      'timeout 20m docker compose -f docker-compose.yml -f .github/docker-compose.build-cache.yml build --progress=plain db-setup evorto',
    );
    expect(ciBuildCacheCompose).toContain('cache_from:');
    expect(ciBuildCacheCompose).toContain('cache_to:');
    expect(ciBuildCacheCompose).toContain('type=gha');
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-db-setup');
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-app');
    expect(ciBuildCacheCompose).toContain(
      'type=gha,scope=evorto-db-setup,mode=max',
    );
    expect(ciBuildCacheCompose).toContain('type=gha,scope=evorto-app,mode=max');
    expect(copilotWorkflow).toContain('Set up Bun dependency caches');
    expect(copilotWorkflow).toContain(
      'uses: ./.github/actions/setup-bun-dependency-caches',
    );
    expect(copilotWorkflow).toContain(
      'BUN_PACKAGE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.package-cache-hit }}',
    );
    expect(copilotWorkflow).toContain(
      'BUN_DEPENDENCY_TREE_CACHE_HIT: ${{ steps.bun-dependency-caches.outputs.dependency-tree-cache-hit }}',
    );
    expect(copilotWorkflow).toContain(
      'CI_DEPENDENCY_INSTALL_MODE: warm',
    );
    expect(copilotWorkflow).toContain(
      'run: bash helpers/testing/install-ci-dependencies.sh',
    );
    expect(copilotWorkflow).toContain(
      'Save Bun dependency tree from package cache',
    );
    expect(copilotWorkflow).toContain(
      'bun install --frozen-lockfile --cache-dir ~/.bun/install/cache',
    );
    expect(copilotWorkflow).toContain('node_modules/.bin/playwright');
    expect(copilotWorkflow).toContain(
      'PLAYWRIGHT_BROWSERS_PATH: /home/runner/.cache/ms-playwright',
    );
    expect(copilotWorkflow).toContain('Restore Playwright browser cache');
    expect(copilotWorkflow).not.toContain('bunx playwright');
    expect(cleanupWorkflow).toContain('name: Neon Branch Cleanup');
    expect(cleanupWorkflow).not.toContain(
      'Prepare public Font Awesome registry',
    );
    expect(cleanupWorkflow).not.toContain(
      'helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    expect(cleanupWorkflow).not.toContain('bun install');
    expect(bunfig).toContain('"@fortawesome" = "https://registry.npmjs.org/"');
    expect(dockerignore).toContain('.npmrc');
    expect(fontAwesomeIconUsageSpec).toContain(
      'keeps icon-only Material buttons accessible by label',
    );
    expect(fontAwesomeIconUsageSpec).toContain('iconButtonPattern');
    expect(fontAwesomeIconUsageSpec).toContain('mat-icon-button');
    expect(fontAwesomeIconUsageSpec).toContain('accessibleLabelPattern');
    expect(fontAwesomeIconUsageSpec).toContain('aria-label');
    expect(fontAwesomeIconUsageSpec).toContain('aria-labelledby');
    expect(fontAwesomeIconUsageSpec).toContain('title');
    expect(fontAwesomeIconUsageSpec).toContain(String.raw`/<!--[\s\S]*?-->/gu`);
    const dockerfile = readSource('Dockerfile');
    expect(dockerfile).toContain(
      'NPM_CONFIG_USERCONFIG=/tmp/npmrc-public-fontawesome',
    );
    expect(dockerfile).toContain(
      'npm_config_userconfig=/tmp/npmrc-public-fontawesome',
    );
    expect(dockerfile).toContain(
      'NPM_CONFIG_GLOBALCONFIG=/tmp/npmrc-empty-global',
    );
    expect(dockerfile).toContain(
      'npm_config_globalconfig=/tmp/npmrc-empty-global',
    );
    expect(dockerfile).toContain(
      "'@fortawesome:registry=https://registry.npmjs.org/'",
    );
    expect(dockerfile).toContain('RUN : > /tmp/npmrc-empty-global');
    expect(dockerfile).toContain('sharing=locked');
    expect(dockerfile).toContain('FROM base AS dependencies');
    expect(dockerfile).toContain('FROM dependencies AS build');
    expect(dockerfile).toContain(
      'FROM dependencies AS production-dependencies',
    );
    expect(dockerfile).toContain('RUN rm -rf node_modules');
    expect(dockerfile).toContain(
      'bun install --frozen-lockfile --cache-dir /home/bun/.bun/install/cache',
    );
    expect(dockerfile).toContain(
      'bun install --frozen-lockfile --production --offline --cache-dir /home/bun/.bun/install/cache',
    );
    expect(dockerfile).not.toContain(
      'bun install --frozen-lockfile --production --cache-dir /home/bun/.bun/install/cache',
    );
    expect(dockerfile).not.toContain('FONT_AWESOME_TOKEN');
    expect(dockerfile).not.toContain('npm.fontawesome.com');
    expect(codexEnvironment).not.toContain('FONT_AWESOME_TOKEN');
    expect(codexEnvironment).not.toContain(
      'for file in .env .env.dev.local .npmrc',
    );
    expect(codexEnvironment).toContain(
      'Repository .npmrc is not supported; @fortawesome must install from public npm packages.',
    );
    expect(codexEnvironment).toContain(
      "printf '%s\\n' '@fortawesome:registry=https://registry.npmjs.org/' > \"${npm_config_userconfig}\"",
    );
    expect(codexEnvironment).toContain(
      'export NPM_CONFIG_USERCONFIG="${npm_config_userconfig}"',
    );
    expect(codexEnvironment).toContain(
      'export npm_config_userconfig="${npm_config_userconfig}"',
    );
    expect(codexEnvironment).toContain(
      'bun_cache_dir="${HOME}/.bun/install/cache"',
    );
    expect(codexEnvironment).toContain('--cache-dir "${bun_cache_dir}"');
  });

  it('keeps the live Neon active-test branch refresh checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Neon active-test branch refresh checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('fresh June 4, 2026 local');
    expect(checkpoint).toContain('bun run env:runtime');
    expect(checkpoint).toContain('node_modules/.bin/dotenv -c dev');
    expect(checkpoint).toContain(
      'bun helpers/testing/delete-neon-local-branches.ts',
    );
    expect(checkpoint).toMatch(/local\s+head `9295a20b2`/u);
    expect(checkpoint).toContain('/tmp/.neon_local/.branches');
    expect(checkpoint).toMatch(/two-hour\s+active-test TTL/u);
    expect(checkpoint).toContain(
      'total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h',
    );
    expect(checkpoint).toContain('only `main`');
    expect(checkpoint).toMatch(/no active or stale test\s+branches/u);
    expect(checkpoint).toMatch(
      /current test branches inside the\s+two-hour TTL/u,
    );
    expect(checkpoint).toContain('hourly cleanup workflow');
    expect(checkpoint).toContain('runtime refresh wrote `.env.dev`');
    expect(checkpoint).toMatch(
      /current Docker preflight evidence is tracked\s+separately/u,
    );
    expect(checkpoint).toMatch(/Docker\s+container start-path probe/u);
    expect(checkpoint).toMatch(/required runtime variables/u);
    expect(checkpoint).toMatch(/Compose config/u);
    expect(checkpoint).toMatch(/project-container inspection/u);
    expect(checkpoint).toMatch(/Playwright CLI/u);
    expect(checkpoint).toMatch(/Stripe webhook\s+source/u);
    expect(checkpoint).toMatch(/browser-cache checks as healthy/u);
    expect(checkpoint).toMatch(/repo-local dotenv cleanup run/u);
    expect(checkpoint).toMatch(/local head `859bf7f60`/u);
    expect(checkpoint).toContain(
      'total=2, protected=1, active_test=1, stale_deleted=0, ttl=2h',
    );
    expect(checkpoint).toContain('br-nameless-mountain-a9cbta9g');
    expect(checkpoint).toContain('2026-06-04T01:55:09Z');
    expect(checkpoint).toMatch(/about 66 minutes old/u);
    expect(checkpoint).toMatch(
      /only a current test\s+branch inside the two-hour TTL exists/u,
    );
    expect(checkpoint).toMatch(/local head `8b6733014`/u);
    expect(checkpoint).toMatch(/regenerated `.env.dev`/u);
    expect(checkpoint).toMatch(
      /checked for stale branches outside the two-hour\s+active-test TTL/u,
    );
    expect(checkpoint).toMatch(
      /live Neon\s+project is therefore back to the intended non-test state/u,
    );
    expect(checkpoint).toMatch(/only protected\s+`main`/u);
    expect(checkpoint).toMatch(
      /no active-test branches\s+and no stale branches/u,
    );
    expect(checkpoint).toMatch(/local head `0c9d4ea59`/u);
    expect(checkpoint).toContain('br-silent-rain-a9lwt7ed');
    expect(checkpoint).toContain('2026-06-04T05:02:40Z');
    expect(checkpoint).toMatch(/about 22 minutes old/u);
    expect(checkpoint).toMatch(
      /outside protected\s+`main`, only a current test branch/u,
    );
    expect(checkpoint).toMatch(/no\s+stale branches required deletion/u);
    expect(checkpoint).toMatch(/local head `c04da4e38`/u);
    expect(checkpoint).toMatch(/about\s+39 minutes old/u);
    expect(checkpoint).toContain('created_at=2026-06-04T05:02:40Z');
    expect(checkpoint).toMatch(
      /outside protected\s+`main`, only active\s+test branches younger than two hours remain/u,
    );
    expect(checkpoint).toMatch(/no stale branches\s+to delete/u);
    expect(checkpoint).toContain('local head `f000bd8c9`');
    expect(checkpoint).toMatch(/after regenerating `.env\.dev`/u);
    expect(checkpoint).toMatch(
      /checked for stale Neon Local branches outside\s+the two-hour active-test TTL/u,
    );
    expect(checkpoint).toMatch(/83 minutes old/u);
    expect(checkpoint).toContain('created_at=2026-06-04T05:02:40Z');
    expect(checkpoint).toMatch(
      /outside protected `main`, only an active test branch\s+younger than two hours remains/u,
    );
    expect(checkpoint).toContain('evorto-runtime-preflight');
    expect(checkpoint).toContain('codex-preflight-manual');
    expect(checkpoint).toMatch(/listed no leftovers/u);
    expect(checkpoint).toContain('local head `fc7599843`');
    expect(checkpoint).toMatch(/98 minutes old/u);
    expect(checkpoint).toMatch(/there are no stale branches to delete/u);
    expect(checkpoint).toContain('local head `1737ed5f7`');
    expect(checkpoint).toMatch(/two-hour branch expiration had\s+passed/u);
    expect(checkpoint).toMatch(/HTTP 500 for `\/events`/u);
    expect(checkpoint).toMatch(/backing Neon Local branch was already gone/u);
    expect(checkpoint).toContain(
      'total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h',
    );
    expect(checkpoint).toMatch(/live Neon project clean with only `main`/u);
    expect(checkpoint).toMatch(
      /could not provide fresh Browser route evidence/u,
    );
    expect(checkpoint).toMatch(/bounded Compose shutdown/u);
    expect(checkpoint).toContain('evorto-4dddca18-db-1');
    expect(checkpoint).toContain(
      'tried to kill\n  container, but did not receive an exit event',
    );
    expect(checkpoint).toMatch(/host Docker daemon\/container lifecycle/u);
    expect(checkpoint).toMatch(
      /not a Font Awesome, Neon branch\s+cleanup, General-page mobile, or Material layout regression/u,
    );
    expect(checkpoint).toContain('local head `b5f8d77b3`');
    expect(checkpoint).toContain('br-mute-paper-a9vq9l6k');
    expect(checkpoint).toContain('2026-06-04T07:49:23Z');
    expect(checkpoint).toMatch(/7 minutes old/u);
    expect(checkpoint).toMatch(
      /outside protected `main`, only a\s+current active-test branch younger than two hours remains/u,
    );
    expect(checkpoint).toMatch(/no stale branch\s+required deletion/u);
    expect(checkpoint).toMatch(/local preflight hardening pass/u);
    expect(checkpoint).toContain('helpers/testing/runtime-preflight.ts');
    expect(checkpoint).toMatch(
      /single-object\s+`docker compose ps --format json` output/u,
    );
    expect(checkpoint).toMatch(/Health=unhealthy/u);
    expect(checkpoint).toContain('Up 2 hours (unhealthy)');
    expect(checkpoint).toMatch(/conservative stale-container cleanup/u);
    expect(checkpoint).toMatch(/Docker Desktop\s+restart/u);
    expect(checkpoint).toMatch(
      /bounded cleanup can\s+target unhealthy generated containers/u,
    );
    expect(checkpoint).toContain(
      'helpers/testing/remove-stale-compose-containers.ts',
    );
    expect(checkpoint).toContain(
      'helpers/testing/remove-stale-compose-containers.spec.ts',
    );
    expect(checkpoint).toContain('import.meta.main');
    expect(checkpoint).toContain("normalizedHealth === 'unhealthy'");
    expect(checkpoint).toContain("normalizedStatus.includes('unhealthy')");
    expect(checkpoint).toMatch(/duplicate target de-duplication/u);
    expect(checkpoint).toContain(
      'Removing stale or unhealthy Docker Compose project containers',
    );
    expect(checkpoint).toContain('live `bun run docker:clean-stale`');
    expect(checkpoint).toMatch(
      /Removing stale or unhealthy Docker Compose project containers:\s+evorto-4dddca18-db-1/u,
    );
    expect(checkpoint).toContain(
      'cannot remove container "evorto-4dddca18-db-1"',
    );
    expect(checkpoint).toContain(
      'tried to kill container, but did not receive an exit event',
    );
    expect(checkpoint).toMatch(/cleanup tool now reaches\s+the right target/u);
    expect(checkpoint).toMatch(/remaining blocker is Docker daemon removal/u);
    expect(checkpoint).not.toContain('`bun run docker:check` green');
    expect(checkpoint).not.toMatch(
      /local preflight and branch-count invariants/u,
    );
    expect(checkpoint).not.toContain('fourteen branches remain');

    const inventory = readSource('tests/test-inventory.md');
    expect(inventory).toContain(
      'helpers/testing/remove-stale-compose-containers.spec.ts',
    );
    expect(inventory).toMatch(/unhealthy Compose JSON health/u);
    expect(inventory).toMatch(/Docker `ps` status text fallback/u);
    expect(inventory).toMatch(/duplicate target de-duplication/u);
  });

  it('keeps the PR CI watch checkpoint honest', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current PR CI watch checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('Codex heartbeat automation');
    expect(checkpoint).toContain('PR 62 CI watch');
    expect(checkpoint).toContain('pr-62-ci-watch');
    expect(checkpoint).toContain('five-hour');
    expect(checkpoint).toContain('FREQ=HOURLY;INTERVAL=5');
    expect(checkpoint).toContain(
      '/Users/hedde/.codex/automations/pr-62-ci-watch/automation.toml',
    );
    expect(checkpoint).toContain('kind = "heartbeat"');
    expect(checkpoint).toContain('status = "ACTIVE"');
    expect(checkpoint).toMatch(
      /prompt text requiring\s+the remote-vs-local comparison/u,
    );
    expect(checkpoint).toContain('PR #62');
    expect(checkpoint).toMatch(/remote PR head and status checks/u);
    expect(checkpoint).toMatch(/local branch state/u);
    expect(checkpoint).toMatch(/failing GitHub checks/u);
    expect(checkpoint).toMatch(/local commits that remain unpushed/u);
    expect(checkpoint).toMatch(/auth or\s+workflow-scope constraints/u);
    expect(checkpoint).toMatch(/old green checks as proof/u);
    expect(checkpoint).toMatch(/fresh June 4,\s+2026 manual CI watch\s+check/u);
    expect(checkpoint).toMatch(/local head\s+`fd0a6e057`/u);
    expect(checkpoint).toContain('445967d29e2be2ecfaab7be3895862bcb2448241');
    expect(checkpoint).toContain('Analyze, CodeQL, Copilot setup');
    expect(checkpoint).toContain('Git Town branch stack');
    expect(checkpoint).toContain('CodeRabbit');
    expect(checkpoint).toContain('all three E2E jobs');
    expect(checkpoint).toMatch(/green only for\s+that old remote head/u);
    expect(checkpoint).toMatch(
      /At that check the local branch was clean and 65 commits\s+ahead/u,
    );
    expect(checkpoint).toMatch(
      /later local evidence-refresh commits can increase the ahead count/u,
    );
    expect(checkpoint).toContain('local head `cbf4bdba1`');
    expect(checkpoint).toMatch(
      /same remote\s+`445967d29e2be2ecfaab7be3895862bcb2448241`/u,
    );
    expect(checkpoint).toMatch(
      /three E2E jobs green only for that stale\s+remote head/u,
    );
    expect(checkpoint).toMatch(
      /clean and 89 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toContain('local head `bfc9517da`');
    expect(checkpoint).toMatch(
      /clean and 93 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/local\s+head `ed2675278`/u);
    expect(checkpoint).toMatch(
      /clean and 95 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/local\s+head `2d407ff91`/u);
    expect(checkpoint).toMatch(
      /clean and 98 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/local\s+head `28469d18d`/u);
    expect(checkpoint).toMatch(
      /clean and 113 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/local\s+head `859bf7f60`/u);
    expect(checkpoint).toMatch(/green only for that stale pushed\s+head/u);
    expect(checkpoint).toMatch(
      /clean and 120\s+commits ahead of `origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/ED25519 key-agent signing/u);
    expect(checkpoint).toMatch(/lacks `workflow` scope/u);
    expect(checkpoint).toMatch(/SSH push still failed at agent signing/u);
    expect(checkpoint).toMatch(/same push-auth blocker remains/u);
    expect(checkpoint).toMatch(/local\s+head `a47e3419d`/u);
    expect(checkpoint).toMatch(
      /clean and 128 commits ahead of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/ED25519 key-agent\s+communication failure/u);
    expect(checkpoint).toContain('.github/workflows/copilot-setup-steps.yml');
    expect(checkpoint).toMatch(/local\s+head `e9cd6f34d`/u);
    expect(checkpoint).toMatch(
      /PR #62 on remote head `445967d29e2be2ecfaab7be3895862bcb2448241`/u,
    );
    expect(checkpoint).toMatch(/all three E2E jobs are still\s+green/u);
    expect(checkpoint).toMatch(
      /clean and 134\s+commits ahead of `origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(
      /HTTPS push was again\s+rejected because the OAuth token lacks `workflow` scope/u,
    );
    expect(checkpoint).toContain('local head `69f1b5aee`');
    expect(checkpoint).toMatch(
      /Playwright E2E docs,\s+Playwright E2E functional-1,\s+and Playwright E2E functional-2/u,
    );
    expect(checkpoint).toMatch(
      /clean and 143 commits\s+ahead of `origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(/agent refused operation/u);
    expect(checkpoint).toMatch(/gh auth\s+setup-git/u);
    expect(checkpoint).toMatch(/HTTPS push reached\s+GitHub/u);
    expect(checkpoint).toContain('latest local Browser\n  evidence');
    expect(checkpoint).toContain('local head `f41715149`');
    expect(checkpoint).toMatch(
      /Playwright E2E docs,\s+Playwright E2E functional-1,\s+and Playwright E2E functional-2/u,
    );
    expect(checkpoint).toMatch(/green only for that\s+stale pushed head/u);
    expect(checkpoint).toMatch(
      /clean and 157 commits ahead\s+of `origin\/codex\/stabilization-flow-coverage`|branch is clean and 157 commits ahead\s+of\s+`origin\/codex\/stabilization-flow-coverage`/u,
    );
    expect(checkpoint).toMatch(
      /latest Font Awesome cleanup-workflow\s+hardening/u,
    );
    expect(checkpoint).not.toMatch(/The local branch is clean and 65/u);
    expect(checkpoint).toContain('`gh auth status`');
    expect(checkpoint).toContain('`gist`, `read:org`, and `repo` scopes');
    expect(checkpoint).toMatch(
      /cannot\s+be pushed over\s+the current HTTPS auth/u,
    );
    expect(checkpoint).toContain('gh auth refresh -h github.com -s workflow');
    expect(checkpoint).toContain('17c35e732911feff82d6f34313c0e7d745a31661');
    expect(checkpoint).toMatch(/Warm CI\s+dependency caches/u);
    expect(checkpoint).toMatch(/20-minute timeout path/u);
    expect(checkpoint).toMatch(/Playwright E2E\s+\(functional-1\)/u);
    expect(checkpoint).toMatch(/`functional-2` and `docs` were queued/u);
    expect(checkpoint).toMatch(
      /CI proof for the pushed E2E matrix still depends/u,
    );
    expect(checkpoint).toContain('6520e154006dd18db8911b40af0096c1f3afaadf');
    expect(checkpoint).toMatch(
      /clean\s+local `codex\/stabilization-flow-coverage` branch/u,
    );
    expect(checkpoint).toContain('CodeQL `Analyze (actions)`');
    expect(checkpoint).toContain('E2E Baseline` run `27003750183`');
    expect(checkpoint).toMatch(/not by unpushed local commits/u);
    expect(checkpoint).toMatch(/stale-head check reuse/u);
  });

  it('keeps the current Docker Browser runtime checkpoint tied to recovered Browser evidence', () => {
    const source = readSource('STABILIZATION.md');
    const helpersReadme = readSource('helpers/README.md');
    const runtimePreflight = readSource('helpers/testing/runtime-preflight.ts');
    const testInventory = readSource('tests/test-inventory.md');
    const testsReadme = readSource('tests/README.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');
    const checkpoint = queue.match(
      /Current Docker\/Browser runtime recovered checkpoint:[\s\S]*?(?=\n\n## Review Next|\n- Current |\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('serving the current local branch');
    expect(checkpoint).toContain('local\n  head `db7845e5e`');
    expect(checkpoint).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose ps',
    );
    expect(checkpoint).toContain('healthy `db`');
    expect(checkpoint).toContain('running `evorto`, `minio`, and `stripe`');
    expect(checkpoint).toContain('generated `BASE_URL`');
    expect(checkpoint).toContain('/events?runtimeRecovered=...');
    expect(checkpoint).toContain('390x844');
    expect(checkpoint).toContain('`Events` and `No events found`');
    expect(checkpoint).toContain('`clientWidth=390`');
    expect(checkpoint).toContain('`scrollWidth=390`');
    expect(checkpoint).toContain('no horizontal overflow');
    expect(checkpoint).toContain(
      'resetting the temporary\n  Browser viewport override',
    );
    expect(checkpoint).toContain('current-state refresh');
    expect(checkpoint).toContain('local\n  head `cb4fc919f`');
    expect(checkpoint).toMatch(/same generated `BASE_URL` is still\s+served/u);
    expect(checkpoint).toMatch(
      /healthy\/running `db`, `evorto`, `minio`, and `stripe`/u,
    );
    expect(checkpoint).toContain('public General pages');
    expect(checkpoint).toContain('authenticated `/admin/settings`');
    expect(checkpoint).toMatch(/320x740,\s+390x844,\s+and 1440x900/u);
    expect(checkpoint).toMatch(/no\s+Browser error logs/u);
    expect(checkpoint).toContain('local head `6b4a9003a`');
    expect(checkpoint).toContain('/legal/imprint');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toMatch(/all 21\s+route\/viewport/u);
    expect(checkpoint).toContain(
      '/tmp/evorto-public-general-current-refresh-mobile.png',
    );
    expect(checkpoint).toMatch(
      /temporary Browser\s+viewport override was reset after the sweep/u,
    );
    expect(checkpoint).toContain('local head `dfe075ccd`');
    expect(checkpoint).toMatch(/anonymous public General sweep/u);
    expect(checkpoint).toContain('`/`, `/events`');
    expect(checkpoint).toContain('/legal/imprint');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toMatch(/All 24 route\/viewport checks/u);
    expect(checkpoint).toMatch(/Privacy policy page/u);
    expect(checkpoint).toMatch(/tenant-missing\s+legal-text message/u);
    expect(checkpoint).toMatch(/fixed mobile bottom navigation fitting/u);
    expect(checkpoint).toContain(
      '/tmp/evorto-public-general-20260604-refresh-mobile.jpg',
    );
    expect(checkpoint).toContain('local refresh at `7daed0b2a`');
    expect(checkpoint).toContain('bun run docker:check');
    expect(checkpoint).toContain('bun run\n  docker:start');
    expect(checkpoint).toMatch(/cached Font Awesome\/Bun install layer/u);
    expect(checkpoint).toContain(
      'offline\n  `bun install --production --offline --cache-dir',
    );
    expect(checkpoint).toContain('evorto-4dddca18');
    expect(checkpoint).toContain(
      'tests/specs/smoke/public-general-viewports.spec.ts',
    );
    expect(checkpoint).toContain('NO_WEBSERVER=true');
    expect(checkpoint).toContain('`--no-deps`');
    expect(checkpoint).toContain(
      '/tmp/evorto-current-head-general-*-390x844.png',
    );
    expect(checkpoint).toContain('direct\n  in-app Browser tab API sweep');
    expect(checkpoint).toContain('against the generated `BASE_URL`');
    expect(checkpoint).toContain('Browser `viewport` capability');
    expect(checkpoint).toContain(
      'visited `/events`, `/legal/imprint`,\n  and `/404`',
    );
    expect(checkpoint).toContain('zero clipped controls on all three routes');
    expect(checkpoint).toContain('resetting the viewport override');
    expect(checkpoint).toContain('local head `0ed0ef8c5`');
    expect(checkpoint).toContain(
      'set the Browser `viewport` capability for 320x740, 390x844, and\n  1440x900',
    );
    expect(checkpoint).toContain('visited `/`, `/events`, `/legal/imprint`');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toMatch(/All 24 route\/viewport checks/u);
    expect(checkpoint).toMatch(/matching `bodyWidth` and `docWidth`/u);
    expect(checkpoint).toContain('zero clipped controls');
    expect(checkpoint).toMatch(/no rendered application-error\s+text/u);
    expect(checkpoint).toMatch(/expected page headings/u);
    expect(checkpoint).toContain('local\n  head `93fe69843`');
    expect(checkpoint).toContain('`Must setup test`');
    expect(checkpoint).toContain(
      'After refreshing\n  the in-app Browser handle',
    );
    expect(checkpoint).toContain(
      'direct sweep again set the Browser `viewport`\n  capability for 320x740, 390x844, and 1440x900',
    );
    expect(checkpoint).toContain('all 24 route/viewport checks green');
    expect(checkpoint).toContain('no Browser console errors');
    expect(checkpoint).toContain('390x844 `/legal/privacy` screenshot');
    expect(checkpoint).toMatch(/fixed mobile\s+bottom navigation fitting/u);
    expect(checkpoint).toContain('local head `1836e54f4`');
    expect(checkpoint).toMatch(/direct in-app Browser rerun/u);
    expect(checkpoint).toContain('`Terms`, `Access not allowed`');
    expect(checkpoint).toContain('`Something went wrong`');
    expect(checkpoint).toContain(
      '/tmp/evorto-current-head-general-browser-1836e54f-mobile-terms.png',
    );
    expect(checkpoint).toContain('`bun run db:reset`');
    expect(checkpoint).toContain('NO_WEBSERVER=true bun run test:e2e --');
    expect(checkpoint).toContain(
      'tests/specs/smoke/public-general-viewports.spec.ts',
    );
    expect(checkpoint).toContain('--workers=1 --no-deps');
    expect(checkpoint).toMatch(/passed with 1 test in\s+17\.5s/u);
    expect(checkpoint).toMatch(/disposable Alpine preflight timeout/u);
    expect(checkpoint).toContain('evorto-4dddca18');
    expect(checkpoint).toContain('local head `1ab95b1c5`');
    expect(checkpoint).toContain('generated `BASE_URL` from `.env.dev`');
    expect(checkpoint).toContain('connected to the `iab` browser');
    expect(checkpoint).toContain(
      'used the `viewport` capability for 320x740, 390x844, and 1440x900',
    );
    expect(checkpoint).toContain('visited `/`, `/events`, `/legal/imprint`');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toMatch(/All 24 route\/viewport checks reported/u);
    expect(checkpoint).toMatch(
      /matching\s+`window\.innerWidth`,\s+`bodyWidth`,\s+and `docWidth`/u,
    );
    expect(checkpoint).toMatch(/zero Browser warning\/error logs/u);
    expect(checkpoint).toContain('`Events`, `Terms`, `Page not found`');
    expect(checkpoint).toContain('320x740 `/legal/terms` screenshot');
    expect(checkpoint).toContain(
      '/tmp/evorto-general-browser-20260604-320-terms.png',
    );
    expect(checkpoint).toContain('local head\n  `a2c1d2e70`');
    expect(checkpoint).toContain('focused in-app Browser mobile refresh');
    expect(checkpoint).toContain('serving `/robots.txt`');
    expect(checkpoint).toContain('320x740 and\n  390x844');
    expect(checkpoint).toMatch(/All 16 route\/viewport\s+checks/u);
    expect(checkpoint).toMatch(
      /matching `window\.innerWidth`, `bodyWidth`, and `docWidth`/u,
    );
    expect(checkpoint).toMatch(/no\s+horizontal overflow/u);
    expect(checkpoint).toMatch(/zero clipped visible controls/u);
    expect(checkpoint).toMatch(/no rendered\s+application-error text/u);
    expect(checkpoint).toMatch(/no Browser warning\/error log failures/u);
    expect(checkpoint).toMatch(/viewport override was reset/u);
    expect(checkpoint).toContain(
      '/tmp/evorto-general-mobile-refresh-a2c1d2e-320-terms.png',
    );
    expect(checkpoint).toContain('local head `6b975474c`');
    expect(checkpoint).toContain('the `.env.dev` `BASE_URL`');
    expect(checkpoint).toContain('connected to the `iab` browser');
    expect(checkpoint).toContain(
      'set the Browser `viewport` capability for\n  320x740, 390x844, and 1440x900',
    );
    expect(checkpoint).toMatch(/all 24\s+route\/viewport checks/u);
    expect(checkpoint).toMatch(
      /body\/document\s+widths equal to the viewport width/u,
    );
    expect(checkpoint).toMatch(/no top\/side\s+clipped visible controls/u);
    expect(checkpoint).toMatch(/zero Browser warning\/error logs/u);
    expect(checkpoint).toMatch(/ordinary scroll continuation/u);
    expect(checkpoint).toContain(
      '/tmp/evorto-current-head-general-6b975474-320-terms.png',
    );
    expect(checkpoint).toContain(
      '/tmp/evorto-current-head-general-6b975474-390-events.png',
    );
    expect(checkpoint).toMatch(/readable Material cards/u);
    expect(checkpoint).toMatch(
      /fixed mobile bottom navigation\s+fitting without overlap/u,
    );
    expect(checkpoint).toContain('local head `fdd040de9`');
    expect(checkpoint).toContain('generated `.env.dev` `BASE_URL`');
    expect(checkpoint).toContain('healthy\n  `evorto-4dddca18` Docker app');
    expect(checkpoint).toContain('connected to the `iab` browser');
    expect(checkpoint).toContain(
      'used the Browser `viewport` capability for 320x740, 390x844, and 1440x900',
    );
    expect(checkpoint).toContain('visited `/`, `/events`, `/legal/imprint`');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toMatch(/All 24 route\/viewport checks\s+passed/u);
    expect(checkpoint).toMatch(
      /`window\.innerWidth`, body width, and document width\s+equal to the\s+requested viewport width/u,
    );
    expect(checkpoint).toMatch(/no horizontal overflow/u);
    expect(checkpoint).toMatch(/no top\/side clipped visible\s+controls/u);
    expect(checkpoint).toMatch(/no rendered application-error text/u);
    expect(checkpoint).toContain('`Access not allowed`');
    expect(checkpoint).toContain('`Something went wrong`');
    expect(checkpoint).toContain('`Page not found`');
    expect(checkpoint).toMatch(/zero Browser warning\/error logs/u);
    expect(checkpoint).toContain(
      '/tmp/evorto-general-current-fdd040de-320x740--legal-terms.png',
    );
    expect(checkpoint).toContain(
      '/tmp/evorto-general-current-fdd040de-390x844--events.png',
    );
    expect(checkpoint).toMatch(/tenant-missing legal-text message/u);
    expect(checkpoint).toContain('Playwright-test MCP Browser planner');
    expect(checkpoint).toMatch(/`DATABASE_URL` was\s+undefined/u);
    expect(checkpoint).toContain(
      'fixed the config-import side by wiring\n  Playwright config through the repo runtime config provider',
    );
    expect(checkpoint).toContain(
      'env -u DATABASE_URL -u BASE_URL -u APP_HOST_PORT -u COMPOSE_PROJECT_NAME -u NEON_LOCAL_HOST_PORT bunx playwright test --list',
    );
    expect(checkpoint).toContain(
      'listed the smoke layout tests from generated `.env.dev`',
    );
    expect(checkpoint).toMatch(
      /test-session\s+setup,\s+not Playwright config import or direct in-app Browser tab verification/u,
    );
    expect(checkpoint).toContain('tests/support/fixtures/base-test.ts');
    expect(checkpoint).toContain('STRIPE_TEST_ACCOUNT_ID');
    expect(checkpoint).toContain('mcp-browser-planner');
    expect(checkpoint).toContain('tests/setup/mcp-browser.seed.ts');
    expect(checkpoint).toContain(
      'bunx playwright test --project=mcp-browser-planner --no-deps tests/setup/mcp-browser.seed.ts --reporter=line',
    );
    expect(checkpoint).not.toContain(
      'Project\n  mcp-browser-planner not found',
    );
    expect(checkpoint).not.toContain(
      '`Must setup test before interacting with the page`',
    );
    expect(checkpoint).toContain('local head `e06ecd53c`');
    expect(checkpoint).toContain('Playwright-test Browser planner retry');
    expect(checkpoint).toContain('planner_setup_page');
    expect(checkpoint).toContain('project\n  `mcp-browser-planner`');
    expect(checkpoint).toContain('seed file `tests/setup/mcp-browser.seed.ts`');
    expect(checkpoint).toContain(
      'Browser tool paused at the seeded `/legal/terms` page',
    );
    expect(checkpoint).toContain('`Terms` heading');
    expect(checkpoint).toMatch(/tenant-missing legal-text\s+message/u);
    expect(checkpoint).toContain('Back to events link');
    expect(checkpoint).toContain('bottom navigation');
    expect(checkpoint).toContain('320x740');
    expect(checkpoint).toContain('mcp-browser-planner-terms-mobile.png');
    expect(checkpoint).toMatch(/readable mobile legal-page\s+content/u);
    expect(checkpoint).toContain('Events/Login bottom navigation');
    expect(checkpoint).toMatch(/fitting without overlap/u);
    expect(checkpoint).toMatch(
      /Playwright-test MCP Browser watchpoint is therefore recovered/u,
    );
    expect(checkpoint).toMatch(/lightweight public General planner route/u);
    expect(checkpoint).toMatch(
      /richer authenticated Browser\s+planning still belongs/u,
    );
    expect(testInventory).toContain('mcp-browser-planner');
    expect(testInventory).toContain('tests/setup/mcp-browser.seed.ts');
    expect(testInventory).toContain('resized the seeded Terms page to 320x740');
    expect(testInventory).toContain(
      'captured a mobile screenshot with readable legal-page content',
    );
    expect(testInventory).toContain('fitting Events/Login bottom navigation');
    expect(checkpoint).toContain('local head `04f9a9375`');
    expect(checkpoint).toMatch(/`.env.dev` `BASE_URL`\s+loopback port/u);
    expect(checkpoint).toMatch(/Browser Use URL\s+policy/u);
    expect(checkpoint).toMatch(/No route or\s+layout evidence was collected/u);
    expect(checkpoint).toMatch(/Browser-tool policy\s+block/u);
    expect(checkpoint).toMatch(
      /rather than an application, Docker,\s+Material layout, or General mobile\s+regression/u,
    );
    expect(checkpoint).toContain('local head `a47e3419d`');
    expect(checkpoint).toMatch(/current-head relaunch retry/u);
    expect(checkpoint).toContain(
      'node_modules/.bin/dotenv -c dev -- docker compose up --no-build -d evorto',
    );
    expect(checkpoint).toContain('evorto-4dddca18-evorto-1');
    expect(checkpoint).toMatch(
      /did not transition it from\s+`Created` to running/u,
    );
    expect(checkpoint).toContain(
      '`db-expiration`, `db-setup`, and `minio-init`',
    );
    expect(checkpoint).toMatch(/Docker log read/u);
    expect(checkpoint).toMatch(/hung at\s+the Docker client layer/u);
    expect(checkpoint).toContain('docker rm -f -v evorto-4dddca18-evorto-1');
    expect(checkpoint).toMatch(/running `db`, `minio`,\s+and `stripe`/u);
    expect(checkpoint).toMatch(
      /fresh Browser verification blocked below the app route layer/u,
    );
    expect(checkpoint).toMatch(/low-level Docker probe/u);
    expect(checkpoint).toContain('evorto-start-probe-1780546414750');
    expect(checkpoint).toContain('alpine:latest');
    expect(checkpoint).toContain('probe-start-ok');
    expect(checkpoint).toMatch(/created and attached the container/u);
    expect(checkpoint).toMatch(
      /timed out before\s+Docker emitted a `start` event/u,
    );
    expect(checkpoint).toContain('state=created');
    expect(checkpoint).toContain('started=0001-01-01T00:00:00Z');
    expect(checkpoint).toMatch(/empty Docker state error/u);
    expect(checkpoint).toContain('docker rm -f -v');
    expect(checkpoint).toMatch(/Docker's\s+new-container start path/u);
    expect(checkpoint).toMatch(/rather than by Evorto app code/u);
    expect(checkpoint).toMatch(/Font Awesome\s+installation/u);
    expect(checkpoint).toMatch(/Neon Local configuration/u);
    expect(checkpoint).toMatch(/Material\/mobile layout/u);
    expect(checkpoint).toMatch(
      /old(?:er)? Docker\s+container start-path blocker entries below are retained as historical\s+diagnostics/u,
    );
    expect(checkpoint).toMatch(
      /superseded by the current running-Docker Browser evidence/u,
    );
    expect(checkpoint).toContain('Earlier in this checkpoint');
    expect(checkpoint).toMatch(/fresh current-branch\s+Browser verification/u);
    expect(checkpoint).toContain('could not produce route or layout evidence');
    expect(checkpoint).toContain('`bun run docker:check` passed');
    expect(checkpoint).toContain('all required\n  env variables');
    expect(checkpoint).toContain('Playwright Chromium cache checks');
    expect(checkpoint).toContain('no generated\n  Compose project containers');
    expect(checkpoint).toMatch(/public\s+Font Awesome Free packages/u);
    expect(checkpoint).toContain('bun install --frozen-lockfile');
    expect(checkpoint).toMatch(/public Free icon packages/u);
    expect(checkpoint).toMatch(/Angular app build completed/u);
    expect(checkpoint).toMatch(/Neon Local\s+`db` container/u);
    expect(checkpoint).toContain('before any app route could be served');
    expect(checkpoint).toContain(
      'left the generated project containers in `Created`',
    );
    expect(checkpoint).toContain('`db`, `db-expiration`, `db-setup`');
    expect(checkpoint).toContain('`evorto`, `minio`, `minio-init`');
    expect(checkpoint).toContain('`stripe` containers');
    expect(checkpoint).toContain('`bun run docker:clean-stale`');
    expect(checkpoint).toContain(
      'successfully removed those\n  created containers',
    );
    expect(checkpoint).toContain(
      'returned to green with no generated-project containers',
    );
    expect(checkpoint).toMatch(/single JSON object/u);
    expect(checkpoint).toMatch(
      /current local blocker below the app and Neon-specific layers/u,
    );
    expect(checkpoint).toContain('neondatabase/neon_local:v1.5');
    expect(checkpoint).toContain('/bin/sh');
    expect(checkpoint).toMatch(/no app environment/u);
    expect(checkpoint).toMatch(/left\s+only\s+`Created` probe containers/u);
    expect(checkpoint).toMatch(/already healthy Neon Local container/u);
    expect(checkpoint).toMatch(/same image digest/u);
    expect(checkpoint).toContain('alpine:latest');
    expect(checkpoint).toContain('oven/bun:1.3.11-alpine');
    expect(checkpoint).toMatch(
      /Docker could pull, build, inspect, and\s+remove/u,
    );
    expect(checkpoint).toMatch(
      /new containers did not transition from\s+`Created` to running/u,
    );
    expect(checkpoint).toMatch(
      /Font Awesome install, app build, Browser\s+transport, stale-container cleanup, and Neon Local branch configuration out/u,
    );
    expect(checkpoint).toMatch(/local\s+head `ed2675278`/u);
    expect(checkpoint).toContain('evorto-runtime-preflight-48324');
    expect(checkpoint).toMatch(
      /host Docker engine's new\s+container start path/u,
    );
    expect(checkpoint).toContain('fresh current-branch retry');
    expect(checkpoint).toMatch(/June 3,\s+2026/u);
    expect(checkpoint).toContain('`bun run docker:check` passed');
    expect(checkpoint).toContain('docker run --rm alpine:latest');
    expect(checkpoint).toContain('alpine-start-ok');
    expect(checkpoint).toMatch(/still hung instead of printing output/u);
    expect(checkpoint).toMatch(/`alpine:latest` container in `Created`/u);
    expect(checkpoint).toMatch(/Force-killing the stuck Docker client/u);
    expect(checkpoint).toMatch(/restored `bun run docker:check` to\s+green/u);
    expect(checkpoint).toContain('docker compose ps --all --format json');
    expect(checkpoint).toMatch(/`created`, `dead`, or `removing`/u);
    expect(checkpoint).toContain('Compose\n  project inspection times out');
    expect(checkpoint).toMatch(/June 4,\s+2026 retry/u);
    expect(checkpoint).toContain('a028ffc8c');
    expect(checkpoint).toMatch(/`bun run docker:check` green/u);
    expect(checkpoint).toMatch(/no generated Compose containers/u);
    expect(checkpoint).toMatch(/timed out after 45 seconds/u);
    expect(checkpoint).toMatch(/without printing output/u);
    expect(checkpoint).toMatch(/single `alpine:latest` probe container/u);
    expect(checkpoint).toContain('docker rm -f -v');
    expect(checkpoint).toMatch(/restored `bun run docker:check` to\s+green/u);
    expect(checkpoint).toMatch(
      /below the app, Browser, Font Awesome,\s+and Neon-specific layers/u,
    );
    expect(checkpoint).toContain('local head\n  `4e3c4761a`');
    expect(checkpoint).toContain('CI teardown hardening commits');
    expect(checkpoint).toMatch(/Docker\s+Compose v5\.1\.4/u);
    expect(checkpoint).toContain('Playwright Chromium cache locations');
    expect(checkpoint).toContain('80980464140e');
    expect(checkpoint).toMatch(/stuck Docker client plus `docker rm -f -v/u);
    expect(checkpoint).toContain('current-head retry at `74bd176a1`');
    expect(checkpoint).toContain('codex-alpine-start-probe-20260604');
    expect(checkpoint).toMatch(/produced no output after 10 seconds/u);
    expect(checkpoint).toMatch(/remained in\s+`Created`/u);
    expect(checkpoint).toContain(
      'docker rm -f -v codex-alpine-start-probe-20260604',
    );
    expect(checkpoint).toMatch(
      /host container start-path\s+blocker is still current/u,
    );
    expect(checkpoint).toContain('current-head retry at `90ed03cdc`');
    expect(checkpoint).toMatch(/macOS shell had no GNU\s+`timeout` command/u);
    expect(checkpoint).toContain('codex-alpine-start-probe-20260604005631');
    expect(checkpoint).toMatch(/timed out after 45 seconds/u);
    expect(checkpoint).toMatch(/without output/u);
    expect(checkpoint).toMatch(/Docker client had to be force-killed/u);
    expect(checkpoint).toMatch(/did not list the named probe afterward/u);
    expect(checkpoint).toMatch(
      /lower-level Docker container start-path check/u,
    );
    expect(checkpoint).toMatch(/disposable Alpine\s+container/u);
    expect(checkpoint).toMatch(/will fail early/u);
    expect(checkpoint).toMatch(/cannot start containers for Browser/u);
    expect(checkpoint).toMatch(/real post-change `bun run docker:check`/u);
    expect(checkpoint).toMatch(/returned in about 15\s+seconds/u);
    expect(checkpoint).toContain('Docker\n  container start path');
    expect(checkpoint).toContain(
      'Timed out after 15s while starting a\n  disposable Alpine container.',
    );
    expect(checkpoint).toContain('evorto-runtime-preflight-32411');
    expect(checkpoint).toContain(
      'docker rm -f -v evorto-runtime-preflight-32411',
    );
    expect(checkpoint).toMatch(/removed it/u);
    expect(checkpoint).toContain('cleanup was hardened');
    expect(checkpoint).toContain('local head\n  `1ac10014d`');
    expect(checkpoint).toContain('evorto-runtime-preflight-87159');
    expect(checkpoint).toContain(
      'docker ps --all --filter name=evorto-runtime-preflight',
    );
    expect(checkpoint).toMatch(/listed no\s+remaining preflight containers/u);
    expect(checkpoint).toMatch(
      /no longer accumulate\s+disposable Created probes/u,
    );
    expect(checkpoint).toMatch(
      /fresh Browser route\/mobile layout\s+evidence remains blocked/u,
    );
    expect(checkpoint).toMatch(/rather than\s+by app code or runtime env/u);
    expect(checkpoint).toContain('local head `e7d44ddaf`');
    expect(checkpoint).toContain('wrote the generated `.env.dev`');
    expect(checkpoint).toContain('Bun `1.3.11`');
    expect(checkpoint).toMatch(/Docker Compose v5\.1\.4/u);
    expect(checkpoint).toContain('no project containers');
    expect(checkpoint).toContain('Stripe webhook secret source');
    expect(checkpoint).toContain('Playwright Chromium cache\n  checks');
    expect(checkpoint).toContain('evorto-runtime-preflight-39526');
    expect(checkpoint).toContain(
      "docker ps --all --filter name=evorto-runtime-preflight --format\n  '{{.Names}} {{.Status}}'",
    );
    expect(checkpoint).toMatch(/cleanup stays bounded/u);
    expect(checkpoint).toContain('local head `cbf4bdba1`');
    expect(checkpoint).toContain('CI dependency cache-scope guard');
    expect(checkpoint).toMatch(/wrote `.env.dev`/u);
    expect(checkpoint).toMatch(/required and available runtime\s+variables/u);
    expect(checkpoint).toContain('evorto-runtime-preflight-91702');
    expect(checkpoint).toMatch(/listed no remaining preflight containers/u);
    expect(checkpoint).toContain('local head `bfc9517da`');
    expect(checkpoint).toContain('durable viewport inventory guard');
    expect(checkpoint).toContain('evorto-runtime-preflight-27687');
    expect(checkpoint).toMatch(/listed no remaining preflight containers/u);
    expect(checkpoint).toContain('local head `266a224f0`');
    expect(checkpoint).toContain('Playwright runtime-modifier inventory guard');
    expect(checkpoint).toContain('evorto-runtime-preflight-98795');
    expect(checkpoint).toMatch(/listed no remaining preflight containers/u);
    expect(checkpoint).toContain('`bun run docker:clean-stale`');
    expect(checkpoint).toContain('com.docker.compose.project` label');
    expect(checkpoint).toMatch(/single JSON object/u);
    expect(checkpoint).toContain('`created`, `dead`, or `removing`');
    expect(checkpoint).toMatch(/removes stale containers one at a time/u);
    expect(checkpoint).toMatch(/without relying on GNU\s+`timeout`/u);
    expect(checkpoint).toContain('connected to the `iab` browser');
    expect(checkpoint).toContain('created tab `2`');
    expect(checkpoint).toContain('local head `09b39ac86`');
    expect(checkpoint).toContain('template evidence watchpoint guard');
    expect(checkpoint).toContain('evorto-runtime-preflight-46336');
    expect(checkpoint).toMatch(/listed no remaining preflight containers/u);
    expect(checkpoint).toContain('local head `a4cae51d8`');
    expect(checkpoint).toMatch(/main-checkout env-file\s+hint/u);
    expect(checkpoint).toContain('/Users/hedde/code/evorto/.env');
    expect(checkpoint).toMatch(/exposed the same variable keys/u);
    expect(checkpoint).toContain('E2E_GLOBAL_ADMIN_AUTH0_IDS');
    expect(checkpoint).toContain('evorto-runtime-preflight-70680');
    expect(checkpoint).toMatch(/At that historical\s+retry/u);
    expect(checkpoint).toMatch(
      /below app code,\s+Browser transport,\s+and local\s+dotenv configuration/u,
    );
    expect(checkpoint).toMatch(
      /current running-Docker Browser evidence above now\s+supersedes/u,
    );
    expect(checkpoint).toContain('local head `91c292c2e`');
    expect(checkpoint).toMatch(/healthy `db`, `minio`, and\s+`stripe`/u);
    expect(checkpoint).toMatch(/no current-head `evorto`\s+app container/u);
    expect(checkpoint).toMatch(/older port-4200 app container/u);
    expect(checkpoint).toMatch(/belonged to another\s+worktree/u);
    expect(checkpoint).toContain('evorto-runtime-preflight-95525');
    expect(checkpoint).toMatch(
      /Docker Compose\s+project-container inspection/u,
    );
    expect(checkpoint).toContain('`bun run docker:clean-stale`');
    expect(checkpoint).toMatch(
      /No\s+stale Docker Compose project containers found/u,
    );
    expect(checkpoint).toContain('evorto-runtime-preflight-97022');
    expect(checkpoint).toMatch(
      /fresh\s+Browser route\/mobile layout verification blocked below the app tooling layer/u,
    );
    expect(checkpoint).toContain('local head `e033b64ec`');
    expect(checkpoint).toMatch(/not image pull latency/u);
    expect(checkpoint).toContain('`alpine:latest`');
    expect(checkpoint).toMatch(/already present locally/u);
    expect(checkpoint).toContain('--pull never alpine:latest true');
    expect(checkpoint).toMatch(/timed out after 20 seconds/u);
    expect(checkpoint).toContain('codex-preflight-manual');
    expect(checkpoint).toMatch(/listed no matching leftovers/u);
    expect(checkpoint).toMatch(/Older\s+Browser\/layout\s+checkpoints/u);
    expect(checkpoint).not.toContain('stale-container removal timeouts');
    expect(checkpoint).not.toContain('until Docker\n  can remove');
    expect(helpersReadme).toContain('`bun run docker:clean-stale`');
    expect(helpersReadme).toContain('generated `COMPOSE_PROJECT_NAME`');
    expect(helpersReadme).toContain(
      'Docker `com.docker.compose.project` label',
    );
    expect(helpersReadme).toContain(
      'removes stale or unhealthy containers one at a time',
    );
    expect(helpersReadme).toContain('Docker container start path');
    expect(helpersReadme).toContain('disposable Alpine');
    expect(helpersReadme).toMatch(/restart\s+Docker Desktop/u);
    expect(helpersReadme).toContain('below the app tooling layer');
    expect(runtimePreflight).toContain('Docker container start path');
    expect(runtimePreflight).toContain(
      'evorto-runtime-preflight-${process.pid}',
    );
    expect(runtimePreflight).toContain(
      'docker run --name "$container_name" --rm --pull missing alpine:latest true',
    );
    expect(runtimePreflight).toContain('docker-container-start-check');
    expect(runtimePreflight).toContain('Attempted bounded cleanup');
    expect(runtimePreflight).toContain('cleanupTimeoutSeconds');
    expect(runtimePreflight).toContain('commandTimeoutMs * 2');
    expect(runtimePreflight).toContain(
      'Docker can inspect local configuration but cannot start containers',
    );
    expect(helpersReadme).toContain('bounded\ncleanup window');
    expect(helpersReadme).toContain('evorto-runtime-preflight-*');
    expect(testsReadme).toContain('bounded cleanup window');
    expect(testsReadme).toContain('evorto-runtime-preflight-*');
    expect(testsReadme).toContain('`bun run docker:clean-stale`');
    expect(testsReadme).toContain('generated `COMPOSE_PROJECT_NAME`');
    expect(testsReadme).toContain('removes them one at a time');
    expect(testsReadme).toContain('disposable Alpine container start path');
    expect(testsReadme).toMatch(/restart\s+Docker Desktop/u);
    expect(testsReadme).toMatch(/below\s+the app tooling layer/u);
    expect(checkpoint).not.toContain('currently blocked by');
    expect(checkpoint).not.toContain(
      'Fresh Browser route/mobile layout evidence is currently blocked',
    );
    expect(checkpoint).not.toContain(
      '`Must setup test before interacting with the page`',
    );
    expect(checkpoint).toMatch(
      /Playwright-test MCP Browser watchpoint is therefore recovered/u,
    );
    expect(checkpoint).toMatch(/lightweight public General planner route/u);
    expect(checkpoint).toContain('local head `17c35e732`');
    expect(checkpoint).toMatch(/reran `bun run docker:check` successfully/u);
    expect(checkpoint).toMatch(/disposable\s+Alpine container start path/u);
    expect(checkpoint).toContain('`bun run\n  docker:start`');
    expect(checkpoint).toContain('`evorto-4dddca18` Docker\n  app');
    expect(checkpoint).toMatch(/generated `BASE_URL` on port 4577/u);
    expect(checkpoint).toMatch(/cached Bun\s+install layer/u);
    expect(checkpoint).toMatch(
      /offline\s+public Font Awesome\s+package install path/u,
    );
    expect(checkpoint).toContain('Direct in-app Browser control');
    expect(checkpoint).toMatch(/connected to the `iab`\s+browser/u);
    expect(checkpoint).toMatch(
      /Browser `viewport` capability for 320x740,\s+390x844,\s+and\s+1440x900/u,
    );
    expect(checkpoint).toContain('visited `/`, `/events`, `/legal/imprint`');
    expect(checkpoint).toContain('/legal/privacy');
    expect(checkpoint).toContain('/legal/terms');
    expect(checkpoint).toContain('/403');
    expect(checkpoint).toContain('/500');
    expect(checkpoint).toContain('/404');
    expect(checkpoint).toMatch(/All 24 route\/viewport checks/u);
    expect(checkpoint).toMatch(/matching `window\.innerWidth`/u);
    expect(checkpoint).toMatch(/no top\/side\s+clipped visible controls/u);
    expect(checkpoint).toMatch(/except the expected `\/500` page/u);
    expect(checkpoint).toMatch(/zero Browser warning\/error logs/u);
    expect(checkpoint).toContain(
      '/tmp/evorto-current-head-17c35e-general-mobile-events.jpg',
    );
  });

  it('keeps the observed PR CI cleanup checkpoint tied to active-head evidence', () => {
    const source = readSource('STABILIZATION.md');
    const workflow = readSource('.github/workflows/e2e-baseline.yml');
    const ciDependencyCacheAction = readSource(
      '.github/actions/setup-bun-dependency-caches/action.yml',
    );
    const checkpoint = source.match(
      /Observed PR #62 active-head CI cleanup checkpoint:[\s\S]*?(?=\n- Current |\n- Observed |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    const checkpointText = normalizeWhitespace(checkpoint ?? '');
    expect(checkpointText).toContain('local head `83c5f178`');
    expect(checkpointText).toContain('CodeQL, CodeQL `Analyze (actions)`');
    expect(checkpointText).toContain(
      'Copilot setup, Git Town, CodeRabbit, the serial E2E',
    );
    expect(checkpointText).toContain('E2E run `27054906042`');
    expect(checkpointText).toContain(
      '`Playwright E2E (functional-1)`, `Playwright E2E (functional-2)`, and `Playwright E2E (docs)` green',
    );
    expect(checkpointText).toContain(
      'completed all three serialized worker shards',
    );
    expect(checkpointText).toContain('public Font Awesome registry guard');
    expect(checkpointText).toContain('Bun package cache');
    expect(checkpointText).toContain('dependency-tree cache');
    expect(checkpointText).toContain('Docker build cache');
    expect(checkpointText).toContain('Docker Bun cache mount');
    expect(checkpointText).toContain('Playwright browser cache');
    expect(checkpointText).toContain(
      '`Bun dependency tree cache restored; skipping registry install.`',
    );
    expect(checkpointText).toContain('required the warmed Docker Bun cache');
    expect(checkpointText).toContain('pruned expired Neon branches before E2E');
    expect(checkpointText).toContain('skipped a worker registry install path');
    expect(checkpointText).toContain('confirmed Neon branch expiration');
    expect(checkpointText).toContain('functional-1 temporarily created');
    expect(checkpointText).toContain('`br-proud-violet-a94pni7t`');
    expect(checkpointText).toContain('functional-2 temporarily created');
    expect(checkpointText).toContain('`br-late-bread-a9fb49pw`');
    expect(checkpointText).toContain('docs temporarily created');
    expect(checkpointText).toContain('`br-rapid-sun-a9ue1y2n`');
    expect(checkpointText).toContain('serial `Warm CI dependency caches` job');
    expect(checkpointText).toContain('warmed Docker Bun cache mount');
    expect(checkpointText).toContain('`if: always()` cleanup finalizers');
    expect(checkpointText).toContain('`Stop Docker stack`');
    expect(checkpointText).toContain('`Prune expired Neon branches after E2E`');
    expect(checkpointText).toContain('hourly and `workflow_run` Neon');
    expect(checkpointText).toContain(
      '`total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h`',
    );
    expect(checkpointText).toContain('after the functional-1 finalizers');
    expect(checkpointText).toContain('after the functional-2 finalizers');
    expect(checkpointText).toContain('after the completed docs finalizers');
    expect(checkpointText).toContain(
      'active CI workers may own short-lived branches',
    );
    expect(checkpointText).toContain('two-hour TTL');
    expect(checkpointText).toContain('cleanup finalizer');
    expect(checkpointText).toContain('superseded CI run');
    expect(checkpointText).toContain('`27056153072`');
    expect(checkpointText).toContain('head `07631279`');
    expect(checkpointText).toContain('newer head `0c63e38d`');
    expect(checkpointText).toContain('started Docker');
    expect(checkpointText).toContain('recorded Neon Local metadata');
    expect(checkpointText).toContain('`Collect Docker logs`');
    expect(checkpointText).toContain('`2026-06-06T07:33:57Z`');
    expect(checkpointText).toContain('bun run neon:cleanup:dry-run');
    expect(checkpointText).toContain(
      'no Neon Local branch ids in `.neon_local/.branches`',
    );
    expect(checkpointText).toContain('pushing head `6520e1540`');
    expect(checkpointText).toContain('used the short Neon cleanup alias');
    expect(checkpointText).toContain('only protected `main`');
    expect(workflow).toContain('name: Warm CI dependency caches');
    expect(workflow).toContain('DELETE_BRANCH: true');
    expect(workflow).toContain('NEON_LOCAL_BRANCH_TTL_HOURS: 2');
    expect(workflow).toContain(
      'Prune expired Neon branches before cache installs',
    );
    expect(workflow).toContain(
      'run: bash helpers/testing/ci-prune-neon-local-branches.sh',
    );
    expect(ciDependencyCacheAction).toContain(
      'Prepare public Font Awesome registry',
    );
    expect(ciDependencyCacheAction).toContain(
      'run: bash helpers/testing/prepare-public-fontawesome-ci.sh',
    );
    expect(workflow).toContain('Require warmed Docker Bun cache mount');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('Stop Docker stack');
    expect(workflow).toContain('Prune expired Neon branches after E2E');

    const cleanupWorkflow = readSource(
      '.github/workflows/neon-branch-cleanup.yml',
    );
    expect(cleanupWorkflow).toContain('workflow_run:');
    expect(cleanupWorkflow).toContain('schedule:');
    expect(cleanupWorkflow).toContain('NEON_LOCAL_BRANCH_TTL_HOURS: 2');
  });

  it('keeps CI Docker-start retry cleanup bounded in the checkpoint', () => {
    const source = readSource('STABILIZATION.md');
    const ciStartDockerStackHelper = readSource(
      'helpers/testing/ci-start-docker-stack.sh',
    );
    const checkpoint = source.match(
      /Current CI Docker-start hardening checkpoint:[\s\S]*?(?=\n- Current |\n- Observed |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    expect(checkpoint).toContain('PR head `b5bb9c286`');
    expect(checkpoint).toContain('`helpers/testing/ci-start-docker-stack.sh`');
    expect(checkpoint).toContain(
      'bounds\n  `docker compose down --timeout 60 --remove-orphans` to 90 seconds',
    );
    expect(checkpoint).toContain(
      'in-retry Neon Local branch cleanup to five minutes',
    );
    expect(checkpoint).toContain('cannot sit in an unbounded cleanup command');
    expect(ciStartDockerStackHelper).toContain(
      'timeout 90s node_modules/.bin/dotenv -c dev -- docker compose down --timeout 60 --remove-orphans',
    );
    expect(ciStartDockerStackHelper).toContain(
      'timeout 5m node_modules/.bin/dotenv -c dev -- bun helpers/testing/delete-neon-local-branches.ts',
    );
  });

  it('keeps the PR docs assertion checkpoint tied to current-head CI evidence', () => {
    const source = readSource('STABILIZATION.md');
    const checkpoint = source.match(
      /Current PR #62 docs assertion checkpoint:[\s\S]*?(?=\n- Current |\n- Observed |\n\n## Review Next|\n$)/u,
    )?.[0];

    expect(checkpoint).toBeDefined();
    const checkpointText = normalizeWhitespace(checkpoint ?? '');
    expect(checkpointText).toContain('PR head `23dcc9c53`');
    expect(checkpointText).toContain('E2E run `26982986517`');
    expect(checkpointText).toContain(
      'bounded Docker startup and teardown path',
    );
    expect(checkpointText).toContain(
      'functional-1 and functional-2 Playwright E2E shards',
    );
    expect(checkpointText).toContain('`Playwright E2E (docs)`');
    expect(checkpointText).toContain('`Start Docker stack for E2E`');
    expect(checkpointText).toContain('`Confirm Neon branch expiration`');
    expect(checkpointText).toContain('`Stop Docker stack`');
    expect(checkpointText).toContain('`Prune expired Neon branches after E2E`');
    expect(checkpointText).toContain(
      '`tests/docs/admin/general-settings.doc.ts`',
    );
    expect(checkpointText).toContain('stale custom-domain labels');
    expect(checkpointText).toContain('`Custom domains`');
    expect(checkpointText).toContain('`Multi-domain routing`');
    expect(checkpointText).toContain('`Domain onboarding`');
    expect(checkpointText).toContain(
      '`Custom-domain verification and multi-domain automation are deferred.`',
    );
    expect(checkpointText).toContain(
      '`total=1, protected=1, active_test=0, stale_deleted=0, ttl=2h`',
    );
    expect(checkpointText).toContain('protected `main` only');
    expect(checkpointText).toContain('generated-documentation source guard');
    expect(checkpointText).toContain('focused docs `--list` check');
    expect(checkpointText).toContain('source-guard tests pass');
  });

  it('keeps public General viewport coverage durable and compact', () => {
    const source = readSource('STABILIZATION.md');
    const inventory = readSource('tests/test-inventory.md');
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts: Record<string, string>;
    };
    const testsReadme = readSource('tests/README.md');
    const viewportSpec = readSource(
      'tests/specs/smoke/public-general-viewports.spec.ts',
    );
    const appRoutes = readSource('src/app/app.routes.ts');
    const appRoutesSpec = readSource('src/app/app.routes.spec.ts');
    const appServerRoutes = readSource('src/app/app.routes.server.ts');
    const appServerRoutesSpec = readSource('src/app/app.routes.server.spec.ts');
    const createAccountTemplate = readSource(
      'src/app/core/create-account/create-account.component.html',
    );
    const pageLayoutHelper = readSource('tests/support/utils/page-layout.ts');
    const pageLayoutHelperSpec = readSource(
      'tests/specs/smoke/page-layout-helper.test.ts',
    );
    const eventViewportSpec = readSource(
      'tests/specs/events/event-viewports.spec.ts',
    );
    const financeViewportSpec = readSource(
      'tests/specs/finance/finance-viewports.spec.ts',
    );
    const financeOverviewTemplate = readSource(
      'src/app/finance/finance-overview/finance-overview.component.html',
    );
    const receiptRefundTemplate = readSource(
      'src/app/finance/receipt-refund-list/receipt-refund-list.component.html',
    );
    const adminSettingsSpec = readSource(
      'tests/specs/admin/general-settings.spec.ts',
    );
    const adminViewportSpec = readSource(
      'tests/specs/admin/admin-viewports.spec.ts',
    );
    const adminRolesViewportSpec = readSource(
      'tests/specs/admin/roles-viewports.spec.ts',
    );
    const taxRatesSettingsComponent = readSource(
      'src/app/admin/tax-rates-settings/tax-rates-settings.component.ts',
    );
    const eventReviewsComponent = readSource(
      'src/app/admin/event-reviews/event-reviews.component.ts',
    );
    const adminOverviewTemplate = readSource(
      'src/app/admin/admin-overview/admin-overview.component.html',
    );
    const userListTemplate = readSource(
      'src/app/admin/user-list/user-list.component.html',
    );
    const roleFormTemplate = readSource(
      'src/app/admin/components/role-form/role-form.component.html',
    );
    const globalAdminSpec = readSource(
      'tests/specs/admin/global-admin-tenants.spec.ts',
    );
    const profileViewportSpec = readSource(
      'tests/specs/profile/user-profile-viewports.spec.ts',
    );
    const templateViewportSpec = readSource(
      'tests/specs/templates/template-viewports.spec.ts',
    );
    const templateListTemplate = readSource(
      'src/app/templates/template-list/template-list.component.html',
    );
    const navigationTemplate = readSource(
      'src/app/core/navigation/navigation.component.html',
    );
    const scannerViewportSpec = readSource(
      'tests/specs/scanning/scanner-viewports.spec.ts',
    );
    const scannerTemplate = readSource(
      'src/app/scanning/scanner/scanner.component.html',
    );
    const handleRegistrationTemplate = readSource(
      'src/app/scanning/handle-registration/handle-registration.component.html',
    );
    const membersHubViewportSpec = readSource(
      'tests/specs/internal/members-hub-viewports.spec.ts',
    );
    const membersHubTemplate = readSource(
      'src/app/internal-pages/members-hub/members-hub.component.html',
    );
    const membersHubComponent = readSource(
      'src/app/internal-pages/members-hub/members-hub.component.ts',
    );
    const durableViewportSpecPaths = [
      'tests/specs/admin/admin-viewports.spec.ts',
      'tests/specs/admin/general-settings.spec.ts',
      'tests/specs/admin/global-admin-tenants.spec.ts',
      'tests/specs/admin/roles-viewports.spec.ts',
      'tests/specs/events/event-viewports.spec.ts',
      'tests/specs/finance/finance-viewports.spec.ts',
      'tests/specs/internal/members-hub-viewports.spec.ts',
      'tests/specs/profile/user-profile-viewports.spec.ts',
      'tests/specs/scanning/scanner-viewports.spec.ts',
      'tests/specs/smoke/public-general-viewports.spec.ts',
      'tests/specs/templates/template-viewports.spec.ts',
    ] as const;
    const authenticatedViewportSpecPaths = durableViewportSpecPaths.filter(
      (sourcePath) =>
        sourcePath !== 'tests/specs/smoke/public-general-viewports.spec.ts',
    );
    const authenticatedViewportScript =
      'bun helpers/testing/run-playwright.ts ' +
      `${authenticatedViewportSpecPaths.join(' ')} --project=local-chrome-baseline --workers=1`;
    const discoveredViewportSpecPaths = listFiles('tests/specs', '.ts')
      .filter((sourcePath) =>
        readSource(sourcePath).includes('expectedStablePageLayout'),
      )
      .filter(
        (sourcePath) =>
          sourcePath !== 'tests/specs/smoke/page-layout-helper.test.ts',
      )
      .toSorted();
    const durableViewportSpecs = [
      adminSettingsSpec,
      adminViewportSpec,
      adminRolesViewportSpec,
      eventViewportSpec,
      financeViewportSpec,
      globalAdminSpec,
      membersHubViewportSpec,
      profileViewportSpec,
      scannerViewportSpec,
      templateViewportSpec,
      viewportSpec,
    ];

    expect(discoveredViewportSpecPaths).toEqual(durableViewportSpecPaths);

    for (const durableViewportSpecPath of durableViewportSpecPaths) {
      expect(inventory).toContain(
        durableViewportSpecPath.replace('tests/', ''),
      );
    }

    for (const durableViewportSpec of durableViewportSpecs) {
      expect(durableViewportSpec).toContain(
        "from '../../support/utils/page-layout'",
      );
      expect(durableViewportSpec).toContain(
        "{ height: 740, label: 'narrow mobile', width: 320 }",
      );
      expect(durableViewportSpec).toContain(
        "{ height: 844, label: 'mobile', width: 390 }",
      );
      expect(durableViewportSpec).toContain(
        "{ height: 900, label: 'desktop', width: 1440 }",
      );
      expect(durableViewportSpec).toContain(
        'for (const viewport of viewportSizes)',
      );
      expect(durableViewportSpec).toContain('test.step(`${viewport.label}');
      expect(durableViewportSpec).toContain('page.setViewportSize(viewport)');
      expect(durableViewportSpec).toContain('expectedStablePageLayout');
      expect(durableViewportSpec).toContain('readPageLayout(page)');
      expect(durableViewportSpec).not.toContain('const readPageLayout = async');
    }

    expect(pageLayoutHelper).toContain('isInsideHorizontalScrollContainer');
    expect(pageLayoutHelper).toContain('isElementCenterInsideOverflowClip');
    expect(pageLayoutHelper).toContain("['auto', 'clip', 'hidden', 'scroll']");
    expect(pageLayoutHelper).toContain('coveredControlCount');
    expect(pageLayoutHelper).toContain('coveredControlLabels');
    expect(pageLayoutHelper).toContain('coveredTextCount');
    expect(pageLayoutHelper).toContain('coveredTextLabels');
    expect(pageLayoutHelper).toContain('CoveredTextLabel');
    expect(pageLayoutHelper).toContain('readableTextElements');
    expect(pageLayoutHelper).toContain('[data-layout-readable-text]');
    expect(pageLayoutHelper).toContain('!controlElements.has(element)');
    expect(pageLayoutHelper).toContain('coveredTextElements');
    expect(pageLayoutHelper).toContain('centerX');
    expect(pageLayoutHelper).toContain('centerY');
    expect(pageLayoutHelper).toContain('coveringClassName');
    expect(pageLayoutHelper).toContain('document.elementFromPoint');
    expect(pageLayoutHelper).toContain('!elementAtCenter.contains(element)');
    expect(pageLayoutHelper).toContain('horizontallyClippedControlCount');
    expect(pageLayoutHelper).toContain('horizontallyClippedControlLabels');
    expect(pageLayoutHelper).toContain('ClippedControlLabel');
    expect(pageLayoutHelper).toContain('horizontallyClippedTextCount');
    expect(pageLayoutHelper).toContain('horizontallyClippedTextLabels');
    expect(pageLayoutHelper).toContain('ClippedTextLabel');
    expect(pageLayoutHelper).toContain('fixedOrStickyPosition');
    expect(pageLayoutHelper).toContain('elementLabel');
    expect(pageLayoutHelper).toContain('interactiveSelector');
    expect(pageLayoutHelper).toContain("getAttribute('aria-label')");
    expect(pageLayoutHelper).toContain("getAttribute('aria-labelledby')");
    expect(pageLayoutHelper).toContain("getAttribute('title')");
    expect(pageLayoutHelper).toContain(
      'label[for="${CSS.escape(element.id)}"]',
    );
    expect(pageLayoutHelper).toContain('unlabeledControlCount');
    expect(pageLayoutHelper).toContain('unlabeledControlLabels');
    expect(pageLayoutHelper).toContain('UnlabeledControlLabel');
    expect(pageLayoutHelper).toContain('verticallyClippedFixedControlCount');
    expect(pageLayoutHelper).toContain('verticallyClippedFixedControlLabels');
    expect(pageLayoutHelper).toContain('VerticallyClippedControlLabel');
    expect(pageLayoutHelper).toContain('verticallyClippedFixedTextCount');
    expect(pageLayoutHelper).toContain('verticallyClippedFixedTextLabels');
    expect(pageLayoutHelper).toContain('VerticallyClippedTextLabel');
    expect(pageLayoutHelper).toContain("position === 'fixed'");
    expect(pageLayoutHelper).toContain("position === 'sticky'");
    expect(pageLayoutHelper).toContain('horizontallyOverflowingElementCount');
    expect(pageLayoutHelper).toContain('horizontallyOverflowingElementLabels');
    expect(pageLayoutHelper).toContain(
      'document.documentElement.scrollWidth > window.innerWidth + 1',
    );
    expect(pageLayoutHelper).toContain(
      "!element.classList.contains('mat-mdc-button-touch-target')",
    );
    expect(pageLayoutHelper).toContain('isSameMaterialFormFieldDecoration');
    expect(pageLayoutHelper).toContain('isSameInteractiveSurface');
    expect(pageLayoutHelper).toContain(
      'hitTarget.closest(interactiveSelector)',
    );
    expect(pageLayoutHelper).toContain('hasVerticalScrollRemaining');
    expect(pageLayoutHelper).toContain('isRecoverableMobileNavigationOverlap');
    expect(pageLayoutHelper).toContain("hitTarget.closest('.navigation')");
    expect(pageLayoutHelper).toContain(
      "control.closest('.mat-mdc-form-field')",
    );
    expect(pageLayoutHelper).toContain("tagName.toLowerCase() === 'mat-label'");
    expect(pageLayoutHelper).toContain(
      "classList.contains('mdc-floating-label')",
    );
    expect(pageLayoutHelper).toContain(
      "classList.contains('mat-mdc-form-field-required-marker')",
    );
    expect(pageLayoutHelper).toContain('isSameMaterialPaginatorTouchTarget');
    expect(pageLayoutHelper).toContain("control.closest('.mat-mdc-paginator')");
    expect(pageLayoutHelper).toContain(
      "classList.contains('mat-mdc-paginator-touch-target')",
    );
    expect(pageLayoutHelper).toContain('[role="tab"]');
    expect(pageLayoutHelper).toContain('[role="switch"]');
    expect(pageLayoutHelper).toContain('[role="checkbox"]');
    expect(pageLayoutHelper).toContain('[role="combobox"]');
    expect(pageLayoutHelper).toContain('[role="menuitem"]');
    expect(pageLayoutHelper).toContain('[role="option"]');
    expect(pageLayoutHelper).toContain('[role="radio"]');
    expect(pageLayoutHelper).toContain('[role="slider"]');
    expect(pageLayoutHelper).toContain('[role="spinbutton"]');
    expect(pageLayoutHelper).toContain('[contenteditable="true"]');
    expect(pageLayoutHelper).toContain('[tabindex]:not([tabindex="-1"])');
    expect(pageLayoutHelperSpec).toContain('page.setViewportSize');
    expect(pageLayoutHelperSpec).toContain('expectedStablePageLayout');
    expect(pageLayoutHelperSpec).toContain('readPageLayout(page)');
    expect(pageLayoutHelperSpec).toContain('wide-panel');
    expect(pageLayoutHelperSpec).toContain('covered-action');
    expect(pageLayoutHelperSpec).toContain('covering-layer');
    expect(pageLayoutHelperSpec).toContain('covered-text');
    expect(pageLayoutHelperSpec).toContain('text-covering-layer');
    expect(pageLayoutHelperSpec).toContain('Covered readable copy');
    expect(pageLayoutHelperSpec).toContain('clipped-text');
    expect(pageLayoutHelperSpec).toContain('Clipped readable copy');
    expect(pageLayoutHelperSpec).toContain('fixed-clipped-text');
    expect(pageLayoutHelperSpec).toContain('Fixed clipped readable copy');
    expect(pageLayoutHelperSpec).toContain('fixed-clipped-action');
    expect(pageLayoutHelperSpec).toContain('Fixed clipped action');
    expect(pageLayoutHelperSpec).toContain('clipped-action');
    expect(pageLayoutHelperSpec).toContain('clipped-icon-action');
    expect(pageLayoutHelperSpec).toContain('Icon-only clipped action');
    expect(pageLayoutHelperSpec).toContain('clipped-switch');
    expect(pageLayoutHelperSpec).toContain('Notification switch');
    expect(pageLayoutHelperSpec).toContain('clipped-menuitem');
    expect(pageLayoutHelperSpec).toContain('Menu action');
    expect(pageLayoutHelperSpec).toContain('clipped-combobox');
    expect(pageLayoutHelperSpec).toContain('Payment method');
    expect(pageLayoutHelperSpec).toContain('clipped-slider');
    expect(pageLayoutHelperSpec).toContain('Capacity slider');
    expect(pageLayoutHelperSpec).toContain('clipped-spinbutton');
    expect(pageLayoutHelperSpec).toContain('Guest count');
    expect(pageLayoutHelperSpec).toContain('clipped-radio');
    expect(pageLayoutHelperSpec).toContain('Radio option');
    expect(pageLayoutHelperSpec).toContain('clipped-focusable');
    expect(pageLayoutHelperSpec).toContain('Focusable action');
    expect(pageLayoutHelperSpec).toContain('unlabeled-icon-action');
    expect(pageLayoutHelperSpec).toContain('unlabeledControlLabels');
    expect(pageLayoutHelperSpec).toContain('table-scroll');
    expect(pageLayoutHelperSpec).toContain(
      'shared page layout helper ignores Material paginator touch target overlap',
    );
    expect(pageLayoutHelperSpec).toContain('mat-mdc-paginator-touch-target');
    expect(pageLayoutHelperSpec).toContain('Items per page:');
    expect(pageLayoutHelperSpec).toContain(
      'shared page layout helper treats nested control icons as the same surface',
    );
    expect(pageLayoutHelperSpec).toContain('Nested icon control page');
    expect(pageLayoutHelperSpec).toContain('Review tenant');
    expect(pageLayoutHelperSpec).toContain('horizontalOverflow');
    expect(pageLayoutHelperSpec).toContain(
      'horizontallyOverflowingElementLabels',
    );
    expect(pageLayoutHelperSpec).toContain('coveredControlLabels');
    expect(pageLayoutHelperSpec).toContain('coveredTextLabels');
    expect(pageLayoutHelperSpec).toContain('horizontallyClippedControlLabels');
    expect(pageLayoutHelperSpec).toContain('horizontallyClippedTextLabels');
    expect(pageLayoutHelperSpec).toContain(
      'verticallyClippedFixedControlLabels',
    );
    expect(pageLayoutHelperSpec).toContain('verticallyClippedFixedTextLabels');
    expect(source).toContain(
      'A fresh June 5, 2026 `bun run test:e2e:layout-helper` run at PR head',
    );
    expect(source).toContain('`877493157`');
    expect(source).toContain('NO_WEBSERVER=true');
    expect(source).toContain(
      'pinned ignored repository-local\n  `DOCS_OUT_DIR` and `DOCS_IMG_OUT_DIR`',
    );
    expect(source).toMatch(
      /passed\s+all\s+five no-app-startup layout-helper tests/u,
    );
    expect(source).toContain(
      '`bun run docker:ps` showed no generated Compose project containers',
    );
    expect(source).toContain(
      'failed only at `Docker container start path` with\n  the bounded disposable Alpine timeout',
    );
    expect(source).toContain(
      'fresh Browser route/mobile layout\n  verification is blocked by the host Docker start path',
    );
    expect(packageJson.scripts['test:e2e:authenticated-viewports']).toBe(
      authenticatedViewportScript,
    );
    expect(packageJson.scripts['test:e2e:mcp-browser-planner']).toBe(
      'bun helpers/testing/run-playwright.ts --no-webserver tests/setup/mcp-browser.seed.ts --project=mcp-browser-planner --workers=1 --no-deps',
    );
    expect(
      packageJson.scripts['test:e2e:mcp-browser-authenticated-planner'],
    ).toBe(
      'bun helpers/testing/run-playwright.ts tests/setup/mcp-browser-authenticated.seed.ts --project=mcp-browser-authenticated-planner --workers=1',
    );
    expect(packageJson.scripts['test:e2e:layout-helper']).toBe(
      'bun helpers/testing/run-playwright.ts --no-webserver tests/specs/smoke/page-layout-helper.test.ts --project=local-chrome-baseline --no-deps',
    );
    expect(packageJson.scripts['test:e2e:public-general-viewports']).toBe(
      'bun helpers/testing/run-playwright.ts --no-webserver tests/specs/smoke/public-general-viewports.spec.ts --project=local-chrome-baseline --workers=1 --no-deps',
    );
    expect(packageJson.scripts['test:e2e:reporter-paths']).toBe(
      'bun helpers/testing/run-playwright.ts --no-webserver tests/specs/reporting/reporter-paths.test.ts --project=local-chrome-baseline --no-deps',
    );
    expect(packageJson.scripts['test:e2e:doc-screenshot']).toBe(
      'bun helpers/testing/run-playwright.ts --no-webserver tests/specs/screenshot/doc-screenshot.test.ts --project=local-chrome-baseline --no-deps',
    );
    expect(testsReadme).toContain('bun run test:e2e:authenticated-viewports');
    expect(testsReadme).toContain('authenticated durable\n  viewport pack');
    expect(testsReadme).toContain('logged-in app chrome');
    expect(testsReadme).toContain('bun run test:e2e:mcp-browser-planner');
    expect(testsReadme).toContain('public MCP Browser\n  planner seed');
    expect(testsReadme).toContain('bun run test:e2e:layout-helper');
    expect(testsReadme).toContain(
      'Local Playwright package scripts that run `playwright test` share',
    );
    expect(testsReadme).toContain('bun run test:e2e:public-general-viewports');
    expect(testsReadme).toContain('bun run test:e2e:reporter-paths');
    expect(testsReadme).toContain('bun run test:e2e:doc-screenshot');
    expect(testsReadme).toContain('--no-webserver');
    expect(testsReadme).toContain('--no-deps');
    expect(testsReadme).toContain('does not start Docker');
    expect(source).toContain('local head `bb9431e66`');
    expect(source).toContain('passed all three layout-helper tests');
    expect(source).toContain('pushed-head fix `a9d4544e1`');
    expect(source).toMatch(/passed\s+all\s+five no-app-startup/u);
    expect(source).toContain('same-paginator touch-target overlap');
    expect(source).toContain('`.mat-mdc-paginator-touch-target`');
    expect(source).toContain('`/finance/transactions` and\n  `/admin/users`');
    expect(source).toContain('app startup disabled');
    expect(source).toContain(
      'shared mobile/no-glitch detector remains locally verifiable',
    );
    expect(source).toContain('shared viewport guard checkpoint');
    expect(source).toContain('`tests/support/utils/page-layout.ts`');
    expect(inventory).toContain('specs/smoke/page-layout-helper.test.ts');
    expect(inventory).toContain('test:e2e:layout-helper');
    expect(inventory).toContain(
      '`helpers/testing/run-playwright.ts` to\n    refresh `.env.dev`, set ignored docs/image output paths',
    );
    expect(inventory).toContain('specs/reporting/reporter-paths.test.ts');
    expect(inventory).toContain('specs/screenshot/doc-screenshot.test.ts');
    expect(inventory).toContain('test:e2e:reporter-paths');
    expect(inventory).toContain('test:e2e:doc-screenshot');
    expect(inventory).toContain('highlighted screenshot targets');
    expect(inventory).toContain('static doc-screenshot helper contract');
    expect(inventory).toMatch(/visible page-content\s+detection/u);
    expect(inventory).toContain('ignored docs/image output paths');
    expect(inventory).toContain('support/utils/page-layout.ts');
    expect(inventory).toContain('shared viewport layout guard');
    expect(inventory).toContain('common ARIA/Material\n    interactive roles');
    expect(inventory).toContain('`switch`, `checkbox`, `combobox`, `menuitem`');
    expect(inventory).toContain(
      '`option`, `radio`, `slider`, and `spinbutton`',
    );
    expect(inventory).toContain('focusable `tabindex`\n    custom controls');
    expect(inventory).toContain('helper without app startup');
    expect(inventory).toMatch(
      /covered controls,\s+covered readable text,\s+clipped controls,\s+clipped readable text,\s+vertically clipped fixed controls,\s+and vertically clipped fixed readable text/u,
    );
    expect(inventory).toContain(
      'controls covered by another separate visible layer',
    );
    expect(inventory).toContain(
      'readable text\n    covered by another visible layer',
    );
    expect(source).toContain('covered readable text');
    expect(source).toContain('vertically clipped fixed/sticky readable text');
    expect(source).toContain('icon-only control diagnostics use accessible');
    expect(source).toContain('visible controls without accessible labels');
    expect(source).toContain('common ARIA/Material\n  interactive roles');
    expect(source).toContain('`switch`, `checkbox`, `combobox`, `menuitem`');
    expect(source).toContain('`option`, `radio`, `slider`, and `spinbutton`');
    expect(source).toContain('editable content');
    expect(source).toContain('local head `932e23257`');
    expect(source).toContain(
      'synthetic clipped `switch` and\n  `menuitem` controls',
    );
    expect(source).toContain('`754c1dc51`');
    expect(source).toContain(
      'synthetic `combobox`, `radio`, `slider`, and\n  `spinbutton` controls',
    );
    expect(source).toContain('focusable `tabindex` elements');

    expect(source).toContain('public General viewport coverage checkpoint');
    expect(source).toContain('manual Browser\n  General/legal viewport sweep');
    expect(source).toContain('durable Playwright smoke coverage');
    expect(source).toContain('320x740');
    expect(source).toContain('390x844');
    expect(source).toContain('1440x900');
    expect(source).toMatch(
      /coverage\s+cannot silently shrink or gain a new anonymous General route while\s+keeping the mobile General-page requirement/u,
    );
    expect(source).toContain('per-route tenant seed to CI');
    expect(source).toContain(
      'stabilizationEvidence=public-general-viewport-spec-8cfe2965',
    );
    expect(source).toContain('fresh rebuilt-Docker in-app Browser pass');
    expect(source).toContain('`clientWidth=390`, `scrollWidth=390`');
    expect(source).toContain('`/404` mobile\n  screenshot');
    expect(source).toContain('tenant-missing legal-text message');
    expect(source).toContain('temporary Browser viewport override');
    expect(source).toContain('current pushed-head refresh at `17c35e732`');
    expect(source).toMatch(/generated `BASE_URL` on port 4577/u);
    expect(source).toContain(
      '/tmp/evorto-current-head-17c35e-general-mobile-events.jpg',
    );
    expect(source).toContain('PR head `19e5bb0bc`');
    expect(source).toContain('recovered from the existing port-4200 listener');
    expect(source).toContain('`bun run test:e2e:public-general-viewports`');
    expect(source).toContain('`/not-a-real-general-route-browser-refresh`');
    expect(source).toContain(
      'normalizing the implemented `/403` and `/500` headings',
    );
    expect(source).toContain('all 27 route/viewport checks');
    expect(source).toContain('zero Browser warning/error logs');
    expect(source).toContain(
      'first 320x740 `/events` screenshot caught a loading placeholder',
    );
    expect(source).toContain('replaced only after seeded event cards were');
    expect(source).toContain(
      '/tmp/evorto-pr62-19e5bb0-current-browser-events-320.png',
    );
    expect(source).toContain(
      '/tmp/evorto-pr62-19e5bb0-current-browser-terms-390.png',
    );
    expect(inventory).toContain('specs/smoke/public-general-viewports.spec.ts');
    expect(inventory).toContain('test:e2e:authenticated-viewports');
    expect(inventory).toContain('durable logged-in viewport pack');
    expect(inventory).toContain('scanner, and members-hub viewport specs');
    expect(inventory).toContain('test:e2e:public-general-viewports');
    expect(inventory).toMatch(/keeps? the route matrix on\s+one worker/u);
    expect(inventory).toContain('narrow mobile');
    expect(inventory).toContain('no horizontal overflow');
    expect(inventory).toContain(
      'no horizontally clipped\n    visible controls',
    );
    expect(inventory).toContain(
      'no overflowing visible text or panel elements',
    );
    expect(source).toContain('authenticated SSR deep-link checkpoint');
    expect(source).toContain('`src/app/app.routes.server.ts`');
    expect(source).toContain('`src/app/app.routes.server.spec.ts`');
    expect(source).toContain('production SSR deep links');
    expect(source).toContain(
      '`/admin/settings`, `/create-account`, and\n  `/global-admin/tenants`',
    );
    expect(source).toMatch(/A rebuilt\s+Docker app returned `200` app shells/u);
    expect(source).toContain('`/create-account`');
    expect(source).toContain('`/profile`');
    expect(source).toContain('`/templates`');
    expect(source).toContain('`/finance`');
    expect(source).toContain('`/scan`');
    expect(source).toContain('now reaches Auth0 login instead');
    expect(source).toContain('Playwright admin storage state');
    expect(source).toContain('Current create-account SSR refresh checkpoint');
    expect(source).toContain(
      'stabilizationEvidence=create-account-ssr-fixed-*',
    );
    expect(source).toContain('`/create-account`');
    expect(source).toContain('Auth0 authorize URL');
    expect(source).toContain(
      '/tmp/evorto-create-account-ssr-fixed-20260604-mobile.jpg',
    );
    expect(inventory).toContain('src/app/app.routes.server.spec.ts');
    expect(inventory).toContain('authenticated route groups');
    expect(inventory).toMatch(/public\s+server 404 shell/u);

    for (const clientRenderedServerRoute of [
      'admin/**',
      'create-account',
      'finance/**',
      'global-admin/**',
      'internal/**',
      'profile/**',
      'scan/**',
      'templates/**',
    ]) {
      expect(appServerRoutes).toContain(`path: '${clientRenderedServerRoute}'`);
      expect(appServerRoutesSpec).toContain(`'${clientRenderedServerRoute}'`);
    }

    expect(appServerRoutes).toContain('renderMode: RenderMode.Client');
    expect(appServerRoutes).toContain("path: '**'");
    expect(appServerRoutes).toContain('renderMode: RenderMode.Server');
    expect(appServerRoutesSpec).toContain(
      'keeps authenticated route groups client-rendered for production deep links',
    );
    expect(appServerRoutesSpec).toContain(
      'keeps public routes server-rendered by default',
    );
    expect(appServerRoutesSpec).toContain('toBe(RenderMode.Client)');
    expect(appServerRoutesSpec).toContain('toBe(RenderMode.Server)');

    const expectedPublicRouteCoverage = [
      "name: 'root redirect'",
      "path: '/'",
      "expectedText: 'Events'",
      "extraText: 'Soccer Match'",
      "name: 'events list'",
      "path: '/events'",
      "name: 'event detail'",
      'path: `/events/${freeOpenEvent.id}`',
      'expectedText: freeOpenEvent.title',
      "extraText: 'Log in now'",
      "name: 'imprint legal page'",
      "path: '/legal/imprint'",
      "expectedText: 'Imprint'",
      "extraText: 'No tenant-provided legal text is configured for this page.'",
      "name: 'privacy legal page'",
      "path: '/legal/privacy'",
      "expectedText: 'Privacy policy'",
      "name: 'terms legal page'",
      "path: '/legal/terms'",
      "expectedText: 'Terms'",
      "name: 'access not allowed page'",
      "path: '/403'",
      "expectedText: 'Access not allowed'",
      "extraText: 'Your account does not have permission to open this page.'",
      "name: 'server error page'",
      "path: '/500'",
      "expectedText: 'Something went wrong'",
      "extraText: 'Please try again later.'",
      "name: 'not found page'",
      "path: '/404'",
      "expectedText: 'Page not found'",
      "name: 'wildcard not found redirect'",
      "path: '/missing-general-page'",
      "expectedText: 'Page not found'",
      'for (const route of publicRoutes)',
      'await page.goto(route.path)',
      'name: route.expectedText',
      'page.getByText(route.extraText',
    ];

    for (const expectedPublicRouteFragment of expectedPublicRouteCoverage) {
      expect(viewportSpec).toContain(expectedPublicRouteFragment);
    }

    const expectedPublicRouteManifest = [
      {
        route: "path: '', pathMatch: 'full', redirectTo: 'events'",
        spec: "path: '/'",
      },
      { route: "path: 'events'", spec: "path: '/events'" },
      { route: "path: 'legal/imprint'", spec: "path: '/legal/imprint'" },
      { route: "path: 'legal/privacy'", spec: "path: '/legal/privacy'" },
      { route: "path: 'legal/terms'", spec: "path: '/legal/terms'" },
      { route: "path: '403'", spec: "path: '/403'" },
      { route: "path: '500'", spec: "path: '/500'" },
      { route: "path: '404'", spec: "path: '/404'" },
      {
        route: "path: '**', redirectTo: '404'",
        spec: "path: '/missing-general-page'",
      },
    ];

    for (const { route, spec } of expectedPublicRouteManifest) {
      expect(appRoutes).toContain(route);
      expect(viewportSpec).toContain(spec);
    }

    expect(appRoutes).toContain("path: 'create-account'");
    expect(appRoutes).toContain('canActivate: [authGuard]');
    expect(viewportSpec).not.toContain("path: '/create-account'");
    expect(createAccountTemplate).toContain('flex flex-wrap');
    expect(createAccountTemplate).toContain('justify-between gap-3');
    expect(createAccountTemplate).toContain('title-large min-w-0');
    expect(createAccountTemplate).toContain('class="shrink-0"');
    expect(appRoutesSpec).toContain(
      'keeps the anonymous public General route manifest aligned with viewport coverage',
    );
    expect(appRoutesSpec).toContain('publicGeneralPaths');
    expect(appRoutesSpec).toContain('viewportCoveredRootPaths');
    expect(appRoutesSpec).toContain('route.canActivate === undefined');
    expect(appRoutesSpec).toContain('toEqual([...publicGeneralPaths])');
    expect(appRoutesSpec).toContain("routeFor('events')?.canActivate");
    expect(appRoutesSpec).toContain('userAccountGuard');
    expect(appRoutesSpec).toContain("'legal/imprint'");
    expect(appRoutesSpec).toContain("'legal/privacy'");
    expect(appRoutesSpec).toContain("'legal/terms'");
    expect(appRoutesSpec).toContain("routeFor('403')?.canActivate");
    expect(appRoutesSpec).toContain("routeFor('500')?.canActivate");
    expect(appRoutesSpec).toContain("routeFor('404')?.canActivate");
    expect(appRoutesSpec).toContain("routeFor('')?.redirectTo");
    expect(appRoutesSpec).toContain("routeFor('**')?.redirectTo");
    expect(appRoutesSpec).toContain(
      'keeps public event browsing available while still checking assigned accounts for authenticated users',
    );
    expect(appRoutesSpec).toContain("toBe(':eventId')");
    expect(appRoutesSpec).toContain("':eventId/organize'");
    expect(appRoutesSpec).toContain("':eventId/edit'");
    expect(appRoutesSpec).toContain('toBeUndefined()');
    expect(appRoutesSpec).toContain('toBeDefined()');
    expect(source).toContain(
      '`/create-account` remains excluded from this public General sweep',
    );
    expect(source).toMatch(
      /create-account shell keeps its heading\/action row wrapping on\s+mobile/u,
    );
    expect(inventory).toMatch(
      /create-account shell keeps the heading and logout action wrapping\s+on mobile/u,
    );

    expect(source).toContain(
      'The source guard pins the exact\n  public route list',
    );
    expect(inventory).toContain('source guard pins the exact\n    public');
    expect(inventory).toContain('General route list');
    expect(source).toContain(
      'tenant-admin General settings viewport coverage checkpoint',
    );
    expect(source).toContain('horizontally clipped visible controls with');
    expect(source).toContain('actionable labels');
    expect(source).toContain('controls covered by another visible layer');
    expect(source).toContain('overflowing visible text or\n  panel elements');
    expect(source).toContain('authenticated in-app Browser pass');
    expect(source).toContain('current local head `5062964dc`');
    expect(source).toContain('opened `/admin/settings`');
    expect(source).toMatch(/explicit\s+320x740,\s+390x844,\s+and 1440x900/u);
    expect(source).toContain('20 Material form fields');
    expect(source).toContain('4\n  Material buttons');
    expect(source).toContain('1 Material slide toggle');
    expect(source).toContain('no Browser error logs');
    expect(source).toContain('390x844 screenshot');
    expect(source).toMatch(/Material controls fitting the viewport/u);
    expect(source).toMatch(/viewport override was reset/u);
    expect(source).toContain('current local head\n  `f7141ca02`');
    expect(source).toMatch(/still-running Docker app/u);
    expect(source).toMatch(
      /General settings, Deferred settings, and Tenant identity/u,
    );
    expect(source).toMatch(/existing authenticated session/u);
    expect(source).toMatch(/all three viewport checks\s+reported/u);
    expect(source).toMatch(/Material deferred-settings surface/u);
    expect(source).toMatch(/fixed mobile\s+bottom navigation fitting/u);
    expect(source).toContain(
      '/tmp/evorto-admin-settings-20260604-refresh-mobile.jpg',
    );
    expect(inventory).toContain('authenticated tenant\n    General settings');
    expect(inventory).toContain('no horizontally clipped visible controls');
    expect(inventory).toContain(
      'no overflowing\n    visible text or panel elements',
    );
    expect(source).toContain(
      'tenant-admin overview/tax/review viewport coverage checkpoint',
    );
    expect(source).toContain('`tests/specs/admin/admin-viewports.spec.ts`');
    expect(source).toContain('deterministic seeded tax-rate\n  row');
    expect(source).toContain("tax-rate table's horizontal scroll container");
    expect(source).toContain('4px mobile overflow');
    expect(source).toContain('Material icon-button touch-target spans');
    expect(source).toContain('no-pending-review content');
    expect(source).toContain(
      '/tmp/evorto-admin-overview-tax-review-20260604-refresh-mobile.jpg',
    );
    expect(inventory).toContain('specs/admin/admin-viewports.spec.ts');
    expect(inventory).toContain('authenticated tenant admin\n    overview');
    expect(adminViewportSpec).toContain(
      "test('tenant admin overview, tax, and review pages have stable layouts across viewports @admin @taxRates'",
    );
    expect(adminViewportSpec).toContain("path: '/admin'");
    expect(adminViewportSpec).toContain("path: '/admin/tax-rates'");
    expect(adminViewportSpec).toContain("path: '/admin/event-reviews'");
    expect(adminViewportSpec).toContain('tenantStripeTaxRates');
    expect(taxRatesSettingsComponent).toContain(
      'class="bg-surface max-w-full overflow-x-auto rounded-2xl"',
    );
    expect(eventReviewsComponent).toContain(
      'class="bg-surface text-on-surface flex min-w-0 flex-col gap-2 rounded-2xl p-4"',
    );
    expect(eventReviewsComponent).toContain(
      'class="lg:hidden! mx-1 block shrink-0"',
    );
    expect(eventReviewsComponent).toContain('class="mx-1 shrink-0"');
    expect(source).toContain('global-admin viewport coverage checkpoint');
    expect(source).toContain(
      'stabilizationEvidence=global-admin-viewport-coverage',
    );
    expect(source).toContain('Search tenants control');
    expect(source).toMatch(/reset temporary Browser\s+viewport override/u);
    expect(source).toContain('current local head\n  `35208bb6a`');
    expect(source).toMatch(/reopened `\/global-admin\/tenants`/u);
    expect(source).toMatch(/existing authenticated global-admin session/u);
    expect(source).toMatch(/Review tenant action/u);
    expect(source).toMatch(/tenant operational\s+details/u);
    expect(source).toMatch(/Create tenant floating action/u);
    expect(source).toMatch(/Material search field, tenant card/u);
    expect(source).toMatch(
      /floating create action, and\s+fixed mobile bottom navigation/u,
    );
    expect(source).toContain(
      '/tmp/evorto-global-admin-tenants-20260604-refresh-mobile.jpg',
    );
    expect(inventory).toContain('authenticated\n    global-admin tenant list');
    expect(inventory).toContain('global-admin tenant list, create, detail');
    expect(source).toContain('global-admin tenant list, create');
    expect(source).toContain('overflowing\n  visible text or panel elements');
    expect(inventory).toContain(
      'no overflowing visible text or panel elements',
    );
    expect(source).toContain(
      'authenticated profile viewport coverage checkpoint',
    );
    expect(source).toContain('overview, Events, Receipts, and Discounts');
    expect(inventory).toContain('specs/profile/user-profile-viewports.spec.ts');
    expect(inventory).toContain('authenticated profile\n    overview');
    expect(source).toContain(
      'authenticated template viewport coverage checkpoint',
    );
    expect(source).toContain(
      '`tests/specs/templates/template-viewports.spec.ts`',
    );
    expect(source).toContain('template-to-event create form content');
    expect(source).toMatch(
      /fixed\s+navigation now spans with `left-0 right-0`/u,
    );
    expect(source).toContain(
      'authenticated event viewport coverage checkpoint',
    );
    expect(source).toContain('`tests/specs/events/event-viewports.spec.ts`');
    expect(source).toContain(
      'authenticated finance viewport coverage checkpoint',
    );
    expect(source).toContain('`tests/specs/finance/finance-viewports.spec.ts`');
    expect(inventory).toContain('specs/templates/template-viewports.spec.ts');
    expect(inventory).toContain('authenticated template\n    list');
    expect(inventory).toContain('specs/events/event-viewports.spec.ts');
    expect(inventory).toContain('authenticated event list');
    expect(inventory).toContain('specs/finance/finance-viewports.spec.ts');
    expect(inventory).toContain('authenticated finance\n    overview');
    expect(adminSettingsSpec).toContain(
      "test('tenant admin general settings has stable layouts across viewports @admin'",
    );
    expect(adminSettingsSpec).toContain("await page.goto('/admin/settings')");
    expect(globalAdminSpec).toContain(
      "test('global tenant admin pages have stable layouts across viewports @admin @globalAdmin'",
    );
    expect(globalAdminSpec).toContain("path: '/global-admin/tenants'");
    expect(globalAdminSpec).toContain("path: '/global-admin/tenants/create'");
    expect(globalAdminSpec).toContain(
      'path: `/global-admin/tenants/${tenant.id}`',
    );
    expect(globalAdminSpec).toContain(
      'path: `/global-admin/tenants/${tenant.id}/edit`',
    );
    expect(viewportSpec).toContain(
      "test('public General pages have stable layouts across viewports'",
    );
    expect(viewportSpec).toContain("path: '/'");
    expect(viewportSpec).toContain("path: '/events'");
    expect(viewportSpec).toContain("name: 'event detail'");
    expect(viewportSpec).toContain('path: `/events/${freeOpenEvent.id}`');
    expect(viewportSpec).toContain("extraText: 'Log in now'");
    expect(viewportSpec).toContain("path: '/legal/imprint'");
    expect(viewportSpec).toContain("path: '/legal/privacy'");
    expect(viewportSpec).toContain("path: '/legal/terms'");
    expect(viewportSpec).toContain("path: '/403'");
    expect(viewportSpec).toContain("path: '/500'");
    expect(viewportSpec).toContain("path: '/404'");
    expect(viewportSpec).toContain("path: '/missing-general-page'");
    expect(inventory).toContain('general 403/404/500 pages');
    expect(source).toMatch(/explicit `\/404` route/u);
    expect(viewportSpec).toContain('test.setTimeout(120_000)');
    expect(viewportSpec).toContain('toBeVisible({ timeout: 15_000 })');
    expect(viewportSpec).not.toContain('test.describe');
    expect(viewportSpec).not.toMatch(
      /test\(`\$\{route\.name\} has stable \$\{viewport\.label\} layout`/u,
    );
    expect(profileViewportSpec).toContain(
      "test('profile sections have stable layouts across viewports @profile'",
    );
    expect(profileViewportSpec).toContain("await page.goto('/profile')");
    expect(profileViewportSpec).toContain('Edit profile');
    expect(profileViewportSpec).toContain('Your Event Registrations');
    expect(profileViewportSpec).toContain('Submitted receipts');
    expect(profileViewportSpec).toContain('Discount Cards');
    expect(templateViewportSpec).toContain(
      "test('template pages have stable layouts across viewports @templates'",
    );
    expect(templateViewportSpec).toContain("path: '/templates'");
    expect(templateViewportSpec).toContain("path: '/templates/create'");
    expect(templateViewportSpec).toContain("path: '/templates/categories'");
    expect(templateViewportSpec).toContain(
      'path: `/templates/create/${category.id}`',
    );
    expect(templateViewportSpec).toContain('path: `/templates/${template.id}`');
    expect(templateViewportSpec).toContain(
      'path: `/templates/${template.id}/edit`',
    );
    expect(templateViewportSpec).toContain(
      'path: `/templates/${template.id}/create-event`',
    );
    expect(templateViewportSpec).toContain('Simple Registration Setup');
    expect(templateViewportSpec).toContain('Template Categories');
    expect(templateViewportSpec).toContain("extraText: 'Create category'");
    expect(templateViewportSpec).toContain("extraText: 'Template Category'");
    expect(templateViewportSpec).toContain('Registration Options');
    expect(templateViewportSpec).toContain('Event Details');
    expect(source).toContain(
      'category manager, category-prefilled create form',
    );
    expect(source).toContain('stacked Material surface cards on mobile');
    expect(eventViewportSpec).toContain(
      "test('event pages have stable layouts across viewports @events'",
    );
    expect(eventViewportSpec).toContain("path: '/events'");
    expect(eventViewportSpec).toContain('path: `/events/${freeOpenEvent.id}`');
    expect(eventViewportSpec).toContain(
      'path: `/events/${draftEvent.id}/edit`',
    );
    expect(eventViewportSpec).toContain(
      'path: `/events/${freeOpenEvent.id}/organize`',
    );
    expect(eventViewportSpec).toContain('Registration');
    expect(eventViewportSpec).toContain('Event Details');
    expect(eventViewportSpec).toContain('Participants');
    expect(financeViewportSpec).toContain(
      "test('finance pages have stable layouts across viewports @finance'",
    );
    expect(financeViewportSpec).toContain("path: '/finance'");
    expect(financeViewportSpec).toContain("path: '/finance/transactions'");
    expect(financeViewportSpec).toContain("path: '/finance/receipts-approval'");
    expect(financeViewportSpec).toContain(
      'path: `/finance/receipts-approval/${pendingReceiptId}`',
    );
    expect(financeViewportSpec).toContain("path: '/finance/receipts-refunds'");
    expect(financeViewportSpec).toContain('Receipt reimbursements');
    expect(financeOverviewTemplate).toContain('class="min-w-0"');
    expect(receiptRefundTemplate).toContain(
      'class="bg-surface text-on-surface min-w-0 rounded-2xl p-4"',
    );
    expect(receiptRefundTemplate).toContain(
      'class="mt-3 max-w-full overflow-x-auto rounded-xl border border-outline-variant"',
    );
    expect(source).toContain(
      'authenticated role/user-management viewport coverage checkpoint',
    );
    expect(source).toContain('`tests/specs/admin/roles-viewports.spec.ts`');
    expect(source).toContain('read-only user-list, role-list');
    expect(inventory).toContain('specs/admin/roles-viewports.spec.ts');
    expect(inventory).toContain('role/user management viewport coverage');
    expect(adminRolesViewportSpec).toContain(
      "test('tenant admin role pages have stable layouts across viewports @admin @permissions'",
    );
    expect(adminRolesViewportSpec).toContain("path: '/admin/users'");
    expect(adminRolesViewportSpec).toContain("path: '/admin/roles'");
    expect(adminRolesViewportSpec).toContain("path: '/admin/roles/create'");
    expect(adminRolesViewportSpec).toContain('path: `/admin/roles/${role.id}`');
    expect(adminRolesViewportSpec).toContain(
      'path: `/admin/roles/${role.id}/edit`',
    );
    expect(adminOverviewTemplate).toContain(
      'grid min-w-0 grid-cols-1 lg:grid-cols-[300px_1fr]',
    );
    expect(userListTemplate).toContain(
      'max-w-full min-w-0 overflow-x-auto overflow-y-hidden',
    );
    expect(roleFormTemplate).toContain(
      'grid min-w-0 grid-cols-1 gap-2 sm:gap-4 lg:col-span-2 lg:grid-cols-4',
    );
    expect(templateListTemplate).toContain(
      'class="title-large min-w-0 break-words"',
    );
    expect(templateListTemplate).toContain('class="min-w-0 break-words"');
    expect(templateListTemplate).toContain(
      'max-h-[calc(100dvh-13rem)] overflow-y-auto pr-1 lg:h-full lg:max-h-none lg:overflow-y-auto lg:py-4 lg:pr-4',
    );
    expect(navigationTemplate).toContain('fixed bottom-0 left-0 right-0');
    expect(navigationTemplate).not.toContain('w-screen');
    expect(source).toContain(
      'authenticated scanner viewport coverage checkpoint',
    );
    expect(source).toContain(
      '`tests/specs/scanning/scanner-viewports.spec.ts`',
    );
    expect(source).toContain('seeded `/scan/registration/:registrationId`');
    expect(inventory).toContain('specs/scanning/scanner-viewports.spec.ts');
    expect(inventory).toContain(
      'authenticated scanner\n    camera/fallback page',
    );
    expect(scannerViewportSpec).toContain(
      "test('scanner pages have stable layouts across viewports @scanning'",
    );
    expect(scannerViewportSpec).toContain("path: '/scan'");
    expect(scannerViewportSpec).toContain(
      'path: `/scan/registration/${registrationId}`',
    );
    expect(scannerViewportSpec).toContain('eventRegistrations');
    expect(scannerTemplate).toContain(
      'class="aspect-video max-h-[70vh] w-full rounded bg-surface-container object-cover"',
    );
    expect(handleRegistrationTemplate).toContain(
      'class="bg-surface text-on-surface flex min-w-0 flex-col gap-2 rounded-2xl"',
    );
    expect(handleRegistrationTemplate).toContain(
      'bg-error-container text-on-error-container',
    );
    expect(source).toContain(
      'authenticated members-hub viewport coverage checkpoint',
    );
    expect(source).toContain(
      '`tests/specs/internal/members-hub-viewports.spec.ts`',
    );
    expect(source).toContain('deterministic visible hub role');
    expect(inventory).toContain('specs/internal/members-hub-viewports.spec.ts');
    expect(inventory).toContain(
      '- specs/internal/members-hub-viewports.spec.ts',
    );
    expect(inventory).toContain(
      'authenticated\n    members hub role directory',
    );
    expect(membersHubViewportSpec).toContain(
      "test('members hub has stable layouts across viewports @internal'",
    );
    expect(membersHubViewportSpec).toContain(
      "await page.goto('/internal/members-hub')",
    );
    expect(membersHubViewportSpec).toContain('rolesToTenantUsers');
    expect(membersHubTemplate).toContain(
      'class="bg-surface text-on-surface @container min-w-0 rounded-lg p-2"',
    );
    expect(membersHubTemplate).toContain('class="min-w-0 break-words"');
    expect(membersHubComponent).toContain("class: 'flex min-w-0 flex-col p-4'");
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

    const roleDetailsTemplate = readSource(
      'src/app/admin/role-details/role-details.component.html',
    );
    const roleDetailsComponent = readSource(
      'src/app/admin/role-details/role-details.component.ts',
    );
    const roleDetailsSpec = readSource(
      'src/app/admin/role-details/role-details.component.spec.ts',
    );

    expect(roleDetailsTemplate).toContain('roleQuery.isSuccess()');
    expect(roleDetailsTemplate).toContain(
      "[routerLink]=\"['/admin/roles', roleQuery.data().id, 'edit']\"",
    );
    expect(roleDetailsTemplate).not.toContain('roleQuery.data()?.id');
    expect(roleDetailsComponent).toContain('roleHasPermission');
    expect(roleDetailsComponent).not.toContain(
      'this.roleQuery.data()?.permissions.includes',
    );
    expect(roleDetailsSpec).toContain(
      'checks permissions from a loaded role without reading query state',
    );
  });
});
