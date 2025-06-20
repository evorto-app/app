/**
 * Registration Helper
 *
 * This helper creates deterministic event registrations for testing and development.
 *
 * Key features:
 * 1. Creates registrations for approximately 70% of spots in each event
 * 2. For paid registrations, creates associated transactions as if Stripe webhooks fired
 * 3. Excludes admin user from seeded registrations
 * 4. Only paid registrations can be pending; free registrations are confirmed immediately
 * 5. Uses batch operations for efficient database seeding
 * 6. Simulates the complete registration flow including Stripe webhook processing
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
    spots: number;
  }[];
  tenantId?: string;
  title?: string;
}

/**
 * Adds deterministic event registrations to the database.
 *
 * This helper ensures that most events have registered users.
 * It simulates the registration process, including Stripe webhooks for paid registrations.
 * Uses batch inserts for improved performance during database setup.
 *
 * @param database - The database connection
 * @param events - The events to create registrations for (with simplified input)
 * @returns The created registrations
 */
export async function addRegistrations(
  database: NeonDatabase<Record<string, never>, typeof relations>,
  events: EventRegistrationInput[],
) {
  // Query all users with their tenant relationships
  const usersRaw = await database.query.users.findMany({
    with: { tenants: true },
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
  const optionUpdates = new Map<string, number>();

  // Get the default tenant for fallback values
  const defaultTenant = await database.query.tenants.findFirst();
  if (!defaultTenant) {
    console.warn('No tenant found for registrations');
    return [];
  }
  const defaultCurrency = defaultTenant.currency || 'EUR';

  // Process each event
  for (const event of events) {
    // Skip events without valid data
    if (!event.id || !event.registrationOptions?.length) {
      continue;
    }

    // Process each registration option
    for (const option of event.registrationOptions) {
      // Ensure option has an ID
      if (!option.id) {
        console.warn('Registration option missing ID, skipping');
        continue;
      }

      // Calculate how many spots to fill (70% of available spots)
      const spotsToFill = Math.floor(option.spots * 0.7);
      let newConfirmedSpots = 0;

      // Create registrations for this option
      for (let index = 0; index < spotsToFill; index++) {
        const userIndex = index % users.length;
        const user = users[userIndex];

        // Get tenantId from user relationship or fall back to event tenant or default tenant
        const userTenantRelation = user.tenants?.[0];
        const tenantId =
          userTenantRelation?.id || event.tenantId || defaultTenant.id;

        // Generate IDs for the registration and transaction
        const registrationId = createId();

        // Determine registration status based on payment requirement
        const status = option.isPaid ? 'PENDING' : 'CONFIRMED';

        // Add registration to batch
        registrations.push({
          eventId: event.id,
          id: registrationId,
          registrationOptionId: option.id,
          status: status as 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST',
          tenantId,
          userId: user.id,
        });

        // For paid registrations, create a transaction record
        if (option.isPaid) {
          transactions.push({
            amount: option.price,
            comment: `Registration for event ${event.title || 'Untitled'}`,
            currency: defaultCurrency,
            eventId: event.id,
            eventRegistrationId: registrationId,
            executiveUserId: user.id,
            id: createId(),
            method: 'stripe',
            status: 'successful',
            stripeChargeId: createId(),
            stripePaymentIntentId: createId(),
            targetUserId: user.id,
            tenantId,
            type: 'registration',
          });
        }

        // Track new confirmed spots
        newConfirmedSpots++;
      }

      // Record option updates for batch processing
      if (newConfirmedSpots > 0) {
        optionUpdates.set(
          option.id,
          (option.confirmedSpots || 0) + newConfirmedSpots,
        );
      }
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

      // Update confirmed spots count for each registration option
      for (const [optionId, confirmedSpots] of optionUpdates.entries()) {
        await tx
          .update(schema.eventRegistrationOptions)
          .set({ confirmedSpots })
          .where(eq(schema.eventRegistrationOptions.id, optionId));
      }
    });
  } catch (error) {
    console.error('Failed to create registrations:', error);
    return [];
  }

  return registrations;
}
