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
 * 9. Handles various registration and payment statuses for comprehensive testing scenarios
 */
import { InferInsertModel, SQL, inArray, sql } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
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
    id?: string;
    isPaid: boolean;
    price: number;
    roleIds: string[];
    spots: number;
  }[];
  start: Date | string;
  tenantId?: string;
  title?: string;
}

/**
 * Adds realistic event registrations to the database.
 *
 * This helper creates varied registration patterns to simulate real-world usage:
 * - Some events are fully booked with waitlists
 * - Others have varying levels of popularity and availability
 * - Past events include realistic check-in patterns
 * - Payment statuses reflect real scenarios (successful, pending, failed)
 * - Uses batch inserts for improved performance during database setup
 *
 * @param database - The database connection
 * @param events - The events to create registrations for (with simplified input)
 * @returns The created registrations
 */
export async function addRegistrations(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  events: EventRegistrationInput[],
  seedDate?: Date,
) {
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
    console.warn('No users found for registrations');
    return [];
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
        if (!seen.has(u.id)) {
          seen.add(u.id);
          result.push(u);
        }
      }
    }
    return result;
  };

  // Get the default tenant for fallback values
  const defaultTenant = await database.query.tenants.findFirst();
  if (!defaultTenant) {
    console.warn('No tenant found for registrations');
    return [];
  }
  const defaultCurrency = defaultTenant.currency || 'EUR';

  const testerUserIds = new Set(usersToAuthenticate.map((user) => user.id));
  const seededCountByUser = new Map<string, number>();
  const MAX_REGISTRATIONS_PER_USER = 4;
  const MAX_REGISTRATIONS_PER_TEST_USER = 1;

  // Process each event with varied registration patterns
  for (const [eventIndex, event] of events.entries()) {
    // Skip events without valid data
    if (!event.id || !event.registrationOptions?.length) {
      continue;
    }

    // Determine event popularity and registration patterns
    const eventDate = new Date(event.start);
    const now = getSeedDate(seedDate ?? new Date());
    const isPastEvent = eventDate < now;
    const isUpcomingEvent =
      eventDate > now &&
      eventDate < new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

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
      // Ensure option has an ID
      if (!option.id) {
        console.warn('Registration option missing ID, skipping');
        continue;
      }

      // Get tenantId for this event
      const tenantId = event.tenantId || defaultTenant.id;

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
      const shuffledUsers = eligibleUsers.slice();
      for (let i = shuffledUsers.length - 1; i > 0; i--) {
        const j = randNumber({ min: 0, max: i });
        const tmp = shuffledUsers[i];
        shuffledUsers[i] = shuffledUsers[j];
        shuffledUsers[j] = tmp;
      }

      const selectedUsers: (typeof users)[number][] = [];
      for (const user of shuffledUsers) {
        const limit = testerUserIds.has(user.id)
          ? MAX_REGISTRATIONS_PER_TEST_USER
          : MAX_REGISTRATIONS_PER_USER;
        const currentCount = seededCountByUser.get(user.id) ?? 0;
        if (currentCount >= limit) {
          continue;
        }
        selectedUsers.push(user);
        if (selectedUsers.length >= totalRegistrations) {
          break;
        }
      }

      // Create registrations
      for (let index = 0; index < selectedUsers.length; index++) {
        const user = selectedUsers[index];

        // Get userTenant relationship for this specific tenant
        const userTenantRelation = user.tenantAssignments?.find(
          (t) => t.tenantId === tenantId,
        );

        // Generate IDs for the registration and transaction
        const registrationId = getId();

        // Determine registration status based on various factors
        let status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
        let paymentStatus: 'PAID' | 'PENDING' | 'REFUNDED' | null = null;
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
              paymentStatus = 'PAID';
              confirmedCount++;
            } else if (paymentScenario < 0.95) {
              status = 'PENDING';
              paymentStatus = 'PENDING';
            } else {
              status = 'CANCELLED';
              paymentStatus = 'REFUNDED';
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
          checkInTime,
          eventId: event.id,
          id: registrationId,
          paymentStatus,
          registrationOptionId: option.id,
          status,
          tenantId,
          userId: user.id,
        });

        const previousCount = seededCountByUser.get(user.id) ?? 0;
        seededCountByUser.set(user.id, previousCount + 1);

        // For paid registrations, create a transaction record
        if (option.isPaid && paymentStatus) {
          const transactionStatus =
            paymentStatus === 'PAID'
              ? 'successful'
              : paymentStatus === 'REFUNDED'
                ? 'cancelled'
                : 'pending';

          transactions.push({
            amount: option.price,
            comment: `Registration for event ${event.title || 'Untitled'}`,
            currency: defaultCurrency as 'AUD' | 'CZK' | 'EUR',
            eventId: event.id,
            eventRegistrationId: registrationId,
            executiveUserId: user.id,
            id: getId(),
            method: 'stripe',
            status: transactionStatus as 'cancelled' | 'pending' | 'successful',
            stripeChargeId: transactionStatus === 'successful' ? getId() : null,
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

  // Execute all operations in a transaction for atomicity
  try {
    await database.transaction(async (tx) => {
      // Insert all registrations in a single statement (no chunking)
      if (registrations.length > 0) {
        await tx.insert(schema.eventRegistrations).values(registrations);
      }

      // Insert all transactions in a single statement (no chunking)
      if (transactions.length > 0) {
        await tx.insert(schema.transactions).values(transactions);
      }

      // Multi-row UPDATE using CASE expressions in a single request
      const updatesArray = Array.from(optionUpdates.entries());
      if (updatesArray.length > 0) {
        const ids: string[] = [];
        const checkedSqlChunks: SQL[] = [];
        const confirmedSqlChunks: SQL[] = [];
        const waitlistSqlChunks: SQL[] = [];
        checkedSqlChunks.push(sql`(case`);
        confirmedSqlChunks.push(sql`(case`);
        waitlistSqlChunks.push(sql`(case`);
        for (const [id, c] of updatesArray) {
          checkedSqlChunks.push(
            sql`when ${schema.eventRegistrationOptions.id} = ${id} then cast(${c.checkedInSpots} as integer)`,
          );
          confirmedSqlChunks.push(
            sql`when ${schema.eventRegistrationOptions.id} = ${id} then cast(${c.confirmedSpots} as integer)`,
          );
          waitlistSqlChunks.push(
            sql`when ${schema.eventRegistrationOptions.id} = ${id} then cast(${c.waitlistSpots} as integer)`,
          );
          ids.push(id);
        }
        checkedSqlChunks.push(sql`end)`);
        confirmedSqlChunks.push(sql`end)`);
        waitlistSqlChunks.push(sql`end)`);
        const checkedFinal: SQL = sql.join(checkedSqlChunks, sql.raw(' '));
        const confirmedFinal: SQL = sql.join(confirmedSqlChunks, sql.raw(' '));
        const waitlistFinal: SQL = sql.join(waitlistSqlChunks, sql.raw(' '));

        await tx
          .update(schema.eventRegistrationOptions)
          .set({
            checkedInSpots: checkedFinal,
            confirmedSpots: confirmedFinal,
            waitlistSpots: waitlistFinal,
          })
          .where(inArray(schema.eventRegistrationOptions.id, ids));
      }
    });
  } catch (error) {
    consola.error('Failed to create registrations:', error);
    return [];
  }
  consola.success(
    `Created ${registrations.length} registrations and ${transactions.length} transactions`,
  );
  return registrations;
}
