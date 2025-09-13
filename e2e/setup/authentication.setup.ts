import { stat } from 'node:fs/promises';

import { usersToAuthenticate } from '../../helpers/user-data';
import { test as setup } from './../fixtures/base-test';

for (const userData of usersToAuthenticate) {
  setup(`authenticate ${userData.email}`, async ({ page }) => {
    const fileStats = await stat(userData.stateFile).catch(() => {
      return;
    });
    if (fileStats && fileStats.mtimeMs > Date.now() - 1000 * 60 * 60 * 24) {
      return;
    }
    await page.goto('./login');
    await page.getByRole('textbox', { name: 'Email address' }).fill(userData.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(userData.password);
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.waitForURL('./events');
    await page.context().storageState({ path: userData.stateFile });
  });
}
