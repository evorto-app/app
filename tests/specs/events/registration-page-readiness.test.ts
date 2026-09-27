import { expect, test } from '@playwright/test';

import { waitForRegistrationPage } from '../../support/utils/event-registration-page';

// These are controlled browser inputs for the readiness helper. Full event
// journeys cover the application's rendered content.
const eventFailure = '<h2>Event could not be loaded</h2>';
const signUpHeading = '<h2>Your sign-up</h2>';
const signUpFailure = '<h3>Sign-up details could not be loaded</h3>';

for (const scenario of [
  {
    expected: { message: 'Event details failed to load', status: 'failed' },
    markup: `<div role="alert">${eventFailure}</div>`,
    title: 'fails promptly on the actual event-load failure heading',
  },
  {
    expected: {
      message: 'Event registration status failed to load',
      status: 'failed',
    },
    markup: `${signUpHeading}<div role="alert">${signUpFailure}</div>`,
    title: 'fails promptly on the actual sign-up-load failure heading',
  },
  {
    expected: { status: 'ready' },
    markup: `${signUpHeading}<button>Sign up</button><div hidden>${eventFailure}${signUpFailure}</div>`,
    title: 'accepts a ready sign-up page and ignores hidden failure headings',
  },
]) {
  test(scenario.title, async ({ page }) => {
    test.setTimeout(6_000);
    await page.context().setOffline(true);
    await page.setContent(`
      <app-event-list>
        <router-outlet></router-outlet>
        <ng-component aria-busy="false">${scenario.markup}</ng-component>
      </app-event-list>
    `);

    const completion = waitForRegistrationPage(page).then(
      () => ({ status: 'ready' as const }),
      (error: unknown) => ({
        message: error instanceof Error ? error.message : String(error),
        status: 'failed' as const,
      }),
    );
    let outcome: Awaited<typeof completion> | undefined;
    const settled = completion.then((result) => {
      outcome = result;
    });
    const failures: unknown[] = [];
    try {
      // Error states must fail without waiting for the helper's 20-second
      // readiness timeout. Poll the actual helper outcome, not elapsed timing.
      await expect
        .poll(() => outcome, { timeout: 2_000 })
        .toEqual(scenario.expected);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await page.close();
      } catch (error) {
        failures.push(error);
      }
      await settled;
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Readiness test and page cleanup failed',
      );
    }
  });
}
