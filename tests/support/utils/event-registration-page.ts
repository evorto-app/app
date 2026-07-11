import type { Page } from '@playwright/test';

export const waitForRegistrationPage = async (
  page: Pick<Page, 'getByRole' | 'getByText' | 'locator'>,
): Promise<void> => {
  const eventDetailsSelector = 'app-event-list router-outlet + ng-component';
  const eventDetails = page.locator(eventDetailsSelector);
  await eventDetails.waitFor({ state: 'attached', timeout: 20_000 });
  await page
    .locator(`${eventDetailsSelector}:not([aria-busy="true"])`)
    .waitFor({ state: 'attached', timeout: 20_000 });
  await eventDetails
    .getByText('Loading event ...', { exact: true })
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 });

  if (
    await eventDetails
      .getByText('Failed to load event.', { exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error('Event details failed to load');
  }

  await eventDetails
    .getByRole('heading', {
      exact: true,
      level: 2,
      name: 'Registration',
    })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await eventDetails
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 });

  if (
    await eventDetails
      .getByText('Failed to load registration status.')
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error('Event registration status failed to load');
  }
};
