import type { Page } from '@playwright/test';

export const waitForRegistrationPage = async (
  page: Pick<Page, 'getByRole' | 'getByText'>,
): Promise<void> => {
  await page
    .getByRole('heading', {
      exact: true,
      level: 2,
      name: 'Registration',
    })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 });

  if (
    await page
      .getByText('Failed to load registration status.')
      .isVisible()
      .catch(() => false)
  ) {
    throw new Error('Event registration status failed to load');
  }
};
