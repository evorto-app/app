import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test.skip(true, 'Template docs are completed by a later stacked slice.');

test('Manage templates', async ({ page }, testInfo) => {
  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with all required permissions. These are:
- **templates:create**: This permission is required to create a new template.
- **templates:editAll**: This permission is required to edit templates.
{% /callout %}
Templates are the base for all events.
They are used to save common settings for events and have to be created before you can create an event.


## Creating templates
Start by navigating to **Templates**. Here you can see an overview of the existing templates.
Click on _Create template_ to create a new template.`,
  });
  await page.getByRole('link', { name: 'Templates' }).click();
  await takeScreenshot(
    testInfo,
    page.getByRole('link', { name: 'Create template' }),
    page,
  );
  await page.getByRole('link', { name: 'Create template' }).click();
  await testInfo.attach('markdown', {
    body: `
You can now specify all the settings for your template.
Everything you enter for a template will be the starting point for all events created from this template.
#### General settings
There are a few general settings that are required for templates:
- **Template icon**: The icon to be used for the template.
- **Template name**: The name of the template.
- **Template category**: The category this template should belong to. Learn how to [manage categories](/docs/manage-template-categories) to group your templates.
- **Template description**: Lastly, the description of the template. To open the full editor, click the field for the description.
- **Organizer planning tips**: Optional private organizer notes, setup checklists, or recurring reminders that stay on the template detail page and are not shown on the public event page.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-template-create form div').first(),
    page,
  );
  await testInfo.attach('markdown', {
    body: `
#### Registration settings
In simple mode (currently the only mode), the registration settings are split in two.
There are the settings for participants, and separately, those for organizers.
Both have the same structure, but you can see that different roles are preselected.
The registration consists of the following settings:
- **Registration option name**: The reusable label copied into events created
  from this template.
- **Description** and **description for registered users**: Optional reusable
  public and attendee-only copy that is copied into the event registration
  option.
- **Payment required**: Is a payment required for this registration?
- **Registration fee**: The registration fee for this registration. This field is only visible if the payment is required.
- **ESNcard discounted price**: Optional discounted pricing for tenants with the ESNcard discount provider enabled. Leave it empty when this template registration should use the standard price only.
- **Selected roles**: The roles that are selected for this registration. Users can only see and use the registration if they have one of the selected roles.
- **Registration mode**: First come first serve is the only selectable mode for now. The first user to register will get the registration.
- **Registration start**: The offset in hours for when the registration should start. For example 168 hours means that the registration will start 7 days before the event starts.
- **Registration end**: The offset in hours for when the registration should end. For example 24 hours means that the registration will end 1 day before the event starts.
- **Role picker behavior**: Roles that are already selected are hidden from autocomplete suggestions to prevent duplicates.
`,
  });
  await takeScreenshot(
    testInfo,
    page
      .locator('app-template-create form')
      .locator('div', { hasText: 'Simple Registration Setup' }),
    page,
  );

  await testInfo.attach('markdown', {
    body: `
In the migrated form, payment-specific fields are conditionally shown.
When **Enable Payment** is on, the price and tax-rate fields appear for that registration block. Tenants with ESNcard discounts enabled also see the optional ESNcard discounted price field.
`,
  });
  const paymentToggle = page
    .locator('app-template-registration-option-form')
    .first()
    .getByRole('checkbox', { name: 'Enable payment' });
  await paymentToggle.check();
  await expect(page.getByLabel('Price (in cents)').first()).toBeVisible();
  await expect(page.getByLabel('Tax rate').first()).toBeVisible();
  await takeScreenshot(
    testInfo,
    page
      .locator('app-template-create form')
      .locator('div', { hasText: 'Organizer Registration' }),
    page,
    'Organizer payment fields visible',
  );

  await testInfo.attach('markdown', {
    body: `
Role selection also avoids duplicate entries by hiding already selected roles from the autocomplete list.
`,
  });
  const organizerRoleInput = page.getByPlaceholder('Add Role...').first();
  await organizerRoleInput.click();
  const roleOptions = page.locator('mat-option');
  if ((await roleOptions.count()) > 0) {
    const firstRoleOption = roleOptions.first();
    const firstRoleText = await firstRoleOption.textContent();
    const selectedRoleName = firstRoleText?.trim();
    await firstRoleOption.click();
    await organizerRoleInput.click();
    if (selectedRoleName) {
      await expect(
        page.getByRole('option', {
          exact: true,
          name: selectedRoleName,
        }),
      ).toHaveCount(0);
    }
    await takeScreenshot(
      testInfo,
      page
        .locator('app-template-create form')
        .locator('div', { hasText: 'Organizer Registration' }),
      page,
      'Role autocomplete hides selected entries',
    );
  }

  await testInfo.attach('markdown', {
    body: `
#### Reusable add-ons
Templates can also store optional add-ons such as meals, equipment, or other extras.
Add-ons can be free or paid, attached to either the participant or organizer registration option, and can limit the included quantity, total availability, maximum quantity per user, and purchase timing.
`,
  });
  await page.getByRole('button', { name: 'Add add-on' }).click();
  await expect(page.getByLabel('Add-on name')).toBeVisible();
  await expect(page.getByLabel('Attach to')).toBeVisible();
  await expect(page.getByText('Purchase timing')).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-template-addon-form'),
    page,
    'Reusable add-on form',
  );

  await testInfo.attach('markdown', {
    body: `
Once you are happy with your template, click _Save template_ to save your changes.
You will be redirected to the detail page for that template.
`,
  });
});
