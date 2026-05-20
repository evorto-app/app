import { eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

test('profile edit persists notification email and reimbursement details', async ({
  database,
  page,
  seedDate,
}) => {
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  const originalUser = await database.query.users.findFirst({
    where: { id: regularUser.id },
  });
  if (!originalUser) {
    throw new Error('Expected regular profile user to exist');
  }

  const notificationEmail = `profile-spec-${seedDate.getTime()}@evorto.app`;
  const iban = 'DE89370400440532013000';
  const paypalEmail = `profile-paypal-${seedDate.getTime()}@evorto.app`;

  try {
    await page.goto('/profile');

    await expect(
      page.getByRole('button', { name: 'Edit profile' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit profile' }).click();

    const editDialog = page.locator('mat-dialog-container');
    await expect(editDialog).toBeVisible();
    await page.getByRole('textbox', { name: 'First name' }).fill('');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await page
      .getByRole('textbox', { name: 'First name' })
      .fill(originalUser.firstName);

    await page
      .getByRole('textbox', { name: 'Notification email' })
      .fill(notificationEmail);
    await page.getByRole('textbox', { name: 'IBAN' }).fill(` ${iban} `);
    await page
      .getByRole('textbox', { name: 'PayPal email' })
      .fill(` ${paypalEmail} `);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(editDialog).toHaveCount(0);
    await expect(
      page.getByText(`Notifications: ${notificationEmail}`),
    ).toBeVisible();
    await expect(page.getByText(`Login: ${originalUser.email}`)).toBeVisible();

    const updatedUser = await database.query.users.findFirst({
      where: { id: regularUser.id },
    });
    expect(updatedUser?.communicationEmail).toBe(notificationEmail);
    expect(updatedUser?.iban).toBe(iban);
    expect(updatedUser?.paypalEmail).toBe(paypalEmail);
  } finally {
    await database
      .update(schema.users)
      .set({
        communicationEmail: originalUser.communicationEmail,
        firstName: originalUser.firstName,
        iban: originalUser.iban,
        lastName: originalUser.lastName,
        paypalEmail: originalUser.paypalEmail,
      })
      .where(eq(schema.users.id, regularUser.id));
  }
});
