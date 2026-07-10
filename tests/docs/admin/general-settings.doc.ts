import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage tenant general settings @admin', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const originalTenant = await database.query.tenants.findFirst({
    where: (tenantTable) => eq(tenantTable.id, tenant.id),
  });
  if (!originalTenant) {
    throw new Error('Expected generated general-settings docs tenant');
  }
  const documentedEmailSenderName = 'Documentation Operations';
  const documentedEmailSenderEmail = `operations+${tenant.id}@example.org`;
  const documentedStripeAccountId = `acct_docs_${tenant.id}`;
  const documentedRegistrationLimit = 4;
  const documentedTransferDeadlineHours = 24;
  const documentedCancellationDeadlineHours = 96;
  const documentedRefundFeesOnCancellation = false;

  try {
    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Account and permission" %}
This guide uses a signed-in tenant administrator in the tenant being changed. The account needs **admin:changeSettings**. A platform-level global administrator does not receive this tenant permission automatically.
{% /callout %}

# Tenant General Settings

Use **Admin Tools** -> **General settings** to review and change settings for the tenant currently shown in Evorto. Settings are tenant-bound: saving here must not change another section's configuration.
`,
    });

    await page.getByRole('link', { name: 'Admin Tools' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin settings' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'General settings' }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    const generalSettings = page.locator('app-general-settings');
    await expect(generalSettings).toBeVisible();
    await expect(
      generalSettings.getByText('Formatting locale', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByText('de-DE', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByText('Canonical root URL', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByText(originalTenant.canonicalRootUrl, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      generalSettings.getByRole('textbox', { name: 'Canonical root URL' }),
    ).toHaveCount(0);
    await expect(
      generalSettings.getByRole('combobox', { name: 'Locale' }),
    ).toHaveCount(0);
    const currencySelect = generalSettings.getByRole('combobox', {
      name: 'Currency',
    });
    await expect(currencySelect).toBeVisible();
    await currencySelect.click();
    await expect(page.getByRole('option', { name: 'EUR' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'CZK' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'AUD' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      generalSettings.getByRole('textbox', { name: 'Timezone' }),
    ).toHaveValue('Europe/Berlin');
    await expect(
      generalSettings.getByRole('combobox', { name: 'Timezone' }),
    ).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      generalSettings,
      page,
      'Tenant general settings',
    );

    await testInfo.attach('markdown', {
      body: `
## Understand the operations fields before saving

In **Operations settings**:

1. **Email reply-to name** and **Email reply-to email** control where replies to tenant emails go. Evorto keeps the actual From address on the ESN.WORLD notification domain.
2. **Stripe account ID** is the connected-account identifier used for tenant payment operations. This text field does not create or verify a Stripe account, so confirm the account id outside Evorto before changing it.
3. **Active registration limit** caps how many active registrations one person may have across this tenant. Enter **0** for no tenant-wide limit.
4. **Transfer deadline before event (hours)** says how long before an event starts participants stop being able to transfer a registration. Enter **0** to allow transfers until the event starts.
5. **Cancellation deadline before event (hours)** says how long before an event starts participant cancellations close. The default **120** is five days.
6. **Refund fees on cancellation** controls whether eligible cancellation refunds include refundable payment fees.

The generated journey below changes all seven fields on its disposable tenant, saves them, checks the stored tenant row, reloads the page, and checks that the same values are read back.
`,
    });

    await page
      .getByPlaceholder('Example Section')
      .fill(` ${documentedEmailSenderName} `);
    await page
      .getByPlaceholder('events@section.example.org')
      .fill(` ${documentedEmailSenderEmail} `);
    await page
      .getByPlaceholder('acct_...')
      .fill(` ${documentedStripeAccountId} `);
    await page
      .getByRole('spinbutton', { name: 'Active registration limit' })
      .fill(String(documentedRegistrationLimit));
    await page
      .getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      })
      .fill(String(documentedTransferDeadlineHours));
    await page
      .getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      })
      .fill(String(documentedCancellationDeadlineHours));
    const refundFeesToggle = generalSettings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'Refund fees on cancellation' })
      .getByRole('switch');
    if (await refundFeesToggle.isChecked()) {
      await refundFeesToggle.click();
    }
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Tenant settings updated')).toBeVisible();

    await expect
      .poll(async () => {
        const persistedTenant = await database.query.tenants.findFirst({
          where: (tenantTable) => eq(tenantTable.id, tenant.id),
        });
        return persistedTenant
          ? {
              cancellationDeadlineHoursBeforeStart:
                persistedTenant.cancellationDeadlineHoursBeforeStart,
              emailSenderEmail: persistedTenant.emailSenderEmail,
              emailSenderName: persistedTenant.emailSenderName,
              maxActiveRegistrationsPerUser:
                persistedTenant.maxActiveRegistrationsPerUser,
              refundFeesOnCancellation:
                persistedTenant.refundFeesOnCancellation,
              stripeAccountId: persistedTenant.stripeAccountId,
              transferDeadlineHoursBeforeStart:
                persistedTenant.transferDeadlineHoursBeforeStart,
            }
          : null;
      })
      .toEqual({
        cancellationDeadlineHoursBeforeStart:
          documentedCancellationDeadlineHours,
        emailSenderEmail: documentedEmailSenderEmail,
        emailSenderName: documentedEmailSenderName,
        maxActiveRegistrationsPerUser: documentedRegistrationLimit,
        refundFeesOnCancellation: documentedRefundFeesOnCancellation,
        stripeAccountId: documentedStripeAccountId,
        transferDeadlineHoursBeforeStart: documentedTransferDeadlineHours,
      });

    await page.reload();
    await expect(page.getByPlaceholder('Example Section')).toHaveValue(
      documentedEmailSenderName,
    );
    await expect(
      page.getByPlaceholder('events@section.example.org'),
    ).toHaveValue(documentedEmailSenderEmail);
    await expect(page.getByPlaceholder('acct_...')).toHaveValue(
      documentedStripeAccountId,
    );
    await expect(
      page.getByRole('spinbutton', { name: 'Active registration limit' }),
    ).toHaveValue(String(documentedRegistrationLimit));
    await expect(
      page.getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      }),
    ).toHaveValue(String(documentedTransferDeadlineHours));
    await expect(
      page.getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      }),
    ).toHaveValue(String(documentedCancellationDeadlineHours));
    await expect(refundFeesToggle).not.toBeChecked();
    await takeScreenshot(
      testInfo,
      generalSettings,
      page,
      'Persisted tenant operations settings',
    );

    await testInfo.attach('markdown', {
      body: `
## Completion and recovery

The **Tenant settings updated** message confirms that the write completed. Reload the page when you need an operator readback: the saved reply-to identity, Stripe account id, registration limit, transfer deadline, cancellation deadline, and fee-refund choice must still be present.

The Save action remains unavailable while the form is invalid or another save is running. If the server rejects a change, Evorto shows the error and does not present the success message; correct the value and retry. Currency and timezone changes have an additional safety rule: once the tenant has event or payment data, those changes require a migration plan outside this page.

## Current settings surface

The current general settings page supports:

- A **Deferred settings** summary that keeps custom-domain automation visible as a deferred scope item.
- A read-only **Tenant identity** summary with tenant name, primary domain, and Stripe connection state. The secure HTTPS origin used for outbound links is derived from the normalized primary domain.
- **Operations settings** for tenant email reply-to name/email, Stripe account id, and the tenant-wide active registration limit. Event review remains a simple capability policy: users with **events:review** can review events.
- **Default Location** for event location search bias.
- **Site theme** for the tenant theme.
- A **Currency** select with EUR, CZK, and AUD plus a **Timezone** text field that accepts an IANA timezone such as Europe/Berlin. Currency and timezone can be changed before the tenant has event or payment data; after that, the server rejects changes unless a migration plan is handled outside this page.
- **Formatting locale** is read-only and fixed to **de-DE** so dates and numbers are consistent across tenants; the page does not expose a Locale combobox.
- **Logo URL** and **Favicon URL** for tenant brand assets. Admins can upload PNG, JPEG, WebP, or GIF logos; favicons also support ICO files. Externally hosted URLs are still supported. The configured favicon updates the browser tab icon.
- **SEO title** and **SEO description** for tenant-level page metadata.
- **Legal pages** for tenant imprint/legal notice, privacy policy, and terms. Admins can use external URLs or hosted text. External URLs appear in the public footer as off-site links; hosted text appears at \`/legal/imprint\`, \`/legal/privacy\`, and \`/legal/terms\`.
- **Allowed receipt countries** and **Allow other** for receipt submission.
- **ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.

Tax rates are managed on the separate **Tax Rates** page.

## Relaunch scope notes

One-domain-per-tenant remains the current relaunch scope in the application schema. The page exposes the active primary domain for operator review and explains that the secure HTTPS origin is derived from its normalized value. Tenant admins can maintain supported currency, locale, timezone, email reply-to settings, Stripe account id, registration limits, uploaded or externally hosted logo/favicon assets, legal links, and hosted legal text, while an in-app deferred-settings summary keeps custom-domain verification visible. Currency, locale, and timezone changes are only accepted before event or payment data exists for the tenant. When one of those accepted changes is saved, Evorto reloads the app so bootstrap-level formatting defaults use the new tenant settings.
`,
    });
  } finally {
    await database
      .update(schema.tenants)
      .set({
        cancellationDeadlineHoursBeforeStart:
          originalTenant.cancellationDeadlineHoursBeforeStart,
        emailSenderEmail: originalTenant.emailSenderEmail,
        emailSenderName: originalTenant.emailSenderName,
        maxActiveRegistrationsPerUser:
          originalTenant.maxActiveRegistrationsPerUser,
        refundFeesOnCancellation: originalTenant.refundFeesOnCancellation,
        stripeAccountId: originalTenant.stripeAccountId,
        transferDeadlineHoursBeforeStart:
          originalTenant.transferDeadlineHoursBeforeStart,
      })
      .where(eq(schema.tenants.id, originalTenant.id));
  }
});
