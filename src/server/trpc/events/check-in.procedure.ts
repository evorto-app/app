import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { authenticatedProcedure } from '../trpc-server';

export const checkInProcedure = authenticatedProcedure
  .input(
    Schema.decodeUnknownSync(
      Schema.Struct({
        registrationId: Schema.NonEmptyString,
      }),
    ),
  )
  .mutation(async ({ ctx, input }) => {
    const registration = await database.query.eventRegistrations.findFirst({
      where: { 
        id: input.registrationId, 
        tenantId: ctx.tenant.id 
      },
      with: {
        event: true,
        registrationOption: true,
        user: true,
      },
    });

    if (!registration) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Registration with id ${input.registrationId} not found`,
      });
    }

    // Validate registration can be checked in
    if (registration.userId === ctx.user.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You cannot check in your own registration',
      });
    }

    if (registration.status !== 'CONFIRMED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Registration must be confirmed before check-in',
      });
    }

    if (registration.checkInTime) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Registration has already been checked in',
      });
    }

    // Update registration with check-in time
    const updatedRegistration = await database
      .update(schema.eventRegistrations)
      .set({
        checkInTime: new Date(),
      })
      .where(
        and(
          eq(schema.eventRegistrations.id, input.registrationId),
          eq(schema.eventRegistrations.tenantId, ctx.tenant.id),
        ),
      )
      .returning()
      .then((result) => result[0]);

    if (!updatedRegistration) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update registration',
      });
    }

    return {
      ...registration,
      checkInTime: updatedRegistration.checkInTime,
    };
  });