import { and, count, eq } from 'drizzle-orm';
import { pgView, QueryBuilder } from 'drizzle-orm/pg-core';

import { eventRegistrationOptions } from './event-registration-options';
import { eventRegistrations } from './event-registrations';
import { usersToTenants } from './users';

const queryBuilder = new QueryBuilder();

const organizingRegistration = queryBuilder
  .select({
    optionCount: count(eventRegistrationOptions.id)
      .mapWith(Boolean)
      .as('optionCount'),
    tenantId: eventRegistrations.tenantId,
    userId: eventRegistrations.userId,
  })
  .from(eventRegistrationOptions)
  .where(eq(eventRegistrationOptions.organizingRegistration, true))
  .innerJoin(
    eventRegistrations,
    eq(eventRegistrationOptions.id, eventRegistrations.registrationOptionId),
  )
  .groupBy(eventRegistrations.tenantId, eventRegistrations.userId)
  .as('organizing_registration');

export const userAttributes = pgView('user_attributes').as((database) =>
  database
    .select({
      id: usersToTenants.id,
      organizesSome: organizingRegistration.optionCount,
      tenantId: usersToTenants.tenantId,
      userId: usersToTenants.userId,
    })
    .from(usersToTenants)
    .leftJoin(
      organizingRegistration,
      and(
        eq(organizingRegistration.tenantId, usersToTenants.tenantId),
        eq(organizingRegistration.userId, usersToTenants.userId),
      ),
    ),
);
