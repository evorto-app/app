import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source guard: generated documentation is product-facing, so these checks keep
// the docs tied to implemented flows instead of stale aspirational copy.
const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(nodePath.join(repositoryRoot, path), 'utf8');

const findFiles = (path: string): string[] => {
  const absolutePath = nodePath.join(repositoryRoot, path);

  return readdirSync(absolutePath).flatMap((entry) => {
    const entryPath = nodePath.join(path, entry);
    const absoluteEntryPath = nodePath.join(repositoryRoot, entryPath);

    return statSync(absoluteEntryPath).isDirectory()
      ? findFiles(entryPath)
      : [entryPath];
  });
};

const findWeakScreenshotCaptions = (path: string, source: string): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const weakCaptions: string[] = [];

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getCaptionText = (node: ts.Expression): null | string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.trim();
    }

    return null;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      const caption = node.arguments[3];
      const captionText = caption ? getCaptionText(caption) : null;

      if (!captionText || captionText.length < 24) {
        weakCaptions.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return weakCaptions;
};

describe('generated docs source current behavior', () => {
  it('keeps generated documentation pages explanatory and image-backed', () => {
    const documentFiles = findFiles('tests/docs')
      .filter((path) => path.endsWith('.doc.ts'))
      .toSorted();
    const textOnlyReferenceDocuments = new Set([
      'tests/docs/roles/about-permissions.doc.ts',
    ]);
    const screenshotHelper = readSource(
      'tests/support/reporters/documentation-reporter/take-screenshot.ts',
    );

    expect(documentFiles.length).toBe(15);
    expect(screenshotHelper).toContain("htmlElement.style.outline = 'thick");
    expect(screenshotHelper).toContain('caption: string');
    expect(screenshotHelper).toContain('caption.trim().length < 24');
    expect(screenshotHelper).toContain(
      'Documentation screenshots require a descriptive caption',
    );
    expect(screenshotHelper).toContain("testInfo.attach('image'");
    expect(screenshotHelper).toContain("testInfo.attach('image-caption'");

    for (const path of documentFiles) {
      const source = readSource(path);
      const markdownBodies = source.match(/body:\s*`[\s\S]*?`/gu) ?? [];
      const markdownTextLength = markdownBodies
        .map((body) =>
          body
            .replaceAll('`', '')
            .replaceAll(/\$\{[\s\S]*?\}/gu, '')
            .replaceAll(/\s+/gu, ' ')
            .trim(),
        )
        .join(' ').length;

      expect(source, path).toContain("testInfo.attach('markdown'");
      expect(markdownTextLength, path).toBeGreaterThanOrEqual(120);

      if (textOnlyReferenceDocuments.has(path)) {
        expect(source, path).toContain('PERMISSION_GROUPS');
        expect(source, path).toContain('permissionLines');
        expect(source, path).not.toContain('takeScreenshot(');
        continue;
      }

      expect(source, path).toContain('takeScreenshot(');
      expect(source, path).not.toContain('page.screenshot(');
      expect(findWeakScreenshotCaptions(path, source), path).toEqual([]);
    }
  });

  it('keeps generated documentation publishing explicit in package scripts', () => {
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const localDocumentationScripts = [
      'test:e2e:docs',
      'test:e2e:integration',
      'test:e2e:create-account',
    ];

    for (const scriptName of localDocumentationScripts) {
      const script = scripts[scriptName];

      expect(script, scriptName).toContain('DOCS_OUT_DIR=test-results/docs');
      expect(script, scriptName).toContain(
        'DOCS_IMG_OUT_DIR=test-results/docs/images',
      );
      expect(script, scriptName).not.toContain(
        '/Users/hedde/code/evorto-pages',
      );
    }

    expect(scripts['test:e2e:docs:publish']).toContain(
      'DOCS_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(scripts['test:e2e:docs:publish']).toContain(
      'DOCS_IMG_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/public/docs',
    );
    expect(scripts['test:e2e:docs:publish']).toContain(
      'playwright test --project=docs-baseline',
    );
  });

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
      '**Email sender name** for tenant email notification display names.',
    );
    expect(source).toContain('participant registration limits');
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
    expect(source).not.toContain(
      'Stripe account management is configured here',
    );
  });

  it('does not generate product docs for global-admin functionality', () => {
    const inventorySource = readSource('tests/test-inventory.md');
    const documentFiles = findFiles('tests/docs');
    const generatedDocumentSources = documentFiles
      .map((path) => [path, readSource(path)] as const)
      .filter(([path]) => path.endsWith('.doc.ts'));

    expect(
      existsSync(
        nodePath.join(repositoryRoot, 'tests/docs/admin/global-admin.doc.ts'),
      ),
    ).toBe(false);
    expect(
      existsSync(
        nodePath.join(
          repositoryRoot,
          'tests/docs/events/unlisted-admin.doc.ts',
        ),
      ),
    ).toBe(false);
    expect(inventorySource).not.toContain('docs/admin/global-admin.doc.ts');
    expect(inventorySource).not.toContain('docs/events/unlisted-admin.doc.ts');
    expect(documentFiles).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/global-admin|globalAdmin/i),
      ]),
    );
    for (const [path, source] of generatedDocumentSources) {
      expect(source, path).not.toContain('/global-admin');
      expect(source, path).not.toMatch(/global-admin|global admin/i);
    }
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

  it('keeps finance receipt docs aligned with queued notification and manual reimbursement scope', () => {
    const overviewSource = readSource(
      'tests/docs/finance/finance-overview.doc.ts',
    );
    const receiptSource = readSource(
      'tests/docs/finance/receipt-review-reimbursement.doc.ts',
    );
    const combinedSource = `${overviewSource}\n${receiptSource}`;

    expect(combinedSource).toContain(
      'queues the submitter email notification for delivery',
    );
    expect(combinedSource).toContain('queues a submitter email after saving');
    expect(combinedSource).toContain(
      'Recording a reimbursement creates the Evorto finance transaction only.',
    );
    expect(combinedSource).toContain(
      'Transfer the money manually through the selected payout method.',
    );
    expect(combinedSource).toContain(
      'actual money movement remains a manual finance operation',
    );
    expect(combinedSource).toContain('queues the submitter email for delivery');
    expect(receiptSource).toContain(
      'Expected generated receipt review docs receipt',
    );
    expect(receiptSource).toContain(
      "page.getByRole('link', { name: receiptFileName })",
    );
    expect(receiptSource).toContain('return approvedReceipt?.status');
    expect(receiptSource).toContain('filter({ hasText: receiptFileName })');
    expect(receiptSource).toContain('refundTransactionId: expect.any(String)');
    expect(receiptSource).toContain("status: 'refunded'");
    expect(receiptSource).toContain('.delete(schema.transactions)');
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
      'standalone before-event and during-event add-on sales are handled separately from this template setup flow',
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
      'Paid registration transfer or direct resale now starts with a transfer link/code. The replacement participant can start a Stripe Checkout registration from the link; after checkout succeeds, Evorto cancels the original registration and handles the source refund path. Public resale listings are outside the relaunch scope.',
    );
    expect(source).toContain('Review paid transfer/direct-resale state');
    expect(source).toContain(
      'Create a 24-hour transfer link and code for this paid registration. Share it with the replacement participant for direct transfer or resale; after replacement checkout succeeds, Evorto cancels this registration and handles the source refund path.',
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Create transfer link' })",
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Transfer registration' })",
    );
    expect(source).toContain(
      'Expected registration docs paid transfer state to persist the registration',
    );
    expect(source).toContain('Paid transfer code');
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
    expect(source).toContain('replayCheckoutCompletedWebhook');
    expect(source).toContain(
      'Timed out waiting for replayed Stripe checkout webhook to be mirrored in the application database',
    );
    expect(source).not.toContain("getByTestId('hosted-payment-submit-button')");
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
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).not.toContain(
      'Resale listing workflows are not available yet.',
    );
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
    expect(source).toContain('final **Published** state');
    expect(source).toContain('Published event status');
    expect(source).not.toContain('final published state');
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).not.toContain(
      'Approval Flow ${seedDate.toISOString().slice(0, 10)}',
    );
  });

  it('keeps event-management docs aligned with scanner and organizer scope', () => {
    const source = readSource('tests/docs/events/event-management.doc.ts');

    expect(source).toContain(
      'The event management feature allows you to create and edit events, configure registration options, review listing state, inspect the organizer participant overview, and handle event receipts.',
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
      'Paid registrations stay unavailable for direct organizer-assisted transfer and use participant-created transfer codes for replacement checkout and source refund handling.',
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
    expect(source).not.toContain('managing attendees');
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
    expect(permissionsSource).toContain('PERMISSION_GROUPS');
    expect(permissionsSource).toContain('PERMISSION_DEPENDENCIES');
    expect(permissionsSource).not.toMatch(/global-admin|global admin/i);
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
