import fs from 'node:fs';
import path from 'node:path';

import { usersToAuthenticate } from '../../helpers/user-data';
import { test as setup } from '../support/fixtures/base-test';

for (const userData of usersToAuthenticate) {
  setup(`authenticate ${userData.email}`, async ({ page }) => {
    const runtimePath = path.resolve('.e2e-runtime.json');
    const runtime = fs.existsSync(runtimePath)
      ? (JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as {
          tenantDomain?: string;
        })
      : {};

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('textbox', { name: 'Email address' })
      .fill(userData.email);
    await page
      .getByRole('textbox', { name: 'Password' })
      .fill(userData.password);
    await page.getByRole('button', { exact: true, name: 'Continue' }).click();

    const eventsPathPattern = /\/events(\?.*)?$/;
    const acceptConsentButton = page.getByRole('button', { name: 'Accept' });
    const reachedEventsWithoutConsent = await page
      .waitForURL(eventsPathPattern, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (!reachedEventsWithoutConsent) {
      const consentVisible = await acceptConsentButton
        .isVisible({ timeout: 4000 })
        .catch(() => false);
      if (consentVisible) {
        await acceptConsentButton.click();
      }

      await page.waitForURL(eventsPathPattern, { timeout: 8000 });
    }

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
