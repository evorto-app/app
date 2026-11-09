import { expect, test } from '../../support/fixtures/parallel-test';

for (const timezoneId of ['Europe/Berlin', 'America/New_York']) {
  test.describe(`Device timezone ${timezoneId}`, () => {
    test.use({ timezoneId });

    test('keeps server times explicit and hides the label only for a matching device zone', async ({
      page,
      seeded,
    }) => {
      const response = await page.goto(
        `/events/${seeded.scenario.events.freeOpen.eventId}`,
      );
      expect(await response?.text()).toContain('Times shown in Europe/Berlin.');
      const label = page.getByText('Times shown in Europe/Berlin.', {
        exact: true,
      });
      if (timezoneId === 'Europe/Berlin') {
        await expect(label).toHaveCount(0);
      } else {
        await expect(label).toBeVisible();
      }
      await expect(page.locator('header time')).toHaveCount(2);
    });
  });
}
