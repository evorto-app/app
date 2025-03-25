import { DateTime } from 'luxon';

import {
  adminStateFile,
  defaultStateFile,
  userStateFile,
} from '../../../helpers/user-data';
import { fillTestCard } from '../../fill-test-card';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage templates', async ({ events, page }, testInfo) => {
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
- **Payment required**: Is a payment required for this registration?
- **Registration fee**: The registration fee for this registration. This field is only visible if the payment is required.
- **Selected roles**: The roles that are selected for this registration. Users can only see and use the registration if they have one of the selected roles.
- **Registration mode**: By which mode will this registration work, the following options exist:
  - First come first serve: The first user to register will get the registration.
  - ~~Random: There is a period in which users can sign up for the event. After this period, random users will be selected until the event is full.~~ _Not available yet_
  - Application: Users can sign up for the event, but they will not be automatically registered. The event owner has to approve the registration.
- **Registration start**: The offset in hours for when the registration should start. For example 168 hours means that the registration will start 7 days before the event starts.
- **Registration end**: The offset in hours for when the registration should end. For example 24 hours means that the registration will end 1 day before the event starts.
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
Once you are happy with your template, click _Save template_ to save your changes.
You will be redirected to the detail page for that template.
`,
  });
});
