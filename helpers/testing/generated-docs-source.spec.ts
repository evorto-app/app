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
    expect(source).toContain('.update(schema.tenants)');
    expect(source).toContain(
      'The generated journey below changes all seven fields and the uploaded brand assets on its disposable tenant, saves them, checks the stored tenant row, reloads the page, and checks that the same values are read back.',
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
      'hosted text appears at \\`/legal/imprint\\`, \\`/legal/privacy\\`, and \\`/legal/terms\\`',
    );
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
    expect(source).toContain(
      'page.getByLabel(tenantSearchLabel).fill(primaryDomain)',
    );
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
    expect(source).toContain('documentedIban');
    expect(source).toContain('documentedPaypalEmail');
    expect(source).toContain("getByRole('textbox', { name: 'IBAN' })");
    expect(source).toContain("getByRole('textbox', { name: 'PayPal email' })");
    expect(source).toContain('updatedProfileUser.iban).toBe(documentedIban)');
    expect(source).toContain(
      'updatedProfileUser.paypalEmail).toBe(documentedPaypalEmail)',
    );
    expect(source).toContain(
      'Profile event cards point pending checkout registrations at the implemented profile action, route ticket/cancellation/unpaid-transfer details back to the event page, expose waitlist routing back to the event page, and stop advertising cancellation or transfer once a registration is checked in',
    );
    expect(source).toContain(
      'Continue payment from this card, or open the event page for registration details.',
    );
    expect(source).toContain(
      'Open the event page for waitlist details and the leave-waitlist action.',
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
      'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.',
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
    const paidTransferScenarioSource = readSource(
      'tests/support/utils/paid-registration-transfer-scenario.ts',
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
    expect(source).toContain('## Buy add-ons after registration');
    expect(source).toContain('seedPostRegistrationAddonPurchaseScenario');
    expect(source).toContain('This add-on is not sold before the event.');
    expect(source).toContain('This add-on is not sold during the event.');
    expect(source).toContain('Payment is pending');
    expect(source).toContain('Continue Stripe checkout');
    expect(source).toContain('await scenario.beginPaidCheckout(2)');
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
    expect(transferSource).toContain(
      'The transfer link and manual code are bearer credentials.',
    );
    expect(transferSource).toContain('current role eligibility');
    expect(transferSource).toContain(
      'The source registration stays confirmed while the offer is open.',
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
      'must use the recovery action to requeue the existing refund',
    );
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
      "test('Complete a paid transfer and recover its source refund'",
    );
    expect(transferSource).toContain('seedPaidRegistrationTransferScenario');
    expect(transferSource).toContain('await scenario.completeCheckout()');
    expect(transferSource).toContain('await scenario.failSourceRefund()');
    expect(transferSource).toContain('await scenario.requeueSourceRefund()');
    expect(transferSource).toContain("name: 'Payment still required'");
    expect(transferSource).toContain(
      "name: 'Transfer complete — refund processing'",
    );
    expect(transferSource).toContain(
      "name: 'Transfer complete — refund needs attention'",
    );
    expect(transferSource).toContain(
      "expect(recipientRegistration).toEqual({ status: 'CONFIRMED' })",
    );
    expect(transferSource).toContain(
      "expect(sourceRegistration).toEqual({ status: 'CANCELLED' })",
    );
    expect(paidTransferScenarioSource).toContain('isPaid: true');
    expect(paidTransferScenarioSource).toContain(
      'completePaidRegistrationCheckout(',
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
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).toContain(
      'Evorto also queues a confirmation email with a link back to this authenticated ticket page.',
    );
    expect(source).toContain('seedRequiredRegistrationQuestion');
    expect(source).toContain(
      'Free registration cards can also offer registration-time add-ons and required questions.',
    );
    expect(source).toContain(
      'Question answers are stored with the registration for organizers.',
    );
    expect(source).toContain(
      'participantRegistrationCard.getByLabel(registrationQuestion.title)',
    );
    expect(source).toContain('registration.questionAnswers');
    expect(source).toContain(
      'If that option asks required registration questions, participants must answer them before joining the waitlist.',
    );
    expect(source).toContain('waitlistRegistration.questionAnswers');
    expect(source).toContain(
      'Participants can leave the waitlist before the event starts, which cancels the waitlist registration and releases the waitlist position.',
    );
    expect(source).toContain('fullOptionAfterLeaving.waitlistSpots');
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain('ticket QR code by email');
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
    expect(source).toContain('fillTestCard(checkoutPage)');
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
      "page.getByRole('button', { name: 'Confirm 3 check-ins' })",
    );
    expect(source).toContain('Scanned registration with guest check-in');
    expect(source).toContain("page.getByText('Check-in recorded')");
    expect(source).toContain('checkedInGuestCount: true');
    expect(source).toContain('checkedInSpots: initialCheckedInSpots + 3');
    expect(source).toContain('.update(eventRegistrationOptions)');
    expect(source).toContain('.set({ checkedInSpots: initialCheckedInSpots })');
    expect(source).toContain(
      "Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot and submits a Stripe refund when the paid registration has a stored Stripe payment reference.",
    );
    expect(source).toContain(
      'Older or manually seeded payment records still create a pending manual refund record for organizer follow-up.',
    );
    expect(source).toContain(
      'Paid registration transfer shows as unavailable in the organizer overview until the resale money flow is handled.',
    );
    expect(source).toContain(
      'It does not currently include attendee export, attendee messaging, manual check-in controls outside QR scanning',
    );
    expect(source).toContain(
      'Role picker behavior: already selected roles are hidden from suggestions to avoid duplicate eligibility entries.',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have selected registration roles',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have an unselected role for autocomplete',
    );
    expect(source).toContain("page.getByPlaceholder('Add Role...')");
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
