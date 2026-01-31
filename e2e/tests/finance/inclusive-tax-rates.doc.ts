import {
  adminStateFile,
  userStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.describe('Inclusive tax rates documentation (admin)', () => {
  test.use({ storageState: adminStateFile });

  test('Import tenant tax rates', async ({ page }, testInfo) => {
    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
To manage tax rates you need the **admin:manageTaxes** permission. The screenshots below assume you are signed in as a tenant administrator.
{% /callout %}

# Manage Inclusive Tax Rates

Inclusive (VAT-style) tax rates are configured under **Admin → Tax Rates**. Start from the dashboard and open the admin area.
`,
    });

    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(
      page.getByRole('heading', { name: /Admin settings/i }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
The admin overview links to all configuration areas. Select **Tax Rates** to manage the rates imported from your payment provider.
`,
    });

    await page.getByRole('link', { name: 'Tax Rates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Tax Rates' }),
    ).toBeVisible();

    await takeScreenshot(
      testInfo,
      page.locator('app-tax-rates-settings'),
      page,
      'Tax rates overview',
    );

    await testInfo.attach('markdown', {
      body: `
## Imported tax rates

- **Compatible Tax Rates** lists inclusive & active rates that event creators can select.
- **Incompatible Rates** (exclusive/archived) are shown for context and stay disabled.
- Use the floating **Import Tax Rates** button to sync additional rates from Stripe.
`,
    });

    const importButton = page
      .getByRole('button', { name: 'Import Tax Rates' })
      .first();
    await expect(importButton).toBeVisible();
    await importButton.click();

    await expect(
      page.getByRole('heading', { name: 'Import Stripe tax rates' }),
    ).toBeVisible();

    await takeScreenshot(
      testInfo,
      page.locator('mat-dialog-container'),
      page,
      'Import Stripe tax rates dialog',
    );

    await testInfo.attach('markdown', {
      body: `
The import dialog loads tax rates directly from Stripe:

- Inclusive & active rates are selectable.
- Exclusive or archived rates remain blocked with clear chips.
- Already-imported rates show the **imported** badge.

Select the rates you need and choose **Import selected** to refresh the compatible list.
`,
    });

    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Inclusive tax rates documentation (creators)', () => {
  test.use({ storageState: adminStateFile });

  test('Assign compatible tax rates to paid registrations', async ({
    page,
  }, testInfo) => {
    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
# Require a tax rate for paid registration options

Event templates enforce inclusive pricing: every paid registration must reference a compatible tax rate, while free registrations keep the field disabled.

Navigate to **Templates** and open an existing paid template to see the enforced controls.
`,
    });

    await page.getByRole('link', { name: 'Templates' }).click();
    await expect(
      page.getByRole('heading', { name: 'Event templates' }),
    ).toBeVisible();

    const soccerTemplateLink = page
      .locator('a', { hasText: 'Soccer Match' })
      .first();
    await expect(soccerTemplateLink).toBeVisible();
    await soccerTemplateLink.click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Soccer Match' }),
    ).toBeVisible();

    const registrationSection = page
      .locator('section')
      .filter({ hasText: 'Registration Options' })
      .first();
    await takeScreenshot(
      testInfo,
      registrationSection,
      page,
      'Template registration options with inclusive labels',
    );

    await testInfo.attach('markdown', {
      body: `
Each paid registration displays the final price together with its inclusive tax label (for example “Incl. 19% VAT”). Exclusive or inactive rates never appear in this list.
`,
    });

    await page.getByRole('button', { name: 'Edit template' }).click();
    const editForm = page.locator('app-template-edit form');
    await expect(editForm).toBeVisible();

    const organizerSection = editForm.locator(
      '[formgroupname="organizerRegistration"]',
    );
    const participantSection = editForm.locator(
      '[formgroupname="participantRegistration"]',
    );

    await takeScreenshot(
      testInfo,
      organizerSection,
      page,
      'Organizer registration tax rate selector',
    );

    await testInfo.attach('markdown', {
      body: `
Paid organizer registrations require a compatible inclusive tax rate. The dropdown is populated from the imported rates and remains mandatory.
`,
    });

    await takeScreenshot(
      testInfo,
      participantSection,
      page,
      'Participant registration tax rate selector',
    );

    await testInfo.attach('markdown', {
      body: `
Participant registrations follow the same rule—if payment is enabled, the tax rate selector remains required. Free registrations keep the selector hidden and disabled.
`,
    });

    await page.getByRole('link', { name: 'Events' }).click();
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

    const soccerEventLink = page
      .getByRole('link', { name: /Soccer Match 1/i })
      .first();
    await expect(soccerEventLink).toBeVisible();
    await soccerEventLink.click();

    await expect(
      page.getByRole('heading', { level: 1, name: /Soccer Match 1/i }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
## Update tax rates in existing events

Event editors can revisit the same controls when updating a live event. Use **Edit Event** to adjust tax rates if regulations or pricing change.
`,
    });

    await page.getByRole('link', { name: /Edit Event/i }).click();

    const eventEditForm = page.locator('app-event-edit form');
    await expect(eventEditForm).toBeVisible();

    const eventEditTax = eventEditForm.locator(
      'app-registration-option-form mat-select[formcontrolname="stripeTaxRateId"]',
    );

    await takeScreenshot(
      testInfo,
      eventEditTax.first(),
      page,
      'Event edit tax rate selector',
    );

    await testInfo.attach('markdown', {
      body: `
Existing paid registrations keep their inclusive tax requirements. Update the selected rate here—event creators cannot save the form without picking a compatible imported tax rate.
`,
    });
  });
});

