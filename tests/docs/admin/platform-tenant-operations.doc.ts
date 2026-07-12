import { and, eq } from 'drizzle-orm';

import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

const platformScannerStatusGuidance = [
  {
    body: 'This ticket is not confirmed yet and cannot be checked in. Ask the attendee to open the event or Profile to see whether organizer approval or their existing Stripe Checkout is still needed. Do not start a second registration or payment from the scanner.',
    status: 'PENDING',
    title: 'Registration pending',
  },
  {
    body: 'This attendee does not have a confirmed spot yet and cannot be checked in. Review the waitlist and capacity. Do not take payment or create another registration from the scanner.',
    status: 'WAITLIST',
    title: 'Registration on waitlist',
  },
  {
    body: 'This ticket was cancelled and cannot be checked in. Do not ask the attendee to pay or register again. If the cancellation or refund looks wrong, review the existing registration and refund instead of creating a replacement.',
    status: 'CANCELLED',
    title: 'Registration cancelled',
  },
] as const;

test.use({ storageState: gaStateFile });

test('Review target-scoped platform operations', async ({
  database,
  events,
  page,
  registerDatabaseCleanup,
  registrations,
  templates,
  tenant,
}, testInfo) => {
  test.slow();

  const registration =
    registrations.find((candidate) => candidate.status === 'CONFIRMED') ??
    registrations[0];
  if (!registration) {
    throw new Error(
      'Expected a seeded registration for platform documentation',
    );
  }
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .update(schema.eventRegistrations)
      .set({ status: registration.status })
      .where(
        and(
          eq(schema.eventRegistrations.id, registration.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
  });
  const documentedEvent = events[0];
  const documentedTemplate = templates[0];
  if (!documentedEvent || !documentedTemplate) {
    throw new Error(
      'Expected seeded event and template content for platform documentation',
    );
  }

  await page.goto('/global-admin');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Platform administration',
    }),
  ).toBeVisible();
  await page.getByRole('link', { exact: true, name: 'Tenants' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants$/u);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tenants' }),
  ).toBeVisible();
  await page.getByLabel('Search tenants').fill(tenant.domain);
  const tenantRow = page
    .locator('app-tenant-list > div')
    .filter({ hasText: tenant.domain });
  await expect(tenantRow).toBeVisible();
  await tenantRow
    .getByRole('link', { exact: true, name: 'Review tenant' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}$`),
  );
  await expect(
    page.getByRole('navigation', { name: 'Target tenant operations' }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
### Target-scoped platform operations

Platform administrators are Auth0-backed platform principals, not tenant users. Open **Platform administration**, select **Tenants**, find the target tenant, and choose **Review tenant**. Continue through the dedicated operation links on that tenant review. The selected tenant is sent explicitly with every request; the platform session never inherits or merges tenant-role permissions.

Available surfaces cover attributed event creation and lifecycle review, full event and template graph editing, registration approval/cancellation/check-in, existing-user role assignment, tenant roles, finance and refund recovery, and Stripe tax rates. Every mutation asks for an operational reason and writes the platform actor, target tenant, action, timestamp, and PII-free before/after state in the same transaction. Receipt review and reimbursement render and record each receipt's stored currency; a later tenant default cannot reinterpret those amounts or combine different currencies in one reimbursement batch.

First-come-first-served and manual approval are the supported registration modes. Legacy random-allocation records remain readable, but random is not writable: a legacy template is blocked with an explicit unsupported-mode message, and a legacy event must have every random option replaced with a supported mode before it can be saved.

Participant profile and home views, joining or leaving a tenant, personal receipt submission, and self-service transfer or resale remain participant-owned workflows.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Choose a target-tenant operation',
  );

  await page.getByRole('link', { exact: true, name: 'Manage events' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/events$`),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create event' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/events/new`);
  await expect(
    page.getByText('Loading events...', { exact: true }),
  ).toHaveCount(0, { timeout: 20_000 });
  const eventList = page.getByRole('region', {
    name: 'Target-tenant events',
  });
  await expect(eventList).toBeVisible();
  await expect(
    eventList.getByText(documentedEvent.title, { exact: true }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-events'),
    page,
    'Target-tenant event lifecycle',
  );

  await testInfo.attach('markdown', {
    body: `
### Edit the complete event graph

Open a draft event to edit its core schedule together with every registration-option field, role restriction, cancellation and transfer policy, price, inclusive tax rate, ESNcard discount, add-on mapping, and registration question. Existing registration-option identities and live counters are preserved. Add-ons with purchases and questions with answers cannot be removed.

The target tenant is checked on every read and write. Role references are validated while holding the shared tenant role-graph lock, and the event update plus its PII-free before/after audit entry commit atomically.
`,
  });

  await page.getByRole('link', { name: 'Back to tenant' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Target tenant operations' }),
  ).toBeVisible();
  await page
    .getByRole('link', { exact: true, name: 'Manage templates' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/templates$`),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Event templates' }),
  ).toBeVisible();
  await expect(
    page.getByText('Loading templates...', { exact: true }),
  ).toHaveCount(0, { timeout: 20_000 });
  const templateList = page.getByRole('region', {
    name: 'Target-tenant templates',
  });
  await expect(templateList).toBeVisible();
  await expect(
    templateList.getByText(documentedTemplate.title, { exact: true }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-templates'),
    page,
    'Target-tenant event templates',
  );

  await page.getByRole('link', { name: 'Back to tenant' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Target tenant operations' }),
  ).toBeVisible();
  await page.getByRole('link', { exact: true, name: 'Review finance' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/finance$`),
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tenant finance' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Refund recovery' }).click();
  await expect(
    page.getByText(
      'Only terminal Stripe refunds and stopped, unleased refund processing appear here.',
      { exact: false },
    ),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
### Recover a refund without duplicating it

Open **Review finance** and select **Refund recovery**. The queue excludes scheduled, leased, ambiguous, and successful refunds. A terminal Stripe refund schedules a new generation with a new generation-specific idempotency key; stopped processing resumes the existing durable claim and generation. Review the registration, source transaction, transfer state when present, and prior error before entering the required operational reason.

The recovery write updates any linked transfer and appends the platform audit entry in the same transaction. A participant whose transfer already completed must not pay or claim again while finance recovers the source refund.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-finance'),
    page,
    'Review refunds eligible for manual recovery',
  );

  await page.getByRole('link', { name: 'Back to tenant' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Target tenant operations' }),
  ).toBeVisible();
  await page
    .getByRole('link', { exact: true, name: 'Inspect registrations' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/global-admin/tenants/${tenant.id}/scanner$`),
  );
  const lookupInput = page.getByLabel('Registration ID or result URL');
  await expect(lookupInput).toBeEnabled();
  await lookupInput.fill(
    `http://localhost:4200/scan/registration/${registration.id}`,
  );
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/global-admin/tenants/${tenant.id}/scanner/${registration.id}$`,
    ),
  );
  await expect(page.getByText(registration.id, { exact: true })).toBeVisible();
  const inspection = page.locator('app-platform-scanner');
  const registrationDetail = inspection.locator('section').filter({
    has: page.getByRole('heading', {
      exact: true,
      level: 3,
      name: 'Platform registration actions',
    }),
  });
  await expect(
    inspection.getByRole('heading', {
      level: 1,
      name: 'Registration inspection',
    }),
  ).toBeVisible();
  await expect(
    registrationDetail.getByText(registration.status, { exact: true }),
  ).toBeVisible();
  await expect(
    registrationDetail.getByRole('heading', {
      name: 'Platform registration actions',
    }),
  ).toBeVisible();
  await expect(
    registrationDetail.getByRole('heading', { name: 'Cancellation policy' }),
  ).toBeVisible();
  await expect(
    registrationDetail.getByText('Participant deadline', { exact: true }),
  ).toBeVisible();
  await expect(
    registrationDetail.getByText('Refund', { exact: true }),
  ).toBeVisible();
  await expect(
    registrationDetail.getByLabel('Operational reason'),
  ).toBeVisible();
  await expect(
    registrationDetail.getByText('Required for every platform mutation', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    inspection.getByText('First 100 results', { exact: true }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
### Review a scanner result

For deterministic support and documentation checks, paste a registration ID or an attendee ticket URL into **Registration inspection**. The result route validates the target tenant again; possession of a QR value is not authority. The recent-results query is bounded to 100 records.

The result shows the current registration state, check-in eligibility, participant cancellation deadline, refund terms, and any pending payment state. Evorto displays only the actions allowed by that current state. Every available mutation requires an **Operational reason** before a platform administrator can approve a manual application, resume payment setup, check in the attendee and guests, or cancel the registration. Platform cancellation can override the participant deadline before the event starts, but it cannot bypass checked-in, started-event, or payment-safety constraints. Approval and cancellation do not invent a tenant executive user; their domain transition and PII-free platform audit entry share the same transaction.

Camera-based scanning remains in the organizer scanner and should be reviewed manually unless browser camera emulation is straightforward and reliable.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-scanner'),
    page,
    'Inspect a deterministic scanner result',
  );

  await testInfo.attach('markdown', {
    body: `
#### Resolve non-confirmed tickets without duplicate registration or payment

The platform result names the exact state instead of showing one generic check-in error:

- **Pending:** the attendee may still need organizer approval or their existing Stripe Checkout. Review that registration; do not start another registration or payment.
- **Waitlist:** the attendee has no confirmed spot. Review capacity and the waitlist; do not take payment or create another registration from the scanner.
- **Cancelled:** the ticket cannot be checked in. Do not ask the attendee to pay or register again; review the existing registration and refund if the cancellation looks wrong.
`,
  });

  for (const guidance of platformScannerStatusGuidance) {
    await database
      .update(schema.eventRegistrations)
      .set({ status: guidance.status })
      .where(
        and(
          eq(schema.eventRegistrations.id, registration.id),
          eq(schema.eventRegistrations.tenantId, tenant.id),
        ),
      );
    await page.reload();

    await expect(
      registrationDetail.getByText(guidance.status, { exact: true }),
    ).toBeVisible();
    const statusAlert = registrationDetail.getByRole('alert');
    await expect(statusAlert).toContainText(guidance.title);
    await expect(statusAlert).toContainText(guidance.body);
    await takeScreenshot(
      testInfo,
      statusAlert,
      page,
      `Platform scanner: ${guidance.title}`,
    );
  }
});
