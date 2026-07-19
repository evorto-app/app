import type { Browser, Locator, Page } from '@playwright/test';
import type { DateTime } from 'luxon';

import { adminStateFile, organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/axe-test';
import { openAuthenticatedTestPage } from '../../support/utils/authenticated-test-page';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import {
  type OrganizerSignupScenario,
  seedOrganizerSignupScenario,
} from '../../support/utils/organizer-signup-scenario';

test.use({ storageState: organizerStateFile, trace: 'on-first-retry' });
test.setTimeout(120_000);

const openEventFromNormalNavigation = async (
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

const waitForActiveRegistration = async (page: Page): Promise<Locator> => {
  await waitForRegistrationPage(page);
  const activeRegistration = page.locator('app-event-active-registration');
  await expect(activeRegistration).toBeVisible({ timeout: 20_000 });
  return activeRegistration;
};

const openOrganizerOverview = async (
  page: Page,
  scenario: OrganizerSignupScenario,
): Promise<void> => {
  const organizeLink = page.getByRole('link', {
    exact: true,
    name: 'Organize this event',
  });
  await expect(organizeLink).toBeVisible({ timeout: 20_000 });
  await organizeLink.click();
  await expect(page).toHaveURL(
    new RegExp(`/events/${scenario.event.id}/organize$`),
  );
  await expect(
    page.getByRole('heading', { exact: true, level: 2, name: 'Overview' }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 2,
      name: 'Organizer/helper team',
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 2,
      name: 'Participant registrations',
    }),
  ).toBeVisible({ timeout: 20_000 });
};

const openAdminOrganizerOverview = async ({
  browser,
  page,
  scenario,
  testClock,
}: {
  browser: Browser;
  page: Page;
  scenario: OrganizerSignupScenario;
  testClock: DateTime;
}) => {
  const reviewer = await openAuthenticatedTestPage({
    baseUrl: new URL(page.url()).origin,
    browser,
    storageState: adminStateFile,
    tenantDomain: scenario.tenant.domain,
    testClock,
  });

  try {
    await openEventFromNormalNavigation(reviewer.page, scenario);
    await openOrganizerOverview(reviewer.page, scenario);
    return reviewer;
  } catch (error) {
    await reviewer.context.close();
    throw error;
  }
};

const activeRegistrations = (
  database: Parameters<typeof seedOrganizerSignupScenario>[0]['database'],
  scenario: OrganizerSignupScenario,
) =>
  database.query.eventRegistrations.findMany({
    where: {
      eventId: scenario.event.id,
      status: { NOT: 'CANCELLED' },
      tenantId: scenario.tenant.id,
      userId: scenario.applicant.id,
    },
  });

test('simple organizer signup grants and revokes event-scoped access while preserving registration exclusivity', async ({
  browser,
  database,
  makeAxeBuilder,
  page,
  registerDatabaseCleanup,
  seeded,
  testClock,
}) => {
  const scenario = await seedOrganizerSignupScenario({
    database,
    mode: 'simple',
    seeded,
  });
  registerDatabaseCleanup(() => scenario.cleanup());
  let capacityViewer:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    const persistedEvent = await database.query.eventInstances.findFirst({
      columns: { simpleModeEnabled: true },
      where: {
        id: scenario.event.id,
        tenantId: scenario.tenant.id,
      },
    });
    const persistedOptions =
      await database.query.eventRegistrationOptions.findMany({
        where: { eventId: scenario.event.id },
      });
    expect(persistedEvent).toEqual({ simpleModeEnabled: true });
    expect(persistedOptions).toHaveLength(2);
    expect(
      persistedOptions.filter((option) => option.organizingRegistration),
    ).toHaveLength(1);
    expect(
      persistedOptions.filter((option) => !option.organizingRegistration),
    ).toHaveLength(1);

    await page.goto(`/events/${scenario.event.id}/organize`);
    await expect(page).toHaveURL(/\/403$/);
    await expect(
      page.getByRole('heading', { exact: true, name: 'Access not allowed' }),
    ).toBeVisible();

    await openEventFromNormalNavigation(page, scenario);
    await expect(
      page.getByRole('link', {
        exact: true,
        name: 'Organize this event',
      }),
    ).toHaveCount(0);
    const organizerCard = registrationCard(
      page,
      scenario.organizerOption.title,
    );
    const participantCard = registrationCard(
      page,
      scenario.participantOption.title,
    );
    await expect(organizerCard).toBeVisible();
    await expect(participantCard).toBeVisible();
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
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
    const signupAction = organizerCard.getByRole('button', {
      exact: true,
      name: 'Sign up as organizer/helper',
    });
    await waitForHydratedAction(signupAction);
    await signupAction.click();

    const activeOrganizerRegistration = await waitForActiveRegistration(page);
    await expect(
      activeOrganizerRegistration.getByRole('heading', {
        exact: true,
        level: 3,
        name: scenario.organizerOption.title,
      }),
    ).toBeVisible();
    await expect(
      activeOrganizerRegistration.getByText(
        'Organizer/helper registration confirmed',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      activeOrganizerRegistration.getByText('Your organizer/helper pass', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: 'Register' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        exact: true,
        name: 'Sign up as organizer/helper',
      }),
    ).toHaveCount(0);
    const organizeLink = page.getByRole('link', {
      exact: true,
      name: 'Organize this event',
    });
    await expect(organizeLink).toBeVisible({ timeout: 20_000 });
    expect(
      (
        await makeAxeBuilder()
          .include('app-event-active-registration')
          .analyze()
      ).violations,
    ).toEqual([]);

    await expect
      .poll(async () => {
        const registrations = await activeRegistrations(database, scenario);
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: {
            confirmedSpots: true,
            reservedSpots: true,
            waitlistSpots: true,
          },
          where: { id: scenario.organizerOption.id },
        });
        return {
          activeCount: registrations.length,
          confirmedSpots: option?.confirmedSpots,
          guestCount: registrations[0]?.guestCount,
          optionId: registrations[0]?.registrationOptionId,
          reservedSpots: option?.reservedSpots,
          status: registrations[0]?.status,
          waitlistSpots: option?.waitlistSpots,
        };
      })
      .toEqual({
        activeCount: 1,
        confirmedSpots: 1,
        guestCount: 0,
        optionId: scenario.organizerOption.id,
        reservedSpots: 0,
        status: 'CONFIRMED',
        waitlistSpots: 0,
      });
    const [organizerRegistration] = await activeRegistrations(
      database,
      scenario,
    );
    if (!organizerRegistration) {
      throw new Error('Expected confirmed organizer/helper registration');
    }
    const confirmationEmail = await database.query.emailOutbox.findFirst({
      where: {
        idempotencyKey: `registration-confirmed/${scenario.tenant.id}/${organizerRegistration.id}`,
        kind: 'registrationConfirmed',
        tenantId: scenario.tenant.id,
      },
    });
    expect(confirmationEmail).toMatchObject({
      kind: 'registrationConfirmed',
      toEmail:
        scenario.applicant.communicationEmail ?? scenario.applicant.email,
    });
    expect(confirmationEmail?.html).toContain(`/events/${scenario.event.id}`);

    capacityViewer = await openAuthenticatedTestPage({
      baseUrl: new URL(page.url()).origin,
      browser,
      storageState: adminStateFile,
      tenantDomain: scenario.tenant.domain,
      testClock,
    });
    await openEventFromNormalNavigation(capacityViewer.page, scenario);
    const fullOrganizerCard = registrationCard(
      capacityViewer.page,
      scenario.organizerOption.title,
    );
    await expect(
      fullOrganizerCard.getByText('This option is full.', { exact: true }),
    ).toBeVisible();
    await expect(
      fullOrganizerCard.getByRole('button', {
        name: 'Sign up as organizer/helper',
      }),
    ).toHaveCount(0);
    await expect(
      fullOrganizerCard.getByRole('button', { name: 'Join waitlist' }),
    ).toHaveCount(0);
    await expect(fullOrganizerCard.getByLabel('Guests')).toHaveCount(0);
    await capacityViewer.context.close();
    capacityViewer = undefined;

    await page
      .getByRole('link', { exact: true, name: 'Profile' })
      .first()
      .click();
    await page.getByRole('button', { exact: true, name: 'Events' }).click();
    await expect(
      page.getByRole('heading', {
        exact: true,
        name: 'Your Event Registrations',
      }),
    ).toBeVisible();
    const profileEvent = page.locator('article').filter({
      has: page.getByRole('heading', {
        exact: true,
        name: scenario.event.title,
      }),
    });
    await expect(profileEvent).toBeVisible();
    await expect(
      profileEvent.getByText('Confirmed', { exact: true }),
    ).toBeVisible();
    await expect(
      profileEvent.getByText('Organizer/helper', { exact: true }),
    ).toBeVisible();
    await expect(
      profileEvent.getByText(scenario.organizerOption.title, { exact: true }),
    ).toBeVisible();
    const openEventPage = profileEvent.getByRole('link', {
      exact: true,
      name: 'Open event page',
    });
    await expect(openEventPage).toHaveAttribute(
      'href',
      `/events/${scenario.event.id}`,
    );
    await openEventPage.click();
    await waitForRegistrationPage(page);

    await openOrganizerOverview(page, scenario);
    await expect(
      page.getByRole('heading', {
        exact: true,
        level: 3,
        name: scenario.organizerOption.title,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        `${scenario.applicant.firstName} ${scenario.applicant.lastName}`,
        { exact: true },
      ),
    ).toBeVisible();
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
    await page.setViewportSize({ height: 844, width: 390 });
    await expect(
      page.getByRole('link', { exact: true, name: 'Back to event' }),
    ).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
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
    const cancellationDialog = page.getByRole('dialog');
    await expect(
      cancellationDialog.getByRole('heading', {
        exact: true,
        name: 'Cancel your registration?',
      }),
    ).toBeVisible();
    await expect(
      cancellationDialog.getByRole('button', {
        exact: true,
        name: 'Keep registration',
      }),
    ).toBeFocused();
    expect(
      (await makeAxeBuilder().include('mat-dialog-container').analyze())
        .violations,
    ).toEqual([]);
    await cancellationDialog
      .getByRole('button', { exact: true, name: 'Confirm cancellation' })
      .click();
    await expect(page.locator('app-event-active-registration')).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(organizeLink).toHaveCount(0, { timeout: 20_000 });

    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          where: { id: organizerRegistration.id },
        });
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true },
          where: { id: scenario.organizerOption.id },
        });
        const cancellationEmail = await database.query.emailOutbox.findFirst({
          where: {
            idempotencyKey: `registration-cancelled/${scenario.tenant.id}/${organizerRegistration.id}`,
            kind: 'registrationCancelled',
            tenantId: scenario.tenant.id,
          },
        });
        return {
          confirmedSpots: option?.confirmedSpots,
          emailKind: cancellationEmail?.kind,
          status: registration?.status,
        };
      })
      .toEqual({
        confirmedSpots: 0,
        emailKind: 'registrationCancelled',
        status: 'CANCELLED',
      });

    await page
      .getByRole('link', { exact: true, name: 'Profile' })
      .first()
      .click();
    await page.getByRole('button', { exact: true, name: 'Events' }).click();
    await expect(
      page.getByRole('heading', {
        exact: true,
        name: 'Your Event Registrations',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        exact: true,
        name: scenario.event.title,
      }),
    ).toHaveCount(0);

    await openEventFromNormalNavigation(page, scenario);
    const registerParticipant = registrationCard(
      page,
      scenario.participantOption.title,
    ).getByRole('button', { exact: true, name: 'Register' });
    await waitForHydratedAction(registerParticipant);
    await registerParticipant.click();
    const activeParticipantRegistration = await waitForActiveRegistration(page);
    await expect(
      activeParticipantRegistration.getByRole('heading', {
        exact: true,
        level: 3,
        name: scenario.participantOption.title,
      }),
    ).toBeVisible();
    await expect(
      activeParticipantRegistration.getByText(
        'Your participant registration is confirmed.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        exact: true,
        name: 'Sign up as organizer/helper',
      }),
    ).toHaveCount(0);
    const applicantRegistrations =
      await database.query.eventRegistrations.findMany({
        orderBy: { createdAt: 'asc' },
        where: {
          eventId: scenario.event.id,
          tenantId: scenario.tenant.id,
          userId: scenario.applicant.id,
        },
      });
    expect(applicantRegistrations).toHaveLength(2);
    expect(
      applicantRegistrations.filter(
        (registration) => registration.status !== 'CANCELLED',
      ),
    ).toEqual([
      expect.objectContaining({
        registrationOptionId: scenario.participantOption.id,
        status: 'CONFIRMED',
      }),
    ]);
    expect(
      applicantRegistrations.find(
        (registration) =>
          registration.registrationOptionId === scenario.organizerOption.id,
      ),
    ).toEqual(expect.objectContaining({ status: 'CANCELLED' }));

    await page.goto(`/events/${scenario.event.id}/organize`);
    await expect(page).toHaveURL(/\/403$/);
    await expect(
      page.getByRole('heading', { exact: true, name: 'Access not allowed' }),
    ).toBeVisible();
  } finally {
    await capacityViewer?.context.close();
  }
});

