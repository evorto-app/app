import type { Browser, Locator, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { adminStateFile, organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import {
  type OrganizerSignupScenario,
  seedOrganizerSignupScenario,
} from '../../support/utils/organizer-signup-scenario';

test.use({ storageState: organizerStateFile, trace: 'on-first-retry' });
test.setTimeout(150_000);

const registrationCard = (page: Page, title: string): Locator =>
  page.locator('app-event-registration-option').filter({
    has: page.getByRole('heading', {
      exact: true,
      level: 3,
      name: title,
    }),
  });

const waitForHydratedAction = async (action: Locator): Promise<void> => {
  await expect(action).toBeVisible({ timeout: 20_000 });
  await expect(action).not.toHaveAttribute('jsaction', /click/, {
    timeout: 20_000,
  });
  await expect(action).toBeEnabled();
};

const openEventFromNavigation = async (
  page: Page,
  scenario: OrganizerSignupScenario,
): Promise<void> => {
  await page.goto('/');
  const eventsNavigation = page
    .getByRole('link', { exact: true, name: 'Events' })
    .first();
  await expect(eventsNavigation).toBeVisible();
  await eventsNavigation.click();
  await expect(
    page
      .getByRole('heading', { exact: true, level: 1, name: 'Events' })
      .first(),
  ).toBeVisible();

  const eventLink = page
    .locator(`a[href="/events/${scenario.event.id}"]`)
    .first();
  await expect(eventLink).toBeVisible({ timeout: 20_000 });
  await eventLink.click();
  await expect(page).toHaveURL(new RegExp(`/events/${scenario.event.id}$`));
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: scenario.event.title,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await waitForRegistrationPage(page);
};

const openAdminOrganizerOverview = async ({
  browser,
  participantPage,
  scenario,
  testClock,
}: {
  browser: Browser;
  participantPage: Page;
  scenario: OrganizerSignupScenario;
  testClock: DateTime;
}) => {
  const reviewer = await openAuthenticatedTestPage({
    baseUrl: new URL(participantPage.url()).origin,
    browser,
    storageState: adminStateFile,
    tenantDomain: scenario.tenant.domain,
    testClock,
  });

  try {
    await openEventFromNavigation(reviewer.page, scenario);
    const organizeLink = reviewer.page.getByRole('link', {
      exact: true,
      name: 'Organize this event',
    });
    await expect(organizeLink).toBeVisible({ timeout: 20_000 });
    await organizeLink.click();
    await expect(
      reviewer.page.getByRole('heading', {
        exact: true,
        level: 2,
        name: 'Organizer/helper team',
      }),
    ).toBeVisible({ timeout: 20_000 });
    return reviewer;
  } catch (error) {
    await reviewer.context.close();
    throw error;
  }
};

test.describe('Organizer and helper signup', () => {
  test('Sign up, use event access, and cancel', async ({
    database,
    page,
    registerDatabaseCleanup,
    seeded,
  }, testInfo) => {
    const scenario = await seedOrganizerSignupScenario({
      database,
      mode: 'simple',
      seeded,
    });
    registerDatabaseCleanup(() => scenario.cleanup());

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
This guide is for a signed-in organization member who wants to help run an event. The event must be published, its registration window must be open, the organizer/helper category must have capacity, and your organization role must be eligible for that category.

Organizer/helper registrations never include guests or a waitlist. If you are attending instead of helping, use a **Participant registration option**. Evorto allows one active registration per person and event, so cancel an existing participant registration before choosing an organizer/helper category, or cancel the organizer/helper registration before registering as a participant.
{% /callout %}

# Sign up as an organizer or helper

1. Sign in to Evorto.
2. Select **Events** in the main navigation.
3. Open the event you will help run.
4. Find **Organizer/helper opportunities**, then review the category title, description, role eligibility, and dates.

The separate **Participant registration options** group is for people attending the event. Do not use that group when you need event-management access.
`,
    });

    await openEventFromNavigation(page, scenario);
    const organizerCard = registrationCard(
      page,
      scenario.organizerOption.title,
    );
    await expect(organizerCard).toBeVisible();
    await expect(
      organizerCard.getByText('Organizer/helper option', { exact: true }),
    ).toBeVisible();
    await expect(
      organizerCard.getByText(
        'Use this option when you are helping run the event.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(organizerCard.getByLabel('Guests')).toHaveCount(0);
    await expect(
      organizerCard.getByRole('button', { name: 'Join waitlist' }),
    ).toHaveCount(0);
    const signupAction = organizerCard.getByRole('button', {
      exact: true,
      name: 'Sign up as organizer/helper',
    });
    await waitForHydratedAction(signupAction);
    await takeScreenshot(
      testInfo,
      organizerCard,
      page,
      'Review the organizer or helper category before signing up',
    );

    await testInfo.attach('markdown', {
      body: `
## Confirm the organizer/helper registration

Select **Sign up as organizer/helper**. A free first-come, first-served category confirms immediately when you remain eligible and capacity is still available. The event page then shows **Organizer/helper registration confirmed**, your organizer/helper pass, and **Organize this event**.

The pass identifies this as an organizer/helper registration. Event-management access begins only after the registration is confirmed; copying an organizer link does not grant access.
`,
    });

    await signupAction.click();
    const activeRegistration = page.locator('app-event-active-registration');
    await expect(activeRegistration).toBeVisible({ timeout: 20_000 });
    await expect(
      activeRegistration.getByText('Organizer/helper registration confirmed', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      activeRegistration.getByText('Your organizer/helper pass', {
        exact: true,
      }),
    ).toBeVisible();
    const organizeLink = page.getByRole('link', {
      exact: true,
      name: 'Organize this event',
    });
    await expect(organizeLink).toBeVisible({ timeout: 20_000 });
    await takeScreenshot(
      testInfo,
      activeRegistration,
      page,
      'Confirmed organizer or helper registration and pass',
    );

    await testInfo.attach('markdown', {
      body: `
## Check the registration in your profile

1. Select **Profile** in the main navigation.
2. Select **Events**.
3. Find the event card.

The card identifies the registration **Type** as **Organizer/helper**, labels the event-page credential as a **Pass**, and links back to the event. Pending applications are also labeled as organizer/helper applications, but they do not grant event-management access.
`,
    });

    await page
      .getByRole('link', { exact: true, name: 'Profile' })
      .first()
      .click();
    await page.getByRole('button', { exact: true, name: 'Events' }).click();
    const profileEvent = page.locator('article').filter({
      has: page.getByRole('heading', {
        exact: true,
        name: scenario.event.title,
      }),
    });
    await expect(profileEvent).toBeVisible();
    await expect(
      profileEvent.getByText('Organizer/helper', { exact: true }),
    ).toBeVisible();
    await expect(
      profileEvent.getByText('Pass:', { exact: true }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      profileEvent,
      page,
      'Organizer or helper registration in the profile',
    );

    const openEventPage = profileEvent.getByRole('link', {
      exact: true,
      name: 'Open event page',
    });
    await openEventPage.click();
    await waitForRegistrationPage(page);
    await organizeLink.click();
    const organizerTeam = page.getByRole('region', {
      name: 'Organizer/helper team',
    });
    await expect(organizerTeam).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole('region', { name: 'Participant registrations' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('main'),
      page,
      'Organizer overview separates the team from participants',
    );

    await testInfo.attach('markdown', {
      body: `
## Use the organizer overview

Select **Organize this event** to open the event-scoped overview. **Organizer/helper team** and **Participant registrations** are separate groups. Buttons appear only for operations your account is authorized to perform. If your access changes before you submit, Evorto blocks the action.

{% callout type="warning" title="Access ends when the registration ends" %}
Cancelling a confirmed organizer/helper registration immediately releases its capacity and removes its event-scoped organizer access. A saved or copied organizer URL then opens **Access not allowed**. Other independent permissions, such as an administrator's broad event permission, are not removed.
{% /callout %}
`,
    });

    await page
      .getByRole('link', { exact: true, name: 'Back to event' })
      .click();
    await waitForRegistrationPage(page);
    const cancelRegistration = page.getByRole('button', {
      exact: true,
      name: 'Cancel registration',
    });
    await waitForHydratedAction(cancelRegistration);
    await cancelRegistration.click();
    const cancellationDialog = page.getByRole('dialog', {
      name: 'Cancel your registration?',
    });
    await expect(cancellationDialog).toBeVisible();
    await takeScreenshot(
      testInfo,
      cancellationDialog,
      page,
      'Confirm the organizer or helper cancellation',
    );
    await cancellationDialog
      .getByRole('button', { exact: true, name: 'Confirm cancellation' })
      .click();
    await expect(page.locator('app-event-active-registration')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(organizeLink).toHaveCount(0, { timeout: 20_000 });

    await page.goto(`/events/${scenario.event.id}/organize`);
    await expect(page).toHaveURL(/\/403$/);
    await expect(
      page.getByRole('heading', { exact: true, name: 'Access not allowed' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-not-allowed'),
      page,
      'A copied organizer URL remains protected after cancellation',
    );

    await testInfo.attach('markdown', {
      body: `
After cancellation, the event offers the eligible signup choices again and the cancelled registration is removed from the active events list in your profile. Choose a new category only if you intend to create a new registration.
`,
    });
  });

  test('Apply for an advanced organizer category', async ({
    browser,
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    testClock,
  }, testInfo) => {
    const scenario = await seedOrganizerSignupScenario({
      database,
      mode: 'advanced',
      seeded,
    });
    registerDatabaseCleanup(() => scenario.cleanup());
    let reviewer:
      Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

    try {
      await testInfo.attach('markdown', {
        body: `
{% callout type="note" title="Before you start" %}
Advanced events can have several organizer/helper categories, each with its own role eligibility, capacity, dates, questions, price, and approval mode. Evorto shows only the categories your account is eligible to use.

An application does not confirm organizer access, reserve capacity, or create a pass. An authorized organizer must approve it first. This example uses a free category, so approval can confirm it immediately. For a paid category, approval prepares Stripe Checkout and organizer access starts only after Stripe reports successful payment.
{% /callout %}

# Apply for an advanced organizer or helper category

1. Select **Events** and open the event.
2. In **Organizer/helper opportunities**, choose the category that matches the work you will do.
3. Read the application explanation, then select **Apply as organizer/helper**.

The signed-in member is eligible for **Lead organizer application**. **Event helper application** is hidden because it requires a different organization role. **Attendee** remains a separate participant choice.
`,
      });

      await openEventFromNavigation(page, scenario);
      const applicationCard = registrationCard(
        page,
        scenario.organizerOption.title,
      );
      await expect(applicationCard).toBeVisible();
      await expect(
        applicationCard.getByText('Organizer/helper application', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        applicationCard.getByText(
          'Applying does not confirm organizer access. An organizer reviews your application first; if this option has a fee, payment starts only after approval.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        registrationCard(page, scenario.participantOption.title),
      ).toBeVisible();
      if (!scenario.hiddenOrganizerOption) {
        throw new Error('Expected an advanced role-restricted category');
      }
      await expect(
        page.getByRole('heading', {
          exact: true,
          level: 3,
          name: scenario.hiddenOrganizerOption.title,
        }),
      ).toHaveCount(0);
      await expect(applicationCard.getByLabel('Guests')).toHaveCount(0);
      await expect(
        applicationCard.getByRole('button', { name: 'Join waitlist' }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        applicationCard,
        page,
        'Review an eligible advanced organizer application',
      );

      const applyAction = applicationCard.getByRole('button', {
        exact: true,
        name: 'Apply as organizer/helper',
      });
      await waitForHydratedAction(applyAction);
      await applyAction.click();
      const pendingApplication = page.locator('app-event-active-registration');
      await expect(pendingApplication).toContainText(
        'Organizer/helper application pending',
        { timeout: 20_000 },
      );
      await expect(
        page.getByRole('link', {
          exact: true,
          name: 'Organize this event',
        }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        pendingApplication,
        page,
        'Organizer application awaiting review',
      );

      const [firstApplication] =
        await database.query.eventRegistrations.findMany({
          where: {
            eventId: scenario.event.id,
            registrationOptionId: scenario.organizerOption.id,
            status: 'PENDING',
            tenantId: scenario.tenant.id,
            userId: scenario.applicant.id,
          },
        });
      if (!firstApplication) {
        throw new Error('Expected a pending organizer/helper application');
      }
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
            waitlistSpots: true,
          },
          where: { id: scenario.organizerOption.id },
        }),
      ).toEqual({
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 0,
      });
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: firstApplication.id },
        }),
      ).toHaveLength(0);

      await testInfo.attach('markdown', {
        body: `
## Withdraw before approval

The event page shows **Organizer/helper application pending**. You cannot open the organizer overview, and no QR pass is available yet.

To withdraw while the application is pending:

1. Select **Cancel registration** on the pending application.
2. Read **Cancel your pending registration?**. The confirmation explains that no confirmed capacity is released and no refund starts.
3. Select **Keep registration** to leave the pending application unchanged, or **Confirm cancellation** to withdraw it. **Keep registration** receives focus when the dialog opens to protect against an accidental Enter key.

Withdrawal keeps the first application in the history as **Cancelled**. Because a pending application never granted organizer/helper access, the organizer overview and pass remain unavailable. Capacity and payment state remain unchanged.
`,
      });

      await expect(
        pendingApplication.getByText(
          'This withdraws your pending application before organizer approval.',
          { exact: true },
        ),
      ).toBeVisible();
      const cancelApplication = pendingApplication.getByRole('button', {
        exact: true,
        name: 'Cancel registration',
      });
      await waitForHydratedAction(cancelApplication);
      await cancelApplication.click();
      const cancellationDialog = page.getByRole('dialog', {
        name: 'Cancel your pending registration?',
      });
      await expect(cancellationDialog).toBeVisible();
      await expect(
        cancellationDialog.getByText(
          'This immediately withdraws your pending application. It does not release confirmed capacity or start a refund. This action cannot be undone.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        cancellationDialog.getByRole('button', {
          exact: true,
          name: 'Keep registration',
        }),
      ).toBeFocused();
      await takeScreenshot(
        testInfo,
        cancellationDialog,
        page,
        'Confirm withdrawal of the organizer application',
      );
      await cancellationDialog
        .getByRole('button', { exact: true, name: 'Confirm cancellation' })
        .click();
      await expect(pendingApplication).toHaveCount(0, { timeout: 20_000 });
      await expect(
        applicationCard.getByRole('button', {
          exact: true,
          name: 'Apply as organizer/helper',
        }),
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => {
          const persistedApplication =
            await database.query.eventRegistrations.findFirst({
              where: { id: firstApplication.id },
            });
          const option =
            await database.query.eventRegistrationOptions.findFirst({
              columns: {
                confirmedSpots: true,
                reservedSpots: true,
                waitlistSpots: true,
              },
              where: { id: scenario.organizerOption.id },
            });
          const transactions = await database.query.transactions.findMany({
            where: { eventRegistrationId: firstApplication.id },
          });
          return {
            option,
            paymentCount: transactions.length,
            status: persistedApplication?.status,
          };
        })
        .toEqual({
          option: {
            confirmedSpots: 0,
            reservedSpots: 0,
            waitlistSpots: 0,
          },
          paymentCount: 0,
          status: 'CANCELLED',
        });

      await page.goto(`/events/${scenario.event.id}/organize`);
      await expect(page).toHaveURL(/\/403$/);
      await expect(
        page.getByRole('heading', {
          exact: true,
          name: 'Access not allowed',
        }),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        page.locator('app-not-allowed'),
        page,
        'Pending application withdrawal leaves organizer access unavailable',
      );

      await testInfo.attach('markdown', {
        body: `
## Apply again

If you withdrew by mistake or your plans change again, return through **Events**, open the event, and select **Apply as organizer/helper**. Registration must still be open and your role must still be eligible.

Evorto creates a new pending application for review. The earlier **Cancelled** application remains in the audit history; it is not restored or silently overwritten. The new application still reserves no capacity, starts no payment, and grants no organizer/helper access before approval.
`,
      });

      await openEventFromNavigation(page, scenario);
      const reapplyAction = registrationCard(
        page,
        scenario.organizerOption.title,
      ).getByRole('button', {
        exact: true,
        name: 'Apply as organizer/helper',
      });
      await waitForHydratedAction(reapplyAction);
      await reapplyAction.click();
      const reappliedCard = page.locator('app-event-active-registration');
      await expect(reappliedCard).toContainText(
        'Organizer/helper application pending',
        { timeout: 20_000 },
      );
      const applicantRegistrations =
        await database.query.eventRegistrations.findMany({
          where: {
            eventId: scenario.event.id,
            registrationOptionId: scenario.organizerOption.id,
            tenantId: scenario.tenant.id,
            userId: scenario.applicant.id,
          },
        });
      expect(applicantRegistrations).toHaveLength(2);
      expect(
        applicantRegistrations.find(
          (registration) => registration.id === firstApplication.id,
        ),
      ).toEqual(expect.objectContaining({ status: 'CANCELLED' }));
      const reappliedApplication = applicantRegistrations.find(
        (registration) =>
          registration.id !== firstApplication.id &&
          registration.status === 'PENDING',
      );
      if (!reappliedApplication) {
        throw new Error('Expected a new pending organizer/helper application');
      }
      expect(
        await database.query.transactions.findMany({
          where: { eventRegistrationId: reappliedApplication.id },
        }),
      ).toHaveLength(0);
      expect(
        await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
            waitlistSpots: true,
          },
          where: { id: scenario.organizerOption.id },
        }),
      ).toEqual({
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 0,
      });
      await takeScreenshot(
        testInfo,
        reappliedCard,
        page,
        'New organizer application after withdrawal',
      );

      await testInfo.attach('markdown', {
        body: `
## Wait for an organizer to review the new application

An authorized reviewer follows this path:

1. Open the same event.
2. Select **Organize this event**.
3. Open **Organizer/helper team**.
4. Find the application and select **Approve application**.

Receipt-only or otherwise limited overview users do not see approval, transfer, or cancellation buttons they are not allowed to use.
`,
      });

      reviewer = await openAdminOrganizerOverview({
        browser,
        participantPage: page,
        scenario,
        testClock,
      });
      const organizerTeam = reviewer.page.getByRole('region', {
        name: 'Organizer/helper team',
      });
      const optionPanel = organizerTeam
        .getByRole('heading', {
          exact: true,
          level: 3,
          name: scenario.organizerOption.title,
        })
        .locator('..');
      await expect(
        optionPanel.getByText(
          `${scenario.applicant.firstName} ${scenario.applicant.lastName}`,
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        optionPanel.getByText('Awaiting approval', { exact: true }),
      ).toBeVisible();
      await expect(
        optionPanel.getByText('Awaiting approval', { exact: true }),
      ).toHaveCount(1);
      await takeScreenshot(
        testInfo,
        organizerTeam,
        reviewer.page,
        'Review the pending organizer application',
      );
      const approveApplication = optionPanel.getByRole('button', {
        exact: true,
        name: 'Approve application',
      });
      await waitForHydratedAction(approveApplication);
      await approveApplication.click();
      await expect(
        reviewer.page.getByText('Registration confirmed', { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(approveApplication).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        organizerTeam,
        reviewer.page,
        'Confirmed member in the organizer or helper team',
      );

      await testInfo.attach('markdown', {
        body: `
## Confirm access after approval

Reload the applicant's event page after approval. This free application now shows **Organizer/helper registration confirmed**, the organizer/helper pass, and **Organize this event**. A paid category remains pending until Stripe payment succeeds; the pass and organizer access do not appear before that success.
`,
      });

      await expect
        .poll(async () => {
          const persistedFirstApplication =
            await database.query.eventRegistrations.findFirst({
              where: { id: firstApplication.id },
            });
          const persistedReapplication =
            await database.query.eventRegistrations.findFirst({
              where: { id: reappliedApplication.id },
            });
          const option =
            await database.query.eventRegistrationOptions.findFirst({
              columns: { confirmedSpots: true, reservedSpots: true },
              where: { id: scenario.organizerOption.id },
            });
          return {
            firstStatus: persistedFirstApplication?.status,
            option,
            reappliedStatus: persistedReapplication?.status,
          };
        })
        .toEqual({
          firstStatus: 'CANCELLED',
          option: { confirmedSpots: 1, reservedSpots: 0 },
          reappliedStatus: 'CONFIRMED',
        });

      await page.reload();
      await waitForRegistrationPage(page);
      await expect(
        page.getByText('Organizer/helper registration confirmed', {
          exact: true,
        }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByText('Your organizer/helper pass', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          exact: true,
          name: 'Organize this event',
        }),
      ).toBeVisible();
      await takeScreenshot(
        testInfo,
        page.locator('app-event-active-registration'),
        page,
        'Approved organizer application with event access',
      );
    } finally {
      await reviewer?.context.close();
    }
  });
});
