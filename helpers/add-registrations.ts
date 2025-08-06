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
import { InferInsertModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { createId } from '../src/db/create-id';
import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';

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
) {
  // Query all users with their tenant relationships and roles
  const usersRaw = await database.query.users.findMany({
    with: { 
      tenantAssignments: {
        with: {
          rolesToTenantUsers: {
            with: {
              role: true
            }
          }
        }
      }
    },
  });
  // Exclude admin user from registrations
  const users = usersRaw.filter((u) => u.email !== 'admin@evorto.app');

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

  // Get the default tenant for fallback values
  const defaultTenant = await database.query.tenants.findFirst();
  if (!defaultTenant) {
    console.warn('No tenant found for registrations');
    return [];
  }
  const defaultCurrency = defaultTenant.currency || 'EUR';

  // Helper function to check if user has required roles for a registration option
  const userHasRequiredRoles = (user: typeof users[0], roleIds: string[], tenantId: string) => {
    const userTenantAssignment = user.tenantAssignments?.find(t => t.tenantId === tenantId);
    if (!userTenantAssignment) return false;
    
    const userRoleIds = userTenantAssignment.rolesToTenantUsers?.map(r => r.role.id) || [];
    return roleIds.some(requiredRoleId => userRoleIds.includes(requiredRoleId));
  };

  // Process each event with varied registration patterns
  for (const [eventIndex, event] of events.entries()) {
    // Skip events without valid data
    if (!event.id || !event.registrationOptions?.length) {
      continue;
    }

    // Determine event popularity and registration patterns
    const eventDate = new Date(event.start);
    const now = new Date();
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
        fillPercentage = 0.8 + Math.random() * 0.1;
        checkInRate = 0.9;
        break;
      }
      case 2: {
        // Moderately popular (60-70% full)
        fillPercentage = 0.6 + Math.random() * 0.1;
        checkInRate = 0.85;
        break;
      }
      case 3: {
        // Less popular (30-50% full)
        fillPercentage = 0.3 + Math.random() * 0.2;
        checkInRate = 0.8;
        break;
      }
      case 4: {
        // New/unpopular events (10-30% full)
        fillPercentage = 0.1 + Math.random() * 0.2;
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

      // Filter users who have the required roles for this registration option
      const eligibleUsers = users.filter(user => 
        userHasRequiredRoles(user, option.roleIds, tenantId)
      );

      if (eligibleUsers.length === 0) {
        console.warn(`No eligible users found for registration option ${option.id} with roles ${option.roleIds.join(', ')}`);
        continue;
      }

      // Calculate registrations and waitlist
      const regularSpots = Math.floor(
        option.spots * Math.min(fillPercentage, 1),
      );
      const waitlistSpots = shouldHaveWaitlist
        ? Math.floor(option.spots * 0.2)
        : 0;
      const totalRegistrations = Math.min(regularSpots + waitlistSpots, eligibleUsers.length);

      let confirmedCount = 0;
      let waitlistCount = 0;
      let checkedInCount = 0;

      // Shuffle eligible users to create more realistic distribution
      const shuffledUsers = [...eligibleUsers].sort(() => Math.random() - 0.5);

      // Create registrations
      for (let index = 0; index < totalRegistrations; index++) {
        const user = shuffledUsers[index];

        // Get userTenant relationship for this specific tenant
        const userTenantRelation = user.tenantAssignments?.find(t => t.tenantId === tenantId);

        // Generate IDs for the registration and transaction
        const registrationId = createId();

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
            const paymentScenario = Math.random();
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
            if (Math.random() < confirmationRate) {
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
          Math.random() < checkInRate
        ) {
          // Check-in time between event start and 30 minutes after
          const eventStart = new Date(event.start);
          const checkInWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
          checkInTime = new Date(
            eventStart.getTime() + Math.random() * checkInWindow,
          );
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
            id: createId(),
            method: 'stripe',
            status: transactionStatus as 'cancelled' | 'pending' | 'successful',
            stripeChargeId:
              transactionStatus === 'successful' ? createId() : null,
            stripePaymentIntentId: createId(),
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
      // Batch insert all registrations
      if (registrations.length > 0) {
        await tx.insert(schema.eventRegistrations).values(registrations);
      }

      // Batch insert all transactions
      if (transactions.length > 0) {
        await tx.insert(schema.transactions).values(transactions);
      }

      // Update spot counts for each registration option
      for (const [optionId, counts] of optionUpdates.entries()) {
        await tx
          .update(schema.eventRegistrationOptions)
          .set({
            checkedInSpots: counts.checkedInSpots,
            confirmedSpots: counts.confirmedSpots,
            waitlistSpots: counts.waitlistSpots,
          })
          .where(eq(schema.eventRegistrationOptions.id, optionId));
      }
    });
  } catch (error) {
    console.error('Failed to create registrations:', error);
    return [];
  }

  return registrations;
}