test('advanced organizer application stays pending until an administrator approves it', async ({
  browser,
  database,
  makeAxeBuilder,
  page,
  registerDatabaseCleanup,
  seeded,
  testClock,
}) => {
  const scenario = await seedOrganizerSignupScenario({
    database,
    mode: 'advanced',
    seeded,
  });
  registerDatabaseCleanup(() => scenario.cleanup());
  let reviewer:
    Awaited<ReturnType<typeof openAuthenticatedTestPage>> | undefined;

  try {
    const persistedEvent = await database.query.eventInstances.findFirst({
      columns: { simpleModeEnabled: true },
      where: {
        id: scenario.event.id,
        tenantId: scenario.tenant.id,
      },
    });
    const persistedOptions =
      await database.query.eventRegistrationOptions.findMany({
        where: { eventId: scenario.event.id },
      });
    expect(persistedEvent).toEqual({ simpleModeEnabled: false });
    expect(persistedOptions).toHaveLength(3);
    expect(
      persistedOptions.filter((option) => option.organizingRegistration),
    ).toHaveLength(2);

    await openEventFromNormalNavigation(page, scenario);
    const participantCard = registrationCard(
      page,
      scenario.participantOption.title,
    );
    await expect(participantCard).toBeVisible();
    await expect(
      participantCard.getByText('Participant option', { exact: true }),
    ).toBeVisible();
    await expect(
      participantCard.getByRole('button', { exact: true, name: 'Register' }),
    ).toBeVisible();
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
    await expect(applicationCard.getByLabel('Guests')).toHaveCount(0);
    await expect(
      applicationCard.getByRole('button', { name: 'Join waitlist' }),
    ).toHaveCount(0);
    if (!scenario.hiddenOrganizerOption) {
      throw new Error('Expected advanced hidden organizer option');
    }
    await expect(
      page.getByRole('heading', {
        exact: true,
        level: 3,
        name: scenario.hiddenOrganizerOption.title,
      }),
    ).toHaveCount(0);
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
    const applyAction = applicationCard.getByRole('button', {
      exact: true,
      name: 'Apply as organizer/helper',
    });
    await waitForHydratedAction(applyAction);
    await applyAction.click();

    const pendingApplication = await waitForActiveRegistration(page);
    await expect(pendingApplication).toContainText(
      'Organizer/helper application pending',
    );
    await expect(
      page.getByRole('link', {
        exact: true,
        name: 'Organize this event',
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        exact: true,
        name: 'Apply as organizer/helper',
      }),
    ).toHaveCount(0);
    expect(
      (
        await makeAxeBuilder()
          .include('app-event-active-registration')
          .analyze()
      ).violations,
    ).toEqual([]);

    const [application] = await activeRegistrations(database, scenario);
    if (!application) {
      throw new Error('Expected pending organizer/helper application');
    }
    expect(application).toMatchObject({
      guestCount: 0,
      registrationOptionId: scenario.organizerOption.id,
      status: 'PENDING',
    });
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

    reviewer = await openAdminOrganizerOverview({
      browser,
      page,
      scenario,
      testClock,
    });
    const optionHeading = reviewer.page.getByRole('heading', {
      exact: true,
      level: 3,
      name: scenario.organizerOption.title,
    });
    await expect(optionHeading).toBeVisible();
    const optionPanel = optionHeading.locator('..');
    await expect(
      optionPanel.getByText(
        `${scenario.applicant.firstName} ${scenario.applicant.lastName}`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      optionPanel.getByText('Awaiting approval', { exact: true }),
    ).toBeVisible();
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

    await expect
      .poll(async () => {
        const persistedApplication =
          await database.query.eventRegistrations.findFirst({
            where: { id: application.id },
          });
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: { confirmedSpots: true, reservedSpots: true },
          where: { id: scenario.organizerOption.id },
        });
        const approvalEmails = await database.query.emailOutbox.findMany({
          where: {
            kind: 'manualApproval',
            tenantId: scenario.tenant.id,
          },
        });
        const applicationEmails = approvalEmails.filter((email) =>
          email.idempotencyKey.includes(`/${application.id}/`),
        );
        return {
          confirmedSpots: option?.confirmedSpots,
          emailCount: applicationEmails.length,
          emailRecipient: applicationEmails[0]?.toEmail,
          emailSubject: applicationEmails[0]?.subject,
          reservedSpots: option?.reservedSpots,
          status: persistedApplication?.status,
        };
      })
      .toEqual({
        confirmedSpots: 1,
        emailCount: 1,
        emailRecipient:
          scenario.applicant.communicationEmail ?? scenario.applicant.email,
        emailSubject: 'Registration approved',
        reservedSpots: 0,
        status: 'CONFIRMED',
      });

    await page.reload();
    const confirmedOrganizerRegistration =
      await waitForActiveRegistration(page);
    await expect(
      confirmedOrganizerRegistration.getByText(
        'Organizer/helper registration confirmed',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      confirmedOrganizerRegistration.getByText('Your organizer/helper pass', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', {
        exact: true,
        name: 'Organize this event',
      }),
    ).toBeVisible({ timeout: 20_000 });
    expect(await activeRegistrations(database, scenario)).toEqual([
      expect.objectContaining({
        id: application.id,
        registrationOptionId: scenario.organizerOption.id,
        status: 'CONFIRMED',
      }),
    ]);
  } finally {
    await reviewer?.context.close();
  }
});
