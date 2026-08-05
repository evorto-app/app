import { randChanceBoolean, randFloat, randNumber } from '@ngneat/falso';
import consola from 'consola';
/**
 * Registration Helper
 *
 * This helper creates realistic event registrations for testing and development.
 *
 * Key features:
 * 1. Creates varied registration patterns: some events full with waitlists, others partially filled
 * 2. Simulates realistic payment scenarios (successful, pending, failed) for paid events
 * 3. Excludes admin user from seeded registrations
 * 4. Creates waitlists for popular events (full + additional 20% on waitlist)
 * 5. Simulates check-ins for past events with realistic attendance rates
 * 6. Uses batch operations for efficient database seeding
 * 7. Creates different event popularity patterns: very popular, popular, moderate, less popular, new/unpopular
 * 8. For paid registrations, creates associated transactions as if Stripe webhooks fired
 * 9. Handles various registration statuses and payment transaction outcomes for comprehensive testing scenarios
 */
import { eq, InferInsertModel } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { type SupportedTenantCurrency } from '../src/types/custom/tenant';
import { getId } from './get-id';
import { getSeedDate } from './seed-clock';
import { usersToAuthenticate } from './user-data';

/**
 * Simplified event input type containing only the essential fields needed for registrations
 */
export interface EventRegistrationInput {
  id: string;
  registrationOptions: {
    confirmedSpots: number;
    id: string;
    isPaid: boolean;
    price: number;
    roleIds: string[];
    spots: number;
  }[];
  start: Date;
  tenantId: string;
  title: string;
}

interface AddRegistrationsInput {
  currency: SupportedTenantCurrency;
  events: readonly EventRegistrationInput[];
  seedDate?: Date;
  tenantId: string;
}

const MAX_REGISTRATIONS_PER_USER = 4;
const MAX_REGISTRATIONS_PER_TEST_USER = 1;

export const claimRegistrationSeedUsers = <User extends { id: string }>(
  candidates: readonly User[],
  totalRegistrations: number,
  selectedUserIdsForEvent: Set<string>,
  seededCountByUser: Map<string, number>,
  testerUserIds: ReadonlySet<string>,
): User[] => {
  if (totalRegistrations <= 0) {
    return [];
  }

  const selectedUsers: User[] = [];

  for (const user of candidates) {
    const limit = testerUserIds.has(user.id)
      ? MAX_REGISTRATIONS_PER_TEST_USER
      : MAX_REGISTRATIONS_PER_USER;
    const currentCount = seededCountByUser.get(user.id) ?? 0;
    if (selectedUserIdsForEvent.has(user.id) || currentCount >= limit) {
      continue;
    }

    selectedUserIdsForEvent.add(user.id);
    seededCountByUser.set(user.id, currentCount + 1);
    selectedUsers.push(user);
    if (selectedUsers.length >= totalRegistrations) {
      break;
    }
  }

  return selectedUsers;
};

export const validateRegistrationSeedEventOwnership = (
  events: readonly EventRegistrationInput[],
  tenantId: string,
): void => {
  const mismatchedEvent = events.find((event) => event.tenantId !== tenantId);
  if (mismatchedEvent) {
    throw new Error(
      `Cannot seed event ${mismatchedEvent.id} for tenant ${tenantId}: event belongs to ${mismatchedEvent.tenantId}`,
    );
  }
};

/**
 * Adds realistic event registrations to the database.
 *
 * This helper creates varied registration patterns to simulate real-world usage:
 * - Some events are fully booked with waitlists
 * - Others have varying levels of popularity and availability
 * - Past events include realistic check-in patterns
 * - Payment transaction outcomes reflect real scenarios (successful, pending, failed)
 * - Uses batch inserts for improved performance during database setup
 *
 * @param database - The database connection
 * @param events - The events to create registrations for (with simplified input)
 * @returns The created registrations
 */
