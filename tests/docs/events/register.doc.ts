import { and, eq, inArray } from 'drizzle-orm';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Stripe from 'stripe';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { fillTestCard } from '../../support/utils/fill-test-card';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import {
  seedFreeRegistrationAddon,
  seedRequiredRegistrationQuestion,
} from '../../support/utils/seed-registration-addons';

test.use({ storageState: userStateFile, trace: 'on-first-retry' });

const execFileAsync = promisify(execFile);

const waitForRegistrationStatus = async (page: Page) => {
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached' });
};

const gotoEventDetail = async (page: Page, eventId: string) => {
  const eventUrl = `/events/${eventId}`;
  for (const attempt of [1, 2]) {
    try {
      await page.goto(eventUrl, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`/events/${eventId}`));
      return;
    } catch (error) {
      if (
        attempt === 2 ||
        !(error instanceof Error) ||
        !error.message.includes('net::ERR_ABORTED')
      ) {
        throw error;
      }
      await page
        .waitForFunction(() => document.readyState !== 'loading', undefined, {
          timeout: 500,
        })
        .catch(() => undefined);
    }
  }
};

const requireUserFixture = (
  predicate: (user: (typeof usersToAuthenticate)[number]) => boolean,
  description: string,
) => {
  const user = usersToAuthenticate.find(predicate);
  if (!user) {
    throw new Error(`Expected ${description} user fixture`);
  }

  return user;
};

const resolveServerNow = (): Date => {
  const deterministicNow = process.env['E2E_NOW_ISO']?.trim();
  const serverNow = deterministicNow ? new Date(deterministicNow) : new Date();
  if (Number.isNaN(serverNow.getTime())) {
    throw new Error('Invalid E2E_NOW_ISO value for registration docs');
  }

  return serverNow;
};

const registrationOptionCard = (page: Page, text: string) =>
  page
    .locator('app-event-registration-option')
    .filter({ hasText: text })
    .first();

const activeRegistrationCard = (page: Page, text: string) =>
  page
    .locator('app-event-active-registration')
    .filter({ hasText: text })
    .first();

const stripeCheckoutFormSurface = (page: Page): Locator =>
  page
    .locator('form')
    .filter({
      has: page.getByRole('button', {
        name: /^(Pay|Continue|Submit)|Pay /i,
      }),
    })
    .first();

const readStripeWebhookSecret = async (): Promise<string> => {
  const dockerSecret = await execFileAsync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'stripe',
      'cat',
      '/run/stripe-webhook/signing-secret',
    ],
    { maxBuffer: 64 * 1024, timeout: 5_000 },
  )
    .then(({ stdout }) => stdout.trim())
    .catch(() => '');
  if (dockerSecret) {
    return dockerSecret;
  }

  const environmentSecret = process.env['STRIPE_WEBHOOK_SECRET']?.trim();
  if (environmentSecret) {
    return environmentSecret;
  }

  throw new Error(
    'Unable to read Stripe webhook signing secret from Docker listener or STRIPE_WEBHOOK_SECRET',
  );
};

const replayCheckoutCompletedWebhook = async ({
  request,
  transaction,
}: {
  request: APIRequestContext;
  transaction: {
    eventRegistrationId: null | string;
    id: string;
    stripeCheckoutSessionId: null | string;
    tenantId: string;
  };
}) => {
  if (!transaction.stripeCheckoutSessionId) {
    throw new Error('Cannot replay checkout webhook without a session id');
  }

  const payload = JSON.stringify({
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: transaction.stripeCheckoutSessionId,
        metadata: {
          ...(transaction.eventRegistrationId
            ? { registrationId: transaction.eventRegistrationId }
            : {}),
          tenantId: transaction.tenantId,
          transactionId: transaction.id,
        },
        object: 'checkout.session',
        payment_intent: {
          id: `pi_test_${getId()}`,
          latest_charge: `ch_test_${getId()}`,
        },
        payment_status: 'paid',
        status: 'complete',
      },
    },
    id: `evt_test_${getId()}`,
    livemode: false,
    object: 'event',
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: 'checkout.session.completed',
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: await readStripeWebhookSecret(),
  });

  const delivery = await request.fetch('/webhooks/stripe', {
    data: Buffer.from(payload, 'utf8'),
    failOnStatusCode: false,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    method: 'POST',
  });
  const body = await delivery.text();
  expect(
    delivery.status(),
    `Expected replayed checkout webhook to return 200, received ${delivery.status()} with body "${body}"`,
  ).toBe(200);
};

