import { stat } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

import { usersToAuthenticate } from '../../helpers/user-data';
import { test as setup } from './../fixtures/base-test';
import { isStorageStateFresh, readStorageState } from '../utils/storage-state';

for (const userData of usersToAuthenticate) {
  setup(`authenticate ${userData.email}`, async ({ page }) => {
    const runtimePath = path.resolve('.e2e-runtime.json');
    const runtime = fs.existsSync(runtimePath)
      ? (JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as {
          tenantDomain?: string;
        })
      : {};

    const fresh = isStorageStateFresh({
      maxAgeMs: 1000 * 60 * 60 * 24,
      pathname: userData.stateFile,
      tenantDomain: runtime.tenantDomain,
    });
    if (fresh) return;
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email address' }).fill(userData.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(userData.password);
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();
    await page.waitForURL(/\/events(\?.*)?$/);
    // Save state with correct tenant cookie if present
    if (runtime.tenantDomain) {
      await page.context().addCookies([
        {
          domain: 'localhost',
          expires: -1,
          name: 'evorto-tenant',
          path: '/',
          value: runtime.tenantDomain,
        },
      ]);
    }
    await page.context().storageState({ path: userData.stateFile });
  });
}
