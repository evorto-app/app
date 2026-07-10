import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

test('Review target-scoped platform operations', async ({
  page,
  registrations,
  tenant,
}, testInfo) => {
  const registration =
    registrations.find((candidate) => candidate.status === 'CONFIRMED') ??
    registrations[0];
  if (!registration) {
    throw new Error(
      'Expected a seeded registration for platform documentation',
    );
  }

  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('navigation', { name: 'Target tenant operations' }),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
# Target-scoped platform operations

Platform administrators are Auth0-backed platform principals, not tenant users. Open a tenant from **Platform administration** and use its dedicated operation links. The selected tenant is sent explicitly with every request; the platform session never inherits or merges tenant-role permissions.

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

  await page.goto(`/global-admin/tenants/${tenant.id}/events`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create event' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/events/new`);
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-events'),
    page,
    'Target-tenant event lifecycle',
  );

  await testInfo.attach('markdown', {
    body: `
## Edit the complete event graph

Open a draft event to edit its core schedule together with every registration-option field, role restriction, cancellation and transfer policy, price, inclusive tax rate, ESNcard discount, add-on mapping, and registration question. Existing registration-option identities and live counters are preserved. Add-ons with purchases and questions with answers cannot be removed.

The target tenant is checked on every read and write. Role references are validated while holding the shared tenant role-graph lock, and the event update plus its PII-free before/after audit entry commit atomically.
`,
  });

  await page.goto(`/global-admin/tenants/${tenant.id}/templates`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Event templates' }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-templates'),
    page,
    'Target-tenant event templates',
  );

  await page.goto(`/global-admin/tenants/${tenant.id}/finance`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tenant finance' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Refund recovery' }).click();
  await expect(
    page.getByText(
      'Only terminal Stripe refunds and exhausted, unleased refund processing appear here.',
      { exact: false },
    ),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Recover a refund without duplicating it

Open **Review finance** and select **Refund recovery**. The queue excludes active, pending, ambiguous, and successful refunds. A terminal Stripe refund schedules a new generation with a new generation-specific idempotency key; exhausted processing resumes the existing durable claim and generation. Review the registration, source transaction, transfer state when present, and prior error before entering the required operational reason.

The recovery write updates any linked transfer and appends the platform audit entry in the same transaction. A participant whose transfer already completed must not pay or claim again while finance recovers the source refund.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-finance'),
    page,
    'Review refunds eligible for manual recovery',
  );

  await page.goto(`/global-admin/tenants/${tenant.id}/scanner`);
  await page
    .getByLabel('Registration ID or result URL')
    .fill(`http://localhost:4200/scan/registration/${registration.id}`);
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/global-admin/tenants/${tenant.id}/scanner/${registration.id}$`,
    ),
  );
  await expect(page.getByText(registration.id, { exact: true })).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Review a scanner result

For deterministic support and documentation checks, paste a registration ID or an attendee ticket URL into **Registration inspection**. The result route validates the target tenant again; possession of a QR value is not authority. The recent-results query is bounded to 100 records.

The result explains check-in eligibility, the participant cancellation deadline, refund terms, and pending payment state. A required operational reason can approve a manual application, resume its payment setup, check in the attendee and guests, or cancel the registration. Platform cancellation can override the participant deadline before the event starts, but it cannot bypass checked-in, started-event, or payment-safety constraints. Approval and cancellation do not invent a tenant executive user; their domain transition and PII-free platform audit entry share the same transaction.

Camera-based scanning remains in the organizer scanner and should be reviewed manually unless browser camera emulation is straightforward and reliable.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-scanner'),
    page,
    'Inspect a deterministic scanner result',
  );
});
