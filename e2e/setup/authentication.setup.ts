import fs from 'node:fs';
import path from 'node:path';

import { usersToAuthenticate } from '../../helpers/user-data';
import { test as setup } from './../fixtures/base-test';

for (const userData of usersToAuthenticate) {
  setup(`authenticate ${userData.email}`, async ({ page }) => {
    const stateFileAgeLimit = 1000 * 60 * 60 * 24; // 24 hours
    const stateFilePath = path.resolve(userData.stateFile);
    const stateFileAge = fs.statSync(stateFilePath).mtimeMs;
    const stateFileAgeLimitExceeded =
      Date.now() - stateFileAge > stateFileAgeLimit;
    if (!stateFileAgeLimitExceeded) return;
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('textbox', { name: 'Email address' })
      .fill(userData.email);
    await page
      .getByRole('textbox', { name: 'Password' })
      .fill(userData.password);
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.waitForURL(/\/events(\?.*)?$/);
    await page.context().storageState({ path: userData.stateFile });
  });
}
