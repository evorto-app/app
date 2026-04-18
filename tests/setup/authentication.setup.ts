import fs from 'node:fs';
import path from 'node:path';

import { usersToAuthenticate } from '../../helpers/user-data';
import { test as setup } from '../support/fixtures/base-test';

const runtimePath = path.resolve('.e2e-runtime.json');

const readRuntime = (): { tenantDomain?: string } | undefined => {
  if (!fs.existsSync(runtimePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as {
    tenantDomain?: string;
  };
};

const waitForRuntime = async (
  timeoutMs = 30_000,
): Promise<{ tenantDomain?: string }> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const runtime = readRuntime();
    if (runtime) {
      return runtime;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for ${runtimePath} to be written by database.setup.ts`,
  );
};

for (const userData of usersToAuthenticate) {
  setup(`authenticate ${userData.email}`, async ({ page }) => {
    const runtime = await waitForRuntime();

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

    await page.context().storageState({ path: userData.stateFile });
  });
}