test.describe('Register for events', () => {
  test.describe.configure({ mode: 'serial', retries: 1 });

  test('Register for a free event', async ({
    database,
    events,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    test.slow();
    const freeEventId = seeded.scenario.events.freeOpen.eventId;
    const freeOptionId = seeded.scenario.events.freeOpen.optionId;
    const freeEvent = events.find((event) => event.id === freeEventId);
    if (!freeEvent) {
      throw new Error(
        `Seeded freeOpen scenario event "${freeEventId}" was not found`,
      );
    }
    const regularUser = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    );
    const addOnId = `addon-${getId().slice(0, 14)}`;
    const serverNow = resolveServerNow();
    const serverOpenUntil = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000);
    const serverFutureEventStart = new Date(
      serverNow.getTime() + 48 * 60 * 60 * 1000,
    );
    const serverFutureEventEnd = new Date(
      serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
    );

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, freeEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: serverOpenUntil,
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, freeOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverFutureEventEnd,
        start: serverFutureEventStart,
      })
      .where(eq(schema.eventInstances.id, freeEventId));
    await seedFreeRegistrationAddon({
      addonId: addOnId,
      database,
      eventId: freeEventId,
      registrationOptionId: freeOptionId,
      title: 'Snack voucher',
    });
    const registrationQuestion = await seedRequiredRegistrationQuestion({
      database,
      eventId: freeEventId,
      registrationOptionId: freeOptionId,
      title: 'Anything organizers should know?',
    });

    const freeEventHref = `/events/${freeEvent.id}`;
    const freeEventLink = page.locator(`a[href="${freeEventHref}"]`).first();

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  To register for an event, open the app and browse the events available to you.
  Click one that interests you to learn more and see the registration options.`,
    });
    await takeScreenshot(
      testInfo,
      freeEventLink,
      page,
      'Events list with the selected free registration event highlighted',
    );
    await freeEventLink.click();
    await expect(page).toHaveURL(/\/events\/[a-z0-9]+$/i);
    await expect(
      page.getByRole('heading', { level: 1, name: freeEvent.title }),
    ).toBeVisible();
    await waitForRegistrationStatus(page);
    await testInfo.attach('markdown', {
      body: `
  After you have selected your event, you can see the event description and your options for registration.
  _Note:_ If you are not logged it, please follow the instructions to do so.

  ### Free events
  Here we will make a distinction for free events and paid events (covered further down).
  Participant options are labeled separately from organizer/helper options, which use **Sign up as organizer/helper** copy when you are helping run the event.
  When a participant option is full, registration changes to a distinct **Join waitlist** action instead of pretending a normal spot is still available. Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.
  If you open a direct event link but your account does not match the roles required by any available option, the event remains visible and the registration area explains that registration is unavailable for your account.`,
    });
    const participantRegistrationCard = registrationOptionCard(
      page,
      'Participant registration',
    );
    await expect(participantRegistrationCard).toBeVisible({ timeout: 20_000 });
    await takeScreenshot(
      testInfo,
      participantRegistrationCard,
      page,
      'Free event registration options with participant and organizer choices',
    );
    await testInfo.attach('markdown', {
      body: `
  Free registration cards can also offer registration-time add-ons and required questions. Choose the quantity you want, answer any required questions, and then register. After registration, selected add-ons are shown with the active registration so participants can review what they picked. Question answers are stored with the registration for organizers.`,
    });
    await expect(
      participantRegistrationCard.getByText('Snack voucher'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByLabel(registrationQuestion.title),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByRole('button', { name: 'Register' }),
    ).toBeDisabled();
    await participantRegistrationCard.getByLabel('Quantity').fill('2');
    await participantRegistrationCard
      .getByLabel(registrationQuestion.title)
      .fill('Vegetarian snack, please.');
    await participantRegistrationCard
      .getByRole('button', { name: 'Register' })
      .click();
    await expect(page.getByText('You are registered')).toBeVisible();
    await expect(page.getByText('2 x Snack voucher')).toBeVisible();

    const registration = await database.query.eventRegistrations.findFirst({
      where: {
        eventId: freeEventId,
        registrationOptionId: freeOptionId,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: regularUser.id,
      },
      with: {
        questionAnswers: true,
      },
    });
    if (!registration) {
      throw new Error(
        'Expected registration docs flow to persist the confirmed registration',
      );
    }
    expect(registration.questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Vegetarian snack, please.',
        questionId: registrationQuestion.questionId,
      }),
    ]);

    await testInfo.attach('markdown', {
      body: `
  ### Successful registration
  You should now have a successful registration.
  You can see this by additional information being available and also your ticket QR code.
  Participant registrations can include guests, registration-time add-ons, and registration-question answers. Guest spots are attached to the logged-in buyer's registration and count against the same option capacity. Add-ons are shown with the confirmed registration and can be reviewed by organizers.
  This code is needed when attending the event. Keep this page available because QR email delivery is not part of the current relaunch flow.
  You can cancel a pending or confirmed registration from this event page before the event starts. Confirmed cancellation releases your selected spots, including guests when attached. If the registration was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.`,
    });

    await takeScreenshot(
      testInfo,
      activeRegistrationCard(page, 'Your event ticket'),
      page,
      'Confirmed registration card with selected add-ons and QR ticket',
    );
  });

  test('Review unavailable registration states', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const regularUser = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    );
    const closedEventId = seeded.scenario.events.closedReg.eventId;
    const fullEventId = seeded.scenario.events.freeOpen.eventId;
    const fullOptionId = seeded.scenario.events.freeOpen.optionId;
    const serverNow = resolveServerNow();
    const serverOpenUntil = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000);
    const fullOption = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId: fullEventId, id: fullOptionId },
    });
    if (!regularUser || !fullOption) {
      throw new Error(
        'Expected regular user and seeded free registration option',
      );
    }
    const fullEvent = await database.query.eventInstances.findFirst({
      where: { id: fullEventId, tenantId: tenant.id },
    });
    if (!fullEvent) {
      throw new Error('Expected seeded free registration event');
    }
    const serverFutureEventStart = new Date(
      serverNow.getTime() + 48 * 60 * 60 * 1000,
    );
    const serverFutureEventEnd = new Date(
      serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
    );

    await testInfo.attach('markdown', {
      body: `
  ## Registration unavailable states

  Event pages stay readable when registration is not currently possible. The registration card explains the current state instead of showing an action that cannot succeed.
`,
    });

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, closedEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await page.goto(`/events/${closedEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('Registration is closed')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Register$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      registrationOptionCard(page, 'Registration is closed'),
      page,
      'Registration option card after the registration window has closed',
    );

    await testInfo.attach('markdown', {
      body: `
  When the registration window is closed, participants can still read the event details, but the registration action is removed.
`,
    });

    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, fullEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: serverOpenUntil,
        confirmedSpots: fullOption.spots,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, fullOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverFutureEventEnd,
        start: serverFutureEventStart,
      })
      .where(eq(schema.eventInstances.id, fullEventId));
    const waitlistQuestion = await seedRequiredRegistrationQuestion({
      database,
      eventId: fullEventId,
      registrationOptionId: fullOptionId,
      title: 'Anything organizers should know?',
    });
    await page.goto(`/events/${fullEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('This option is full.')).toBeVisible();
    const waitlistButton = page.getByRole('button', { name: 'Join waitlist' });
    await expect(waitlistButton).toBeVisible();
    await expect(page.getByLabel(waitlistQuestion.title)).toBeVisible();
    await expect(waitlistButton).toBeDisabled();
    await page
      .getByLabel(waitlistQuestion.title)
      .fill('Please tell me if a spot opens.');
    await expect(waitlistButton).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Register$/ })).toHaveCount(
      0,
    );
    await takeScreenshot(
      testInfo,
      registrationOptionCard(page, 'This option is full.'),
      page,
      'Full participant option showing required question and waitlist action',
    );
    await waitlistButton.click();
    await expect(
      page.getByText('You are currently on the waitlist'),
    ).toBeVisible();
    const waitlistRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          eventId: fullEventId,
          registrationOptionId: fullOptionId,
          status: 'WAITLIST',
          tenantId: tenant.id,
          userId: regularUser.id,
        },
        with: {
          questionAnswers: true,
        },
      });
    if (!waitlistRegistration) {
      throw new Error(
        'Expected registration docs waitlist flow to persist the waitlist registration',
      );
    }
    expect(waitlistRegistration.questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Please tell me if a spot opens.',
        questionId: waitlistQuestion.questionId,
      }),
    ]);
    await page.getByRole('button', { name: 'Leave waitlist' }).click();
    await expect(page.getByText('This option is full.')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Join waitlist' }),
    ).toBeVisible();

    const cancelledWaitlistRegistration =
      await database.query.eventRegistrations.findFirst({
        where: {
          id: waitlistRegistration.id,
          status: 'CANCELLED',
          tenantId: tenant.id,
        },
      });
    if (!cancelledWaitlistRegistration) {
      throw new Error(
        'Expected registration docs waitlist leave action to cancel the waitlist registration',
      );
    }
    const fullOptionAfterLeaving =
      await database.query.eventRegistrationOptions.findFirst({
        where: { eventId: fullEventId, id: fullOptionId },
      });
    if (!fullOptionAfterLeaving) {
      throw new Error(
        'Expected seeded full option after registration docs waitlist leave action',
      );
    }
    expect(fullOptionAfterLeaving.waitlistSpots).toBe(0);

    await testInfo.attach('markdown', {
      body: `
  Full participant options expose a distinct **Join waitlist** action. If that option asks required registration questions, participants must answer them before joining the waitlist. Waitlist registration is separate from a confirmed registration, and a normal **Register** button is not shown while the option is full. Participants can leave the waitlist before the event starts, which cancels the waitlist registration and releases the waitlist position.
`,
    });
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: fullOption.closeRegistrationTime,
        confirmedSpots: fullOption.confirmedSpots,
        reservedSpots: fullOption.reservedSpots,
        waitlistSpots: fullOption.waitlistSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, fullOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: fullEvent.end,
        start: fullEvent.start,
      })
      .where(eq(schema.eventInstances.id, fullEventId));
  });

  test('Transfer an unpaid registration', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const regularUser = usersToAuthenticate.find(
      (user) => user.stateFile === userStateFile,
    );
    const targetUser = usersToAuthenticate.find(
      (user) => user.email === 'organizer@evorto.app',
    );
    if (!regularUser || !targetUser) {
      throw new Error('Expected regular and organizer user fixtures');
    }

    const freeEventId = seeded.scenario.events.freeOpen.eventId;
    const freeOptionId = seeded.scenario.events.freeOpen.optionId;
    const registrationId = getId();
    const serverNow = resolveServerNow();
    const serverFutureEventStart = new Date(
      serverNow.getTime() + 48 * 60 * 60 * 1000,
    );
    const serverFutureEventEnd = new Date(
      serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
    );

    await database
      .update(schema.eventRegistrations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(schema.eventRegistrations.eventId, freeEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          inArray(schema.eventRegistrations.userId, [
            regularUser.id,
            targetUser.id,
          ]),
        ),
      );
    await database.insert(schema.eventRegistrations).values({
      eventId: freeEventId,
      id: registrationId,
      registrationOptionId: freeOptionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: regularUser.id,
    });
    await database
      .update(schema.eventInstances)
      .set({
        end: serverFutureEventEnd,
        start: serverFutureEventStart,
      })
      .where(eq(schema.eventInstances.id, freeEventId));

    await page.goto(`/events/${freeEventId}`);
    await waitForRegistrationStatus(page);
    await expect(page.getByText('You are registered')).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
  ## Transfer an unpaid registration

  Confirmed unpaid registrations can be transferred from the event page before check-in and before the event starts. The target account must already exist in the tenant and be eligible for the same registration option.

  Paid registration transfer or direct resale now starts with a transfer link/code. The replacement participant can start a Stripe Checkout registration from the link; after checkout succeeds, Evorto cancels the original registration and handles the source refund path. Public resale listings are outside the relaunch scope.`,
    });
    await takeScreenshot(
      testInfo,
      activeRegistrationCard(page, 'Transfer registration'),
      page,
      'Confirmed unpaid registration card with transfer action',
    );

    await page.getByRole('button', { name: 'Transfer registration' }).click();
    const dialog = page.getByRole('dialog', { name: 'Transfer registration' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel('New participant email')
      .fill(` ${targetUser.email} `);
    await takeScreenshot(
      testInfo,
      dialog,
      page,
      'Transfer registration dialog',
    );
    await dialog.getByRole('button', { name: 'Transfer registration' }).click();
    await expect(dialog).not.toBeVisible();

    await expect
      .poll(async () => {
        const transferredRegistration =
          await database.query.eventRegistrations.findFirst({
            where: {
              id: registrationId,
              tenantId: tenant.id,
            },
          });
        return transferredRegistration?.userId;
      })
      .toBe(targetUser.id);

    await testInfo.attach('markdown', {
      body: `
  After transfer, the registration belongs to the target tenant member. The original participant no longer sees it as their active registration.`,
    });
  });

  test('Review paid transfer/direct-resale state', async ({
    database,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const regularUser = usersToAuthenticate.find(
      (user) => user.stateFile === userStateFile,
    );
    if (!regularUser) {
      throw new Error('Expected regular user fixture');
    }

    const paidEventId = seeded.scenario.events.paidOpen.eventId;
    const paidOptionId = seeded.scenario.events.paidOpen.optionId;
    const serverNow = resolveServerNow();
    const serverFutureEventStart = new Date(
      serverNow.getTime() + 48 * 60 * 60 * 1000,
    );
    const serverFutureEventEnd = new Date(
      serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
    );
    const paidOption = await database.query.eventRegistrationOptions.findFirst({
      where: {
        eventId: paidEventId,
        id: paidOptionId,
      },
    });
    if (!paidOption || paidOption.price <= 0) {
      throw new Error('Expected seeded paid registration option for docs');
    }

    const registrationId = getId();
    const transactionId = getId();

    try {
      await database
        .update(schema.eventRegistrations)
        .set({ status: 'CANCELLED' })
        .where(
          and(
            eq(schema.eventRegistrations.eventId, paidEventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );
      await database.insert(schema.eventRegistrations).values({
        eventId: paidEventId,
        id: registrationId,
        registrationOptionId: paidOptionId,
        status: 'CONFIRMED',
        tenantId: tenant.id,
        userId: regularUser.id,
      });
      await database
        .update(schema.eventRegistrationOptions)
        .set({
          confirmedSpots: paidOption.confirmedSpots + 1,
        })
        .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
      await database.insert(schema.transactions).values({
        amount: paidOption.price,
        comment: 'Registration docs paid-transfer blocked state',
        currency: 'EUR',
        eventId: paidEventId,
        eventRegistrationId: registrationId,
        id: transactionId,
        method: 'stripe',
        status: 'successful',
        targetUserId: regularUser.id,
        tenantId: tenant.id,
        type: 'registration',
      });
      await database
        .update(schema.eventInstances)
        .set({
          end: serverFutureEventEnd,
          start: serverFutureEventStart,
        })
        .where(eq(schema.eventInstances.id, paidEventId));

      await page.goto(`/events/${paidEventId}`);
      await waitForRegistrationStatus(page);
      await expect(page.getByText('You are registered')).toBeVisible();
      await expect(
        page.getByText(
          'Create a 24-hour transfer link and code for this paid registration. Share it with the replacement participant for direct transfer or resale; after replacement checkout succeeds, Evorto cancels this registration and handles the source refund path.',
        ),
      ).toBeVisible();
      await expect(
        page.getByText(
          'If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Transfer registration' }),
      ).toHaveCount(0);
      await page.getByRole('button', { name: 'Create transfer link' }).click();
      await expect(page.getByText('Transfer code')).toBeVisible();

      await expect
        .poll(async () =>
          database.query.registrationTransferIntents.findFirst({
            where: {
              sourceRegistrationId: registrationId,
              status: 'pending',
              tenantId: tenant.id,
            },
          }),
        )
        .not.toBeNull();
      const transferIntent =
        await database.query.registrationTransferIntents.findFirst({
          where: {
            sourceRegistrationId: registrationId,
            status: 'pending',
            tenantId: tenant.id,
          },
        });
      expect(transferIntent?.code).toEqual(expect.any(String));
      await expect(
        page.getByText(transferIntent?.code ?? 'missing-transfer-code'),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Open transfer link' }),
      ).toHaveAttribute(
        'href',
        `/events/${paidEventId}?transferCode=${encodeURIComponent(
          transferIntent?.code ?? '',
        )}`,
      );

      const paidRegistration =
        await database.query.eventRegistrations.findFirst({
          where: {
            id: registrationId,
            tenantId: tenant.id,
          },
        });
      if (!paidRegistration) {
        throw new Error(
          'Expected registration docs paid transfer state to persist the registration',
        );
      }
      expect(paidRegistration.userId).toBe(regularUser.id);
      expect(paidRegistration.status).toBe('CONFIRMED');

      await testInfo.attach('markdown', {
        body: `
  ## Paid transfer and resale boundary

  Paid registrations can create a 24-hour transfer link and code from the event page before check-in and before the event starts. The replacement participant can start a Stripe Checkout registration from that link; after checkout succeeds, Evorto cancels the original registration and handles the source refund path. This covers direct transfer or resale without adding a public resale listing marketplace to relaunch scope.

  Paid confirmed cancellations are still allowed before the event starts. Cancelling one releases the selected spots and submits a Stripe refund when the original payment reference is available; older or manually seeded payment records still create a pending manual refund record for organizer follow-up.`,
      });
      await takeScreenshot(
        testInfo,
        activeRegistrationCard(page, 'Transfer code'),
        page,
        'Paid transfer code shown for manual bank-transfer registration',
      );

      await page.getByRole('button', { name: 'Cancel registration' }).click();
      await expect
        .poll(async () => {
          const cancelledRegistration =
            await database.query.eventRegistrations.findFirst({
              where: {
                id: registrationId,
                tenantId: tenant.id,
              },
            });
          return cancelledRegistration?.status;
        })
        .toBe('CANCELLED');

      const refundTransaction = await database.query.transactions.findFirst({
        where: {
          eventRegistrationId: registrationId,
          tenantId: tenant.id,
          type: 'refund',
        },
      });
      expect(refundTransaction).toEqual(
        expect.objectContaining({
          amount: -Math.abs(paidOption.price),
          currency: 'EUR',
          eventId: paidEventId,
          eventRegistrationId: registrationId,
          manuallyCreated: true,
          method: 'stripe',
          status: 'pending',
          targetUserId: regularUser.id,
          tenantId: tenant.id,
          type: 'refund',
        }),
      );
      expect(refundTransaction?.comment).toContain(
        'Pending registration refund record',
      );
    } finally {
      await database
        .delete(schema.registrationTransferIntents)
        .where(
          and(
            eq(
              schema.registrationTransferIntents.sourceRegistrationId,
              registrationId,
            ),
            eq(schema.registrationTransferIntents.tenantId, tenant.id),
          ),
        );
      await database
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.eventRegistrationId, registrationId),
            eq(schema.transactions.tenantId, tenant.id),
          ),
        );
      await database
        .delete(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, registrationId));
      await database
        .update(schema.eventRegistrationOptions)
        .set({
          confirmedSpots: paidOption.confirmedSpots,
        })
        .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
    }
  });

  test('Review role-ineligible registration state', async ({
    database,
    page,
    roles,
    seeded,
    tenant,
  }, testInfo) => {
    const regularUser = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    );
    const organizerOnlyRole = roles.find(
      (role) => role.defaultOrganizerRole && !role.defaultUserRole,
    );
    if (!organizerOnlyRole) {
      throw new Error('Expected seeded organizer-only role');
    }

    const eventId = seeded.scenario.events.freeOpen.eventId;
    const optionId = seeded.scenario.events.freeOpen.optionId;
    const option = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId, id: optionId },
    });
    if (!option) {
      throw new Error(
        'Expected seeded free registration option for role-ineligible docs state',
      );
    }

    try {
      await database
        .delete(schema.eventRegistrations)
        .where(
          and(
            eq(schema.eventRegistrations.eventId, eventId),
            eq(schema.eventRegistrations.tenantId, tenant.id),
            eq(schema.eventRegistrations.userId, regularUser.id),
          ),
        );
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [organizerOnlyRole.id] })
        .where(eq(schema.eventRegistrationOptions.id, optionId));

      await page.goto(`/events/${eventId}`);
      await waitForRegistrationStatus(page);

      await expect(
        page.getByRole('heading', { name: 'Registration unavailable' }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'This event is visible from the direct link, but your account is not eligible for the available registration options.',
        ),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /^Register$/ }),
      ).toHaveCount(0);
      await takeScreenshot(
        testInfo,
        page
          .locator('div')
          .filter({ hasText: 'Registration unavailable' })
          .filter({
            hasText:
              'This event is visible from the direct link, but your account is not eligible for the available registration options.',
          })
          .first(),
        page,
        'Role-ineligible registration state',
      );

      await testInfo.attach('markdown', {
        body: `
  Direct event links remain readable for signed-in users without eligible tenant roles. The registration area states that the current account is not eligible instead of hiding the event or rendering an empty registration section.
`,
      });
    } finally {
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: option.roleIds })
        .where(eq(schema.eventRegistrationOptions.id, optionId));
    }
  });

  test('Register for a paid event', async ({
    database,
    events,
    page,
    request,
    seeded,
    tenant,
  }, testInfo) => {
    test.slow();
    const paidEventId = seeded.scenario.events.paidOpen.eventId;
    const paidOptionId = seeded.scenario.events.paidOpen.optionId;
    const paidEvent = events.find((event) => event.id === paidEventId);
    if (!paidEvent) {
      throw new Error(
        `Seeded paidOpen scenario event "${paidEventId}" was not found`,
      );
    }
    const regularUserId = requireUserFixture(
      (user) => user.roles === 'user',
      'regular',
    ).id;
    const paidOption = await database.query.eventRegistrationOptions.findFirst({
      where: {
        eventId: paidEventId,
        id: paidOptionId,
      },
    });
    if (!paidOption?.isPaid) {
      throw new Error(
        'Expected seeded paidOpen registration option to exist and be paid',
      );
    }
    const paidEventInstance = await database.query.eventInstances.findFirst({
      where: { id: paidEvent.id, tenantId: tenant.id },
    });
    if (!paidEventInstance) {
      throw new Error('Expected seeded paidOpen event instance to exist');
    }
    const serverNow = resolveServerNow();
    const serverOpenUntil = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000);
    const serverFutureEventStart = new Date(
      serverNow.getTime() + 48 * 60 * 60 * 1000,
    );
    const serverFutureEventEnd = new Date(
      serverFutureEventStart.getTime() + 2 * 60 * 60 * 1000,
    );
    let checkoutTransactionId: null | string = null;

    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventId, paidEvent.id),
          eq(schema.transactions.method, 'stripe'),
          eq(schema.transactions.targetUserId, regularUserId),
          eq(schema.transactions.tenantId, tenant.id),
          eq(schema.transactions.type, 'registration'),
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, paidEvent.id),
          eq(schema.eventRegistrations.registrationOptionId, paidOptionId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUserId),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: serverOpenUntil,
        confirmedSpots: 0,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverFutureEventEnd,
        start: serverFutureEventStart,
      })
      .where(eq(schema.eventInstances.id, paidEvent.id));

    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
  To register for a paid event, you have to pay the registration fee.`,
    });
    await gotoEventDetail(page, paidEvent.id);
    await waitForRegistrationStatus(page);
    const payButton = page.getByRole('button', { name: /Pay/i }).first();
    await takeScreenshot(
      testInfo,
      registrationOptionCard(page, 'Pay'),
      page,
      'Paid event registration options before starting Stripe Checkout',
    );
    await testInfo.attach('markdown', {
      body: `
  By clicking the **Pay and register** button, you are starting the payment process.
  Paid guest spots are included in the Stripe Checkout quantity and reserve the matching capacity while payment is pending.
  Afterwards, you can either finish the registration by paying or cancel your payment and registration in case you changed your mind. Cancelling a pending payment registration releases every selected buyer and guest spot and expires the pending checkout when possible.`,
    });
    await takeScreenshot(
      testInfo,
      registrationOptionCard(page, 'Pay'),
      page,
      'Paid registration card before the pending checkout recovery state',
    );
    const findCheckoutTransaction = async () => {
      if (checkoutTransactionId) {
        return database.query.transactions.findFirst({
          where: {
            id: checkoutTransactionId,
            tenantId: tenant.id,
          },
        });
      }

      return database.query.transactions.findFirst({
        orderBy: { createdAt: 'desc' },
        where: {
          eventId: paidEvent.id,
          method: 'stripe',
          targetUserId: regularUserId,
          tenantId: tenant.id,
          type: 'registration',
        },
      });
    };
    const payNowLink = page.getByRole('link', { name: 'Pay now' }).first();
    let checkoutUrl: null | string = null;
    if ((await payNowLink.count()) > 0) {
      checkoutUrl = await payNowLink.getAttribute('href');
    }
    if (!checkoutUrl) {
      await expect(payButton).toBeVisible({ timeout: 20_000 });
      await payButton.click();
      await expect
        .poll(
          async () => {
            const pendingTransaction = await findCheckoutTransaction();
            checkoutTransactionId = pendingTransaction?.id ?? null;
            return pendingTransaction?.stripeCheckoutUrl ?? null;
          },
          {
            intervals: [1_000, 2_000, 4_000],
            message:
              'Timed out waiting for a pending Stripe checkout transaction URL',
            timeout: 90_000,
          },
        )
        .not.toBeNull();
      const pendingTransaction = await findCheckoutTransaction();
      checkoutTransactionId = pendingTransaction?.id ?? null;
      checkoutUrl = pendingTransaction?.stripeCheckoutUrl ?? null;
    }
    const checkoutPagePromise = page.context().waitForEvent('page', {
      timeout: 5_000,
    });
    if (await payNowLink.isVisible().catch(() => false)) {
      await payNowLink.click();
    } else if (checkoutUrl) {
      await page.goto(checkoutUrl);
    } else {
      throw new Error(
        'Stripe checkout URL missing after creating pending payment',
      );
    }
    const checkoutPopup = await checkoutPagePromise.catch(() => null);
    const checkoutPage = checkoutPopup ?? page;
    await expect
      .poll(() => checkoutPage.url(), {
        message: 'Timed out waiting for Stripe Checkout page navigation',
        timeout: 30_000,
      })
      .toMatch(/checkout\.stripe\.com/);
    const checkoutForm = stripeCheckoutFormSurface(checkoutPage);
    await expect(checkoutForm).toBeVisible({ timeout: 30_000 });
    await takeScreenshot(
      testInfo,
      checkoutForm,
      checkoutPage,
      'Stripe Checkout page for completing the paid registration',
    );
    await fillTestCard(checkoutPage);

    const getStripeRegistrationState = async () => {
      const transaction = await findCheckoutTransaction();
      if (!transaction) {
        return 'missing-transaction';
      }

      const registration = transaction.eventRegistrationId
        ? await database.query.eventRegistrations.findFirst({
            where: {
              id: transaction.eventRegistrationId,
              tenantId: tenant.id,
            },
          })
        : await database.query.eventRegistrations.findFirst({
            orderBy: { createdAt: 'desc' },
            where: {
              eventId: paidEvent.id,
              tenantId: tenant.id,
              userId: regularUserId,
            },
          });

      return `${transaction.status}:${registration?.status ?? 'missing-registration'}`;
    };

    const pendingTransaction = await findCheckoutTransaction();
    if (!pendingTransaction) {
      throw new Error(
        'Expected a pending Stripe checkout transaction before replaying the docs checkout webhook',
      );
    }
    checkoutTransactionId = pendingTransaction.id;

    await replayCheckoutCompletedWebhook({
      request,
      transaction: {
        eventRegistrationId: pendingTransaction.eventRegistrationId,
        id: pendingTransaction.id,
        stripeCheckoutSessionId: pendingTransaction.stripeCheckoutSessionId,
        tenantId: pendingTransaction.tenantId,
      },
    });

    try {
      await expect
        .poll(getStripeRegistrationState, {
          intervals: [1_000, 2_000, 4_000],
          message:
            'Timed out waiting for replayed Stripe checkout webhook to be mirrored in the application database',
          timeout: 90_000,
        })
        .toBe('successful:CONFIRMED');
    } catch (error) {
      const checkoutUrl = checkoutPage.isClosed()
        ? 'closed'
        : checkoutPage.url();
      const postalCodeValue = await checkoutPage
        .locator('input[aria-label="ZIP"], input[aria-label*="Postal"]')
        .first()
        .inputValue()
        .catch(() => '');
      const phoneValue = await checkoutPage
        .locator('input[aria-label="Phone number"], input[aria-label*="Phone"]')
        .first()
        .inputValue()
        .catch(() => '');
      throw new Error(
        `Timed out waiting for replayed Stripe checkout webhook to be mirrored in the application database (checkoutUrl=${checkoutUrl}, zip=${postalCodeValue || 'empty'}, phone=${phoneValue || 'empty'})`,
        { cause: error },
      );
    }

    await gotoEventDetail(page, paidEvent.id);
    const registrationStatus = page
      .getByText('Loading registration status')
      .first();
    await registrationStatus
      .waitFor({ state: 'attached', timeout: 10_000 })
      .catch(() => {});
    await registrationStatus.waitFor({ state: 'detached', timeout: 20_000 });
    const registeredMessage = page.getByText('You are registered');
    await expect(registeredMessage).toBeVisible({ timeout: 20_000 });
    await testInfo.attach('markdown', {
      body: `
  ### Successful paid registration
  After successful payment, you are redirected back to the event page and shown your registration confirmation.
  Your ticket details and QR code are now available.`,
    });
    await takeScreenshot(
      testInfo,
      activeRegistrationCard(page, 'Your event ticket'),
      page,
      'Event details after successful paid registration',
    );
    await database
      .delete(schema.transactions)
      .where(
        and(
          eq(schema.transactions.eventId, paidEvent.id),
          eq(schema.transactions.method, 'stripe'),
          eq(schema.transactions.targetUserId, regularUserId),
          eq(schema.transactions.tenantId, tenant.id),
          eq(schema.transactions.type, 'registration'),
        ),
      );
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, paidEvent.id),
          eq(schema.eventRegistrations.registrationOptionId, paidOptionId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUserId),
        ),
      );
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: paidOption.closeRegistrationTime,
        confirmedSpots: paidOption.confirmedSpots,
        reservedSpots: paidOption.reservedSpots,
        waitlistSpots: paidOption.waitlistSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, paidOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: paidEventInstance.end,
        start: paidEventInstance.start,
      })
      .where(eq(schema.eventInstances.id, paidEvent.id));
  });
});
