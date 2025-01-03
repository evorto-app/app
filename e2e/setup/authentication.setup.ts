import { usersToAuthenticate } from '../../helpers/user-data';
import { test as setup } from './../fixtures/base-test';

for (const userData of usersToAuthenticate) {
  setup(`authenticate ${userData.email}`, async ({ page }) => {
    await page.goto('./login');
    await page.getByLabel('Email address').fill(userData.email);
    await page.getByLabel('Password').fill(userData.password);
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.waitForURL('./events/list');
    await page.context().storageState({ path: userData.stateFile });
  });
}
