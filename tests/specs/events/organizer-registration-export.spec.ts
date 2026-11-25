import { DateTime } from 'luxon';

import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { localTestTenantDomainHeader } from '../../../src/shared/request-routing';
import { expect, test } from '../../support/fixtures/axe-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { seedOrganizerRegistrationExportScenario } from '../../support/utils/organizer-registration-export-scenario';

test.use({ storageState: adminStateFile, trace: 'on-first-retry' });
test.setTimeout(120_000);

const exportPath = (eventId: string): string =>
  `/exports/events/${eventId}/registrations.csv`;

const csvLines = (content: string): string[] => {
  expect(content.codePointAt(0)).toBe(0xfe_ff);
  return content
    .slice(1)
    .split('\r\n')
    .filter((line) => line.length > 0);
};

test('organizer downloads the registrations CSV from the event actions menu', async ({
  database,
  makeAxeBuilder,
  page,
  registerDatabaseCleanup,
  seeded,
}) => {
  const scenario = await seedOrganizerRegistrationExportScenario({
    database,
    seeded,
  });
  registerDatabaseCleanup(() => scenario.cleanup());

  await page.goto(`/events/${scenario.event.id}/organize`);
  await expect(
    page.getByRole('heading', { exact: true, level: 2, name: 'Overview' }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Open event actions' }).click();
  const downloadItem = page.getByRole('menuitem', {
    exact: true,
    name: 'Download CSV of registrations',
  });
  await expect(downloadItem).toBeVisible();
  await expect(downloadItem).toHaveAttribute(
    'href',
    exportPath(scenario.event.id),
  );
  await expect(downloadItem).toHaveAttribute('download', '');

  const accessibility = await makeAxeBuilder()
    .include('.mat-mdc-menu-panel')
    .analyze();
  expect(accessibility.violations).toEqual([]);

  // The menu item is a plain browser download link. Fetch the same URL with
  // this page's session: the test harness routes the tenant through a request
  // header, which a native download navigation does not carry.
  const response = await page.request.get(exportPath(scenario.event.id), {
    headers: { [localTestTenantDomainHeader]: scenario.tenant.domain },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(response.headers()['cache-control']).toBe('private, no-store');
  expect(response.headers()['content-disposition']).toMatch(
    /^attachment; filename="[a-z0-9-]+-registrations\.csv"; filename\*=UTF-8''/,
  );

  const lines = csvLines(await response.text());
  expect(lines[0]).toBe(
    `First name,Last name,Email,Registration option,Organizer,Status,Checked in,Check-in time,${scenario.questionTitle}`,
  );
  const dataLines = lines.slice(1);
  expect(dataLines).toHaveLength(2);

  const checkInText = DateTime.fromJSDate(scenario.checkInTime, {
    zone: scenario.tenant.timezone,
  }).toFormat('yyyy-MM-dd HH:mm');
  const { checkedIn, questionAnswer, cancelled } = scenario;
  expect(dataLines).toContain(
    [
      checkedIn.firstName,
      checkedIn.lastName,
      checkedIn.communicationEmail,
      scenario.optionTitle,
      'No',
      'Confirmed',
      'Yes',
      checkInText,
      '',
    ].join(','),
  );
  expect(dataLines).toContain(
    [
      questionAnswer.firstName,
      questionAnswer.lastName,
      questionAnswer.communicationEmail,
      scenario.optionTitle,
      'No',
      'Confirmed',
      'No',
      '',
      `'${scenario.formulaAnswer}`,
    ].join(','),
  );
  expect(lines.join('\n')).not.toContain(cancelled.communicationEmail);
});

test('registrations CSV rejects anonymous and non-organizer requests', async ({
  baseURL,
  browser,
  database,
  registerDatabaseCleanup,
  seeded,
  testClock,
}) => {
  const scenario = await seedOrganizerRegistrationExportScenario({
    database,
    seeded,
  });
  registerDatabaseCleanup(() => scenario.cleanup());
  if (!baseURL) {
    throw new Error('Expected a configured Playwright baseURL.');
  }
  const headers = { [localTestTenantDomainHeader]: scenario.tenant.domain };

  // Contexts created in a test inherit test.use options, so clear the
  // admin session explicitly.
  const anonymousContext = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const response = await anonymousContext.request.get(
      exportPath(scenario.event.id),
      { headers, maxRedirects: 0 },
    );
    expect(response.status()).toBe(401);
  } finally {
    await anonymousContext.close();
  }

  const member = await openAuthenticatedTestPage({
    baseUrl: baseURL,
    browser,
    storageState: userStateFile,
    tenantDomain: scenario.tenant.domain,
    testClock,
  });
  try {
    const response = await member.context.request.get(
      exportPath(scenario.event.id),
      { headers, maxRedirects: 0 },
    );
    expect(response.status()).toBe(403);
  } finally {
    await member.close();
  }
});