test.describe('Inclusive tax rates documentation (participants)', () => {
  test.use({ storageState: userStateFile });

  test('See inclusive pricing during registration', async ({
    events,
    page,
    registrations,
    tenant,
  }, testInfo) => {
    const regularUserId = usersToAuthenticate.find(
      (entry) => entry.roles === 'user',
    )?.id;

    const paidEvent = events.find((event) => {
      if (event.tenantId !== tenant.id) return false;
      if (event.unlisted) return false;
      if (event.status !== 'APPROVED') return false;
      const hasCompatiblePaidOption = event.registrationOptions.some(
        (option) => option.isPaid && option.stripeTaxRateId,
      );
      if (!hasCompatiblePaidOption) return false;
      if (!regularUserId) return true;
      const alreadyRegistered = registrations.some(
        (registration) =>
          registration.eventId === event.id &&
          registration.userId === regularUserId &&
          registration.status === 'CONFIRMED',
      );
      return !alreadyRegistered;
    });

    if (!paidEvent) {
      test.skip(true, 'No paid approved event available for documentation.');
    }

    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();

    const eventLink = page
      .getByRole('link', { name: paidEvent!.title })
      .first();
    await expect(eventLink).toBeVisible();
    await eventLink.click();

    await expect(
      page.getByRole('heading', { level: 1, name: paidEvent!.title }),
    ).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
# Participant experience

Participants always see tax-inclusive pricing. The registration card shows the final amount and the accompanying label (for example “Incl. 19% VAT”). Discounts and checkout flows reuse the same amount and tax rate identifier.
`,
    });

    const registrationCards = page.locator('app-event-registration-option');
    const activeRegistration = page.locator('app-event-active-registration');

    let screenshotTarget = registrationCards.first();
    if ((await registrationCards.count()) === 0) {
      await expect(activeRegistration).toBeVisible();
      screenshotTarget = activeRegistration.first();
    } else {
      await expect(screenshotTarget).toBeVisible();
    }

    const inclusiveLabel = page.locator('text=/Incl\./i').first();
    await expect(inclusiveLabel).toBeVisible();
    const inclusiveLabelText = (await inclusiveLabel.innerText()).trim();

    await takeScreenshot(
      testInfo,
      screenshotTarget,
      page,
      'Participant registration with inclusive pricing',
    );

    await testInfo.attach('markdown', {
      body: `
- The price button uses the tax-inclusive amount (“Pay … and register”).
- The label next to the price clarifies which tax rate is included. If a rate ever becomes unavailable, the UI falls back to “Incl. Tax” so checkout can continue without surprises.
- Selecting a discount updates the final amount but keeps the inclusive wording intact.
`,
    });

    const payAndRegisterButton = registrationCards
      .first()
      .getByRole('button', { name: /Pay .* and register/i });

    await expect(payAndRegisterButton).toHaveCount(1);

    if ((await payAndRegisterButton.count()) > 0) {
      await payAndRegisterButton.click();
      await expect(activeRegistration).toBeVisible();

      const payNowLink = activeRegistration
        .first()
        .getByRole('link', { name: /Pay now/i });
      await expect(payNowLink).toHaveCount(1);
      if ((await payNowLink.count()) > 0) {
        const popupPromise = page
          .context()
          .waitForEvent('page', { timeout: 5_000 })
          .catch(() => null);
        await payNowLink.click();

        let checkoutPage = await popupPromise;
        if (!checkoutPage) {
          await page.waitForURL(/https:\/\/checkout\.stripe\.com\//, {
            timeout: 15_000,
          });
          checkoutPage = page;
        }

        await checkoutPage.waitForLoadState('domcontentloaded');

        await takeScreenshot(
          testInfo,
          checkoutPage.locator('body'),
          checkoutPage,
          'Stripe checkout summary',
        );

        await testInfo.attach('markdown', {
          body: `
The Stripe-hosted checkout shows the same tax-inclusive price, and the tax rate identifier is embedded in the payment metadata for compliance.
`,
        });

        if (inclusiveLabelText) {
          const normalized = inclusiveLabelText
            .replace(/^Incl\.\s*/i, '')
            .trim();
          const fragments = normalized
            .split(/\s+/)
            .map((fragment) => fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .filter((fragment) => fragment.length > 1);

          for (const fragment of fragments) {
            await expect(
              checkoutPage.getByText(new RegExp(fragment, 'i')),
            ).toBeVisible();
          }
        }

        if (checkoutPage !== page) {
          await checkoutPage.close();
        } else {
          await page.goBack();
        }
      }
    }
  });
});
