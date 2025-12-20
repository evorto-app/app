import { Page } from '@playwright/test';
import { DateTime } from 'luxon';

export const fillTestCard = async (page: Page) => {
  await page.getByRole('button', { name: 'Card' }).dispatchEvent('click');
  await page.getByRole('textbox', { name: 'Card number' }).fill('4242424242424242');
  await page.getByRole('textbox', { name: 'CVC' }).fill('123');
  await page
    .getByRole('textbox', { name: 'Expiration' })
    .fill(DateTime.local().plus({ year: 1 }).toFormat('MM/yy'));
  await page.getByRole('textbox', { name: 'Cardholder name' }).fill('Automated Testuser');
};
