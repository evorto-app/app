import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { Schema } from 'effect';

import { database } from '../../../db';
import * as schema from '../../../db/schema';
import { OptionPolicySchema } from '../../../shared/schemas/cancellation';
import { authenticatedProcedure, router } from '../trpc-server';

export const registrationOptionRouter = router({
  getCancellationPolicy: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          optionId: Schema.NonEmptyString,
          type: Schema.Literal('template', 'event'),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      let option;

      if (input.type === 'template') {
        option = await database.query.templateRegistrationOptions.findFirst({
          where: {
            id: input.optionId,
          },
          with: {
            template: {
              columns: { tenantId: true },
            },
          },
        });

        if (!option || option.template.tenantId !== ctx.tenant.id) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Template registration option not found',
          });
        }
      } else {
        option = await database.query.eventRegistrationOptions.findFirst({
          where: {
            id: input.optionId,
          },
          with: {
            event: {
              columns: { tenantId: true },
            },
          },
        });

        if (!option || option.event.tenantId !== ctx.tenant.id) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Event registration option not found',
          });
        }
      }

      return {
        useTenantDefault: option.useTenantCancellationPolicy,
        policy: option.cancellationPolicy,
      };
    }),

  setCancellationPolicy: authenticatedProcedure
    .input(
      Schema.standardSchemaV1(
        Schema.Struct({
          optionId: Schema.NonEmptyString,
          policy: OptionPolicySchema,
          type: Schema.Literal('template', 'event'),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const updateData = {
        useTenantCancellationPolicy: input.policy.useTenantDefault,
        cancellationPolicy: input.policy.useTenantDefault ? null : input.policy.policy,
      };

      if (input.type === 'template') {
        // Verify ownership and update template option
        const option = await database.query.templateRegistrationOptions.findFirst({
          where: { id: input.optionId },
          with: {
            template: {
              columns: { tenantId: true },
            },
          },
        });

        if (!option || option.template.tenantId !== ctx.tenant.id) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Template registration option not found',
          });
        }

        await database
          .update(schema.templateRegistrationOptions)
          .set(updateData)
          .where(eq(schema.templateRegistrationOptions.id, input.optionId));
      } else {
        // Verify ownership and update event option
        const option = await database.query.eventRegistrationOptions.findFirst({
          where: { id: input.optionId },
          with: {
            event: {
              columns: { tenantId: true },
            },
          },
        });

        if (!option || option.event.tenantId !== ctx.tenant.id) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Event registration option not found',
          });
        }

        await database
          .update(schema.eventRegistrationOptions)
          .set(updateData)
          .where(eq(schema.eventRegistrationOptions.id, input.optionId));
      }

      return { success: true };
    }),
});