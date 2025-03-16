import { TRPCError } from '@trpc/server';
import { Schema } from 'effect';

import { database } from '../../../db';
import { authenticatedProcedure } from '../trpc-server';

export const registrationScannedProcedure = authenticatedProcedure
  .input(
    Schema.decodeUnknownSync(
      Schema.Struct({
        registrationId: Schema.NonEmptyString,
      }),
    ),
  )
  .query(async ({ ctx, input }) => {
    const registration = await database.query.eventRegistrations.findFirst({
      where: { id: input.registrationId, tenantId: ctx.tenant.id },

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
    const sameUserIssue = registration.userId === ctx.user.id;
    const registrationStatusIssue = registration.status !== 'CONFIRMED';
    const allowCheckin = !registrationStatusIssue && !sameUserIssue;
    return {
      ...registration,
      allowCheckin,
      registrationStatusIssue,
      sameUserIssue,
    };
  });
