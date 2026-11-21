import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { getId } from './get-id';
import { insertFreeSeedRegistrationAcquisitions } from './seed-registration-acquisitions';
import { requireSeedUserId } from './seed-requirements';
import { usersToAuthenticate } from './user-data';
import { walkthroughEventCopy } from './walkthrough-event-copy';

// Curated demo states supplement the varied background calendar. Their names
// are ordinary event content so the walkthrough exercises the real interface.
export const addWalkthroughEvents = async (
  database: NodePgDatabase<typeof relations>,
  input: {
    tenantId: string;
    seedDate: Date;
    includeRegistrations: boolean;
    currency: 'AUD' | 'CZK' | 'EUR';
  },
) => {
  const source = await database.query.eventInstances.findFirst({
    where: { tenantId: input.tenantId, status: 'APPROVED' },
    with: { registrationOptions: true },
    orderBy: { start: 'asc' },
  });
  if (!source) throw new Error('Walkthrough requires a seeded event');
  const attendee = source.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  const organizing = source.registrationOptions.find(
    (option) => option.organizingRegistration,
  );
  if (!attendee || !organizing)
    throw new Error('Walkthrough requires both sign-up choices');
  const paidSource = await database.query.eventRegistrationOptions.findFirst({
    where: { isPaid: true, event: { tenantId: input.tenantId } },
  });
  if (!paidSource)
    throw new Error('Walkthrough requires a paid sign-up choice');
  const announcementAudience = await database.query.roles.findMany({
    where: { tenantId: input.tenantId, defaultUserRole: true },
  });
  if (announcementAudience.length === 0)
    throw new Error('Walkthrough requires an announcement audience');
  const icons = await database.query.icons.findMany({
    where: { tenantId: input.tenantId },
  });
  const now = DateTime.fromJSDate(input.seedDate, { zone: 'utc' }).startOf(
    'day',
  );
  const userId = requireSeedUserId(usersToAuthenticate, 'user');
  const organizerId = requireSeedUserId(usersToAuthenticate, 'organizer');
  const profile = usersToAuthenticate.find((user) => user.roles === 'profile');
  if (!profile) throw new Error('Walkthrough requires the profile account');
  const profileId = profile.id;
  const adminId = requireSeedUserId(usersToAuthenticate, 'admin');
  const scenarios = [
    { key: 'open', title: 'Welcome evening', day: 3 },
    { key: 'opensTomorrow', title: 'City walk', day: 6 },
    { key: 'closed', title: 'Last-minute city tour', day: 4 },
    { key: 'waitlist', title: 'Museum visit', day: 5 },
    { key: 'application', title: 'Weekend planning', day: 8 },
    { key: 'ticket', title: 'Lakeside picnic', day: 7 },
    { key: 'cancelled', title: 'Board game evening', day: 9 },
    { key: 'paid', title: 'Sunday football', day: 10 },
    { key: 'checkIn', title: 'Yesterday’s welcome', day: -1 },
    { key: 'announcement', title: 'Meet your section', day: 2 },
  ] as const;
  const handles: Record<string, { eventId: string; optionId: string }> = {};
  for (const scenario of scenarios) {
    const copy = walkthroughEventCopy.get(scenario.title);
    if (!copy)
      throw new Error(`Missing walkthrough copy for ${scenario.title}`);
    const icon = icons.find(
      (candidate) => candidate.commonName === copy.iconName,
    );
    if (!icon) throw new Error(`Missing walkthrough icon ${copy.iconName}`);
    const eventId = getId();
    const optionId = getId();
    const organizingId = getId();
    const start = now
      .plus({ days: scenario.day })
      .set({ hour: 16, minute: 30 });
    await database.insert(schema.eventInstances).values({
      ...source,
      id: eventId,
      announcementRoleIds:
        scenario.key === 'announcement'
          ? announcementAudience.map((role) => role.id)
          : [],
      creatorId: organizerId,
      title: scenario.title,
      description: copy.description,
      icon: { iconName: icon.commonName, iconColor: icon.sourceColor ?? 0 },
      start: start.toJSDate(),
      end: start.plus({ hours: 3 }).toJSDate(),
      reviewedAt: now.toJSDate(),
      reviewedBy: adminId,
    });
    handles[scenario.key] = { eventId, optionId };
    if (scenario.key === 'announcement') continue;
    const common = {
      eventId,
      openRegistrationTime: now.minus({ days: 7 }).toJSDate(),
      closeRegistrationTime: start.minus({ hours: 2 }).toJSDate(),
      confirmedSpots: 0,
      reservedSpots: 0,
      waitlistSpots: 0,
      checkedInSpots: 0,
      cancellationDeadlineHoursBeforeStart: 24,
      transferDeadlineHoursBeforeStart: 12,
      registeredDescription: copy.registeredDescription || null,
      description: null,
      isPaid: false,
      price: 0,
      stripeTaxRateId: null,
    };
    await database.insert(schema.eventRegistrationOptions).values([
      {
        ...attendee,
        ...common,
        id: optionId,
        title: 'Attend',
        spots: scenario.key === 'waitlist' ? 2 : 20,
        registrationMode:
          scenario.key === 'application' ? 'application' : 'fcfs',
        openRegistrationTime:
          scenario.key === 'opensTomorrow'
            ? now.plus({ days: 1 }).set({ hour: 16, minute: 30 }).toJSDate()
            : common.openRegistrationTime,
        closeRegistrationTime:
          scenario.key === 'closed'
            ? now.minus({ days: 1 }).toJSDate()
            : common.closeRegistrationTime,
        ...(scenario.key === 'paid'
          ? {
              isPaid: true,
              price: 2500,
              stripeTaxRateId: paidSource.stripeTaxRateId,
            }
          : {}),
      },
      {
        ...organizing,
        ...common,
        id: organizingId,
        title: 'Help organize',
        spots: 3,
      },
    ]);
    if (scenario.key === 'open') {
      const addonId = getId();
      await database.insert(schema.eventAddons).values({
        id: addonId,
        eventId,
        title: 'Welcome pack',
        description: 'Collect your welcome pack when you arrive.',
        allowMultiple: false,
        allowPurchaseDuringRegistration: true,
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        isPaid: false,
        price: 0,
        maxQuantityPerUser: 1,
        totalAvailableQuantity: 20,
      });
      await database.insert(schema.addonToEventRegistrationOptions).values({
        addonId,
        eventId,
        registrationOptionId: optionId,
        includedQuantity: 0,
        optionalPurchaseQuantity: 1,
      });
      await database.insert(schema.eventRegistrationQuestions).values({
        id: getId(),
        eventId,
        registrationOptionId: optionId,
        title: 'Any dietary requirements?',
        description: 'Tell us about any allergies or dietary requirements.',
        required: true,
        sortOrder: 0,
      });
    }
    if (!input.includeRegistrations) continue;
    const register = async (
      ownerId: string,
      status: 'CONFIRMED' | 'PENDING' | 'WAITLIST' | 'CANCELLED',
      organizingTicket = false,
      guestCount = 0,
      checkedIn = false,
    ) => {
      const registrationId = getId();
      const registrationOptionId = organizingTicket ? organizingId : optionId;
      await database.insert(schema.eventRegistrations).values({
        id: registrationId,
        tenantId: input.tenantId,
        eventId,
        registrationOptionId,
        userId: ownerId,
        status,
        guestCount,
        checkInTime: checkedIn ? start.plus({ minutes: 5 }).toJSDate() : null,
        checkedInGuestCount: 0,
        basePriceAtRegistration: 0,
        discountAmount: 0,
      });
      if (status === 'CONFIRMED') {
        await insertFreeSeedRegistrationAcquisitions(database, [
          {
            acquiredAt: now.toJSDate(),
            currency: input.currency,
            eventId,
            guestCount,
            ownerUserId: ownerId,
            registrationId,
            tenantId: input.tenantId,
          },
        ]);
        const option = await database.query.eventRegistrationOptions.findFirst({
          where: { id: registrationOptionId },
        });
        if (!option) throw new Error('Missing walkthrough sign-up choice');
        await database
          .update(schema.eventRegistrationOptions)
          .set({
            confirmedSpots: option.confirmedSpots + guestCount + 1,
            checkedInSpots: option.checkedInSpots + (checkedIn ? 1 : 0),
          })
          .where(eq(schema.eventRegistrationOptions.id, registrationOptionId));
      }
      return registrationId;
    };
    if (
      ['open', 'waitlist', 'application', 'ticket', 'checkIn'].includes(
        scenario.key,
      )
    )
      await register(organizerId, 'CONFIRMED', true);
    if (scenario.key === 'ticket')
      await register(userId, 'CONFIRMED', false, 1);
    if (scenario.key === 'application') await register(userId, 'PENDING');
    if (scenario.key === 'cancelled') await register(userId, 'CANCELLED');
    if (scenario.key === 'checkIn')
      await register(userId, 'CONFIRMED', false, 1, true);
    if (scenario.key === 'waitlist') {
      await register(profileId, 'CONFIRMED');
      await register(adminId, 'CONFIRMED');
      await register(userId, 'WAITLIST');
      await database
        .update(schema.eventRegistrationOptions)
        .set({ waitlistSpots: 1 })
        .where(eq(schema.eventRegistrationOptions.id, optionId));
    }
  }
  return handles;
};
