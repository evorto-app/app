import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import { authenticatedProcedure } from '../trpc-server';

export const eventParticipantsProcedure = authenticatedProcedure
  .input(
    Schema.decodeUnknownSync(
      Schema.Struct({
        eventId: Schema.NonEmptyString,
      }),
    ),
  )
  .query(async ({ ctx, input }) => {
    const event = await database.query.eventInstances.findFirst({
      where: { 
        id: input.eventId, 
        tenantId: ctx.tenant.id 
      },
    });

    if (!event) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Event with id ${input.eventId} not found`,
      });
    }

    const registrations = await database.query.eventRegistrations.findMany({
      where: { 
        eventId: input.eventId, 
        tenantId: ctx.tenant.id 
      },
      with: {
        user: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        registrationOption: {
          columns: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const stats = {
      total: registrations.length,
      confirmed: registrations.filter(r => r.status === 'CONFIRMED').length,
      checkedIn: registrations.filter(r => r.checkInTime !== null).length,
      pending: registrations.filter(r => r.status === 'PENDING').length,
    };

    return {
      event,
      registrations,
      stats,
    };
  });