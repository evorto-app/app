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
    expect(source).toContain(
      '**Currency**, **Locale**, and **Timezone** selection within the supported relaunch policy.',
    );
    expect(source).toContain(
      '**SEO title** and **SEO description** for tenant-level page metadata.',
    );
    expect(source).toContain(
      'A **Deferred settings** summary that keeps custom-domain automation visible as a deferred scope item.',
    );
    expect(source).toContain(
      '**Operations settings** for tenant email reply-to name/email, Stripe account id, and the tenant-wide active registration limit.',
    );
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
      'Currency, locale, and timezone changes are only accepted before event or payment data exists for the tenant.',
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
      'Tenant create/edit manages the one active primary domain, name, theme, locale, currency, timezone, and connected Stripe account id.',
    );
    expect(source).toContain(
      'Transactional links and Stripe return URLs use the secure HTTPS origin derived from this normalized domain rather than request headers.',
    );
    expect(source).toContain(
      'The generated journey creates a temporary tenant, reads the created row back from the database, saves a tenant-name edit on that temporary tenant, verifies the saved row, and cleans it up after the doc run.',
    );
    expect(source).toContain(
      'custom-domain verification and multi-domain automation are deferred',
    );
    expect(source).toContain(
      'tenant-admin impersonation is not available in the current relaunch surface',
    );
    expect(source).not.toContain('impersonation workflow');
    expect(source).not.toContain('multiple active domains');
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
    expect(source).toContain('18.75 €');
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
      'It stays disabled while invalid, already submitting, or waiting for the account-creation mutation',
    );
    expect(source).toContain(
      'Existing global users with the same Auth0 id join the current tenant instead of creating a duplicate global user.',
    );
    expect(source).toContain(
      'If account creation fails, the page shows a retryable server error instead of silently losing the submit attempt.',
    );
    expect(source).not.toContain('login email as your notification email');
    expect(source).not.toContain('tenant-specific notification email');
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
      'Recording reimbursement updates the receipt to **refunded** and creates a successful manual refund transaction in Evorto.',
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

  it('keeps template docs aligned with the simple-mode relaunch surface', () => {
    const source = readSource('tests/docs/templates/templates.doc.ts');

    expect(source).toContain(
      'Simple mode intentionally keeps exactly one organizer registration block and one participant registration block.',
    );
    expect(source).toContain(
      'Use reusable add-ons, registration questions, option descriptions, role eligibility, and organizer planning tips to capture repeatable event knowledge',
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
      'Add-ons can be free or paid, attached to either the participant or organizer registration option',
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
    expect(source).toContain('createdTemplate.planningTips');
    expect(source).toContain('addonToTemplateRegistrationOptions');
    expect(source).toContain('templateRegistrationQuestions.findFirst');
    expect(source).toContain(
      'Expected template docs flow to persist the reusable add-on',
    );
    expect(source).not.toContain('bulk registration options');
    expect(source).not.toContain('multiple participant registration blocks');
    expect(source).not.toContain('public event planning tips');
    expect(source).not.toContain('roles can be selected more than once');
    expect(source).not.toContain(
      'ESNcard pricing is configured on events only',
    );
    expect(source).not.toContain('standalone add-on sales are configured here');
    expect(source).not.toContain('Purchase timing');
    expect(source).not.toContain(
      'standalone before-event and during-event add-on sales',
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

  it('keeps registration docs aligned with unavailable states and transfer scope', () => {
    const source = readSource('tests/docs/events/register.doc.ts');

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
    expect(source).toContain(
      'Confirmed unpaid registrations can be transferred from the event page before check-in and before the event starts.',
    );
    expect(source).toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).toContain('Review paid transfer unavailable state');
    expect(source).toContain(
      'Self-service transfer is only available for unpaid, not-yet-checked-in registrations before the event starts. Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Transfer unavailable' })",
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Transfer registration' })",
    );
    expect(source).toContain(
      'Expected registration docs paid transfer state to persist the registration',
    );
    expect(source).toContain('Paid transfer unavailable');
    expect(source).toContain(
      'QR email delivery is not part of the current relaunch flow.',
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

  it('keeps event approval docs backed by deterministic lifecycle persistence checks', () => {
    const source = readSource('tests/docs/events/event-approval.doc.ts');

    expect(source).toContain('Approval Flow ${seedDate.getTime()}');
    expect(source).toContain('Expected generated approval docs event to exist');
    expect(source).toContain(
      "expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW')",
    );
    expect(source).toContain("expect(rejectedEvent.status).toBe('REJECTED')");
    expect(source).toContain(
      'expect(rejectedEvent.statusComment).toBe(rejectionComment)',
    );
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
      'Expected seeded draft event for event-management role autocomplete docs',
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
