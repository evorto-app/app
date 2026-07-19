import { eq } from 'drizzle-orm';
import type { Locator } from '@playwright/test';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

const fillControlledTextField = async (field: Locator, value: string) => {
  await expect(field).not.toHaveClass(/mat-input-server/);
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
};

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

    const editProfileButton = page.getByRole('button', {
      name: 'Edit profile',
    });
    await expect(editProfileButton).toBeVisible();
    // SSR exposes the button before Angular attaches its live click listener.
    // Event replay removes `jsaction` once the hydrated action is interactive.
    await expect(editProfileButton).not.toHaveAttribute('jsaction', /click/);
    await editProfileButton.click();

    const editDialog = page.getByRole('dialog', { name: 'Edit profile' });
    await expect(editDialog).toBeVisible();
    const firstNameInput = editDialog.getByRole('textbox', {
      exact: true,
      name: 'First name',
    });
    const notificationEmailInput = editDialog.getByRole('textbox', {
      exact: true,
      name: 'Notification email',
    });
    const ibanInput = editDialog.getByRole('textbox', {
      exact: true,
      name: 'IBAN (for reimbursements)',
    });
    const paypalEmailInput = editDialog.getByRole('textbox', {
      exact: true,
      name: 'PayPal email (for reimbursements)',
    });
    const saveButton = editDialog.getByRole('button', {
      exact: true,
      name: 'Save',
    });
    const editForm = editDialog.locator('form');

    // The dialog is created after page hydration. Wait for its Signal Form to
    // expose the seeded model before sending input events to its controls.
    await expect(editForm).not.toHaveAttribute('jsaction', /submit/);
    await expect(firstNameInput).toHaveValue(originalUser.firstName);
    await expect(notificationEmailInput).toHaveValue(
      originalUser.communicationEmail ?? originalUser.email,
    );
    await expect(ibanInput).toHaveValue(originalUser.iban ?? '');
    await expect(paypalEmailInput).toHaveValue(originalUser.paypalEmail ?? '');
    await expect(saveButton).toBeEnabled();

    await fillControlledTextField(firstNameInput, '');
    await expect(saveButton).toBeDisabled();
    await fillControlledTextField(firstNameInput, originalUser.firstName);
    await fillControlledTextField(notificationEmailInput, notificationEmail);
    await fillControlledTextField(ibanInput, ` ${iban} `);
    await fillControlledTextField(paypalEmailInput, ` ${paypalEmail} `);

    // Keep every signal-backed field stable through the final form update.
    await expect(firstNameInput).toHaveValue(originalUser.firstName);
    await expect(notificationEmailInput).toHaveValue(notificationEmail);
    await expect(ibanInput).toHaveValue(` ${iban} `);
    await expect(paypalEmailInput).toHaveValue(` ${paypalEmail} `);
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect(editDialog).toHaveCount(0);
    await expect(
      page.getByText(`Notifications: ${notificationEmail}`),
    ).toBeVisible();
    await expect(page.getByText(`Login: ${originalUser.email}`)).toBeVisible();

    const updatedUser = await database.query.users.findFirst({
      where: { id: regularUser.id },
    });
    if (!updatedUser) {
      throw new Error('Expected regular profile user after profile update');
    }
    expect(updatedUser.communicationEmail).toBe(notificationEmail);
    expect(updatedUser.iban).toBe(iban);
    expect(updatedUser.paypalEmail).toBe(paypalEmail);
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