export async function addRegistrations(
  database: NodePgDatabase<typeof relations>,
  { currency, events, seedDate, tenantId }: AddRegistrationsInput,
) {
  validateRegistrationSeedEventOwnership(events, tenantId);

  // Query all users with their tenant relationships and roles
  const usersRaw = await database.query.users.findMany({
    with: {
      tenantAssignments: {
        with: {
          rolesToTenantUsers: {
            with: {
              role: true,
            },
          },
        },
      },
    },
  });
  // Exclude admin user from registrations
  const users = usersRaw.filter((u) => u.email !== 'admin@evorto.app');
  consola.start(
    `Seeding registrations for ${events.length} events (eligible users: ${users.length})`,
  );

  if (users.length === 0) {
    throw new Error('Cannot seed registrations without base users');
  }

  // Prepare batch operation arrays
  const registrations: InferInsertModel<typeof schema.eventRegistrations>[] =
    [];
  const transactions: InferInsertModel<typeof schema.transactions>[] = [];
  const optionUpdates = new Map<
    string,
    { checkedInSpots: number; confirmedSpots: number; waitlistSpots: number }
  >();

  // Build fast eligibility index: tenantId -> roleId -> users[]
  const roleIndex = new Map<string, Map<string, (typeof users)[number][]>>();
  for (const u of users) {
    for (const ta of u.tenantAssignments ?? []) {
      let byRole = roleIndex.get(ta.tenantId);
      if (!byRole) {
        byRole = new Map();
        roleIndex.set(ta.tenantId, byRole);
      }
      for (const rtu of ta.rolesToTenantUsers ?? []) {
        const roleId = rtu.role.id;
        const list = byRole.get(roleId);
        if (list) {
          list.push(u);
        } else {
          byRole.set(roleId, [u]);
        }
      }
    }
  }

  // Helper to quickly compute eligible users by tenant+roles (union, dedup by id)
  const getEligibleUsers = (tenantId: string, roleIds: string[]) => {
    const seen = new Set<string>();
    const result: (typeof users)[number][] = [];
    const byRole = roleIndex.get(tenantId);
    if (!byRole) return result;
    for (const rid of roleIds) {
      const list = byRole.get(rid) ?? [];
      for (const u of list) {
        if (seen.has(u.id)) {
          continue;
        }

        seen.add(u.id);
        result.push(u);
      }
    }
    return result;
  };

  const testerUserIds = new Set(usersToAuthenticate.map((user) => user.id));
  const seededCountByUser = new Map<string, number>();

  // Process each event with varied registration patterns
  for (const [eventIndex, event] of events.entries()) {
    if (event.registrationOptions.length === 0) {
      continue;
    }

    const selectedUserIdsForEvent = new Set<string>();

    // Determine event popularity and registration patterns
    const eventDate = new Date(event.start);
    const now = getSeedDate(seedDate ?? new Date());
    const isPastEvent = eventDate < now;

    // Create varied registration patterns based on event type and timing
    let fillPercentage = 0.7; // Default 70%
    let shouldHaveWaitlist = false;
    let checkInRate = 0;

    // Determine event popularity based on index pattern
    const popularityPattern = eventIndex % 5;
    switch (popularityPattern) {
      case 0: {
        // Very popular events (full + waitlist)
        fillPercentage = 1;
        shouldHaveWaitlist = true;
        checkInRate = 0.95;
        break;
      }
      case 1: {
        // Popular events (80-90% full)
        fillPercentage = 0.8 + randFloat({ fraction: 3, max: 0.1, min: 0 });
        checkInRate = 0.9;
        break;
      }
      case 2: {
        // Moderately popular (60-70% full)
        fillPercentage = 0.6 + randFloat({ fraction: 3, max: 0.1, min: 0 });
        checkInRate = 0.85;
        break;
      }
      case 3: {
        // Less popular (30-50% full)
        fillPercentage = 0.3 + randFloat({ fraction: 3, max: 0.2, min: 0 });
        checkInRate = 0.8;
        break;
      }
      case 4: {
        // New/unpopular events (10-30% full)
        fillPercentage = 0.1 + randFloat({ fraction: 3, max: 0.2, min: 0 });
        checkInRate = 0.75;
        break;
      }
    }

    // Process each registration option
    for (const option of event.registrationOptions) {
      // Eligible users for this option (union of role holders within tenant)
      const eligibleUsers = getEligibleUsers(tenantId, option.roleIds);

      if (eligibleUsers.length === 0) {
        console.warn(
          `No eligible users found for registration option ${option.id} with roles ${option.roleIds.join(', ')}`,
        );
        continue;
      }

      // Calculate registrations and waitlist
      const regularSpots = Math.floor(
        option.spots * Math.min(fillPercentage, 1),
      );
      const waitlistSpots = shouldHaveWaitlist
        ? Math.floor(option.spots * 0.2)
        : 0;
      const totalRegistrations = Math.min(
        regularSpots + waitlistSpots,
        eligibleUsers.length,
      );

      let confirmedCount = 0;
      let waitlistCount = 0;
      let checkedInCount = 0;

      // Deterministically select K users using partial shuffle (faster than full sort)
      const shuffledUsers = [...eligibleUsers];
      for (let i = shuffledUsers.length - 1; i > 0; i--) {
        const j = randNumber({ max: i, min: 0 });
        const tmp = shuffledUsers[i];
        shuffledUsers[i] = shuffledUsers[j];
        shuffledUsers[j] = tmp;
      }

      const selectedUsers = claimRegistrationSeedUsers(
        shuffledUsers,
        totalRegistrations,
        selectedUserIdsForEvent,
        seededCountByUser,
        testerUserIds,
      );

      // Create registrations
      for (const [index, user] of selectedUsers.entries()) {
        // Generate IDs for the registration and transaction
        const registrationId = getId();

        // Determine registration status based on various factors
        let status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
        let paymentState: 'cancelled' | 'pending' | 'successful' | null = null;
        let checkInTime: Date | null = null;

        // First determine if this should be waitlisted
        if (index >= regularSpots && waitlistSpots > 0) {
          status = 'WAITLIST';
          waitlistCount++;
        } else {
          // Regular registration
          if (option.isPaid) {
            // For paid events, create more realistic payment scenarios
            const paymentScenario = randFloat({ fraction: 4, max: 1, min: 0 });
            if (paymentScenario < 0.85) {
              status = 'CONFIRMED';
              paymentState = 'successful';
              confirmedCount++;
            } else if (paymentScenario < 0.95) {
              status = 'PENDING';
              paymentState = 'pending';
            } else {
              status = 'CANCELLED';
              paymentState = 'cancelled';
            }
          } else {
            // Free events are typically confirmed immediately
            const confirmationRate = isPastEvent ? 0.95 : 0.9;
            if (randChanceBoolean({ chanceTrue: confirmationRate })) {
              status = 'CONFIRMED';
              confirmedCount++;
            } else {
              status = 'CANCELLED';
            }
          }
        }

        // For past events, simulate check-ins
        if (
          isPastEvent &&
          status === 'CONFIRMED' &&
          randChanceBoolean({ chanceTrue: checkInRate })
        ) {
          // Check-in time between event start and 30 minutes after
          const eventStart = new Date(event.start);
          const checkInWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
          const offset = Math.floor(
            randFloat({ fraction: 0, max: checkInWindow, min: 0 }),
          );
          checkInTime = new Date(eventStart.getTime() + offset);
          checkedInCount++;
        }

        // Add registration to batch
        registrations.push({
          ...(status === 'CONFIRMED' && {
            appliedDiscountedPrice: null,
            appliedDiscountType: null,
            basePriceAtRegistration: option.price,
            discountAmount: 0,
          }),
          checkInTime,
          eventId: event.id,
          id: registrationId,
          registrationOptionId: option.id,
          status,
          tenantId,
          userId: user.id,
        });

        // For paid registrations, create a transaction record
        if (option.isPaid && paymentState) {
          transactions.push({
            amount: option.price,
            comment: `Ticket for ${event.title}`,
            currency,
            eventId: event.id,
            eventRegistrationId: registrationId,
            executiveUserId: user.id,
            id: getId(),
            method: 'stripe',
            status: paymentState,
            stripeChargeId: paymentState === 'successful' ? getId() : null,
            stripePaymentIntentId: getId(),
            targetUserId: user.id,
            tenantId,
            type: 'registration',
          });
        }
      }

      // Record realistic spot counts for batch processing
      optionUpdates.set(option.id, {
        checkedInSpots: checkedInCount,
        confirmedSpots: confirmedCount,
        waitlistSpots: waitlistCount,
      });
    }
  }

  // Every write is awaited so a failed seed cannot report success.
  if (registrations.length > 0) {
    await database.insert(schema.eventRegistrations).values(registrations);
  }

  if (transactions.length > 0) {
    await database.insert(schema.transactions).values(transactions);
  }

  if (optionUpdates.size > 0) {
    for (const [id, counts] of optionUpdates) {
      await database
        .update(schema.eventRegistrationOptions)
        .set({
          checkedInSpots: counts.checkedInSpots,
          confirmedSpots: counts.confirmedSpots,
          waitlistSpots: counts.waitlistSpots,
        })
        .where(eq(schema.eventRegistrationOptions.id, id));
    }
  }
  consola.success(
    `Created ${registrations.length} registrations and ${transactions.length} transactions`,
  );
  return registrations;
}
