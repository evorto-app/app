import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(join(repositoryRoot, path), 'utf8');

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
      'custom-domain automation, email sender, review policy, registration limit, and Stripe account management gaps',
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
      'When currency, locale, or timezone changes, Evorto reloads the app after saving',
    );
    expect(source).not.toContain('Tax rates are configured here');
    expect(source).not.toContain(
      'Stripe account management is configured here',
    );
  });

  it('keeps global-admin docs aligned with the relaunch tenant-administration scope', () => {
    const source = readSource('tests/docs/admin/global-admin.doc.ts');

    expect(source).toContain('expectGlobalAdminTenantRows');
    expect(source).toContain('expectGlobalAdminTenantFormSurface');
    expect(source).toContain('Search tenants');
    expect(source).toContain('No tenants match this search');
    expect(source).toContain('Read-only operational tenant review');
    expect(source).toContain('Open tenant domain');
    expect(source).toContain('Stripe account ID');
    expect(source).toContain(
      'Tenant create/edit manages the one active primary domain, name, theme, locale, currency, timezone, and connected Stripe account id.',
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

  it('keeps finance receipt docs aligned with manual notification and reimbursement scope', () => {
    const overviewSource = readSource(
      'tests/docs/finance/finance-overview.doc.ts',
    );
    const receiptSource = readSource(
      'tests/docs/finance/receipt-review-reimbursement.doc.ts',
    );
    const combinedSource = `${overviewSource}\n${receiptSource}`;

    expect(combinedSource).toContain(
      'Submitter email notification is still manual in the current relaunch scope.',
    );
    expect(combinedSource).toContain(
      'Notify the submitter manually after saving.',
    );
    expect(combinedSource).toContain(
      'Recording a reimbursement creates the Evorto finance transaction only.',
    );
    expect(combinedSource).toContain(
      'Transfer the money manually through the selected payout method.',
    );
    expect(combinedSource).toContain(
      'actual money movement remains a manual finance operation',
    );
    expect(combinedSource).toContain(
      'it does not send an automatic submitter email yet',
    );
    expect(combinedSource).not.toContain('sends an automatic submitter email');
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
      "throw new Error('Expected seeded roles for template docs autocomplete')",
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
      'standalone before-event and during-event add-on sales are handled separately from this template setup flow',
    );
    expect(source).toContain(
      'Questions can include help text and can be marked as required.',
    );
    expect(source).toContain(
      'Event-side answer collection is handled separately from this template setup flow.',
    );
    expect(source).not.toContain('bulk registration options');
    expect(source).not.toContain('multiple participant registration blocks');
    expect(source).not.toContain('public event planning tips');
    expect(source).not.toContain('roles can be selected more than once');
    expect(source).not.toContain(
      'ESNcard pricing is configured on events only',
    );
    expect(source).not.toContain('standalone add-on sales are configured here');
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
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain('ticket QR code by email');
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
      "Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot without promising an automatic refund.",
    );
    expect(source).toContain(
      'Paid registration transfer still remains blocked until the manual refund or resale money flow is handled.',
    );
    expect(source).toContain(
      'It does not currently include attendee export, attendee messaging, manual check-in controls outside QR scanning',
    );
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
    expect(source).toContain('ESNcard validation provider is unavailable');
    expect(source).not.toContain('provider outages mark the card invalid');
    expect(source).not.toContain('overlap ESNcard writes');
    expect(source).not.toContain('stores the card number without trimming');
  });
});
