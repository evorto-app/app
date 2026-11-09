import { eq } from 'drizzle-orm';

import { organizerStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { waitForEventCreationFormReady } from '../../support/utils/event-creation-form';

test.use({ storageState: organizerStateFile });

for (const scenario of [
  {
    season: 'spring',
    startDate: '02.04.2099',
    openingDate: /^26\.0?3\.2099$/,
    closingDate: /^0?1\.0?4\.2099$/,
  },
  {
    season: 'autumn',
    startDate: '29.10.2099',
    openingDate: /^22\.10\.2099$/,
    closingDate: /^28\.10\.2099$/,
  },
]) {
  test(`template registration windows keep their clock time across ${scenario.season} DST and preserve manual edits`, async ({
    database,
    page,
    registerDatabaseCleanup,
    templates,
    tenant,
  }) => {
    const template = templates.find((entry) => entry.seedKey === 'city-tour');
    if (!template) throw new Error('Expected the seeded city-tour template.');
    const tenantRecord = await database.query.tenants.findFirst({
      where: { id: tenant.id },
    });
    expect(tenantRecord?.timezone).toBe('Europe/Berlin');
    const options = await database.query.templateRegistrationOptions.findMany({
      where: { templateId: template.id },
    });
    const participant = options.find(
      (option) => !option.organizingRegistration,
    );
    if (!participant) throw new Error('Expected a participant sign-up choice.');
    registerDatabaseCleanup(async (cleanupDatabase) => {
      for (const option of options) {
        await cleanupDatabase
          .update(schema.templateRegistrationOptions)
          .set(option)
          .where(eq(schema.templateRegistrationOptions.id, option.id));
      }
    });
    await database
      .update(schema.templateRegistrationOptions)
      .set({ openRegistrationOffset: 168, closeRegistrationOffset: 24 })
      .where(eq(schema.templateRegistrationOptions.templateId, template.id));

    await page.goto(`/templates/${template.id}/create-event`);
    await waitForEventCreationFormReady(page);
    const general = page.locator('app-event-general-form');
    const choice = page.locator('app-registration-option-form').filter({
      has: page.getByRole('heading', { name: participant.title, exact: true }),
    });
    const eventTime = general.getByRole('combobox', { name: 'Start time' });
    const openingTime = choice.getByRole('combobox', { name: 'Start time' });
    const closingTime = choice.getByRole('combobox', { name: 'End time' });
    await general
      .getByRole('textbox', { name: 'Start date' })
      .fill(scenario.startDate);
    await eventTime.fill('19:00');
    await eventTime.press('Tab');
    await expect(
      choice.getByRole('textbox', { name: 'Start date' }),
    ).toHaveValue(scenario.openingDate);
    await expect(choice.getByRole('textbox', { name: 'End date' })).toHaveValue(
      scenario.closingDate,
    );
    await expect(openingTime).toHaveValue('19:00');
    await expect(closingTime).toHaveValue('19:00');

    await eventTime.fill('20:00');
    await eventTime.press('Tab');
    await expect(openingTime).toHaveValue('20:00');
    await expect(closingTime).toHaveValue('20:00');

    await openingTime.fill('18:30');
    await openingTime.press('Tab');
    await eventTime.fill('21:00');
    await eventTime.press('Tab');
    await expect(openingTime).toHaveValue('18:30');
    await expect(closingTime).toHaveValue('21:00');
    await expect(
      choice.getByRole('textbox', { name: 'Start date' }),
    ).toHaveValue(scenario.openingDate);
  });
}
