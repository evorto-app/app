import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { RpcForbiddenError } from '../../../../../shared/errors/rpc-errors';
import { FinanceResourceNotFoundError } from '../../../../../shared/rpc-contracts/app-rpcs/finance.errors';
import { RpcAccess } from '../shared/rpc-access.service';
import { canSubmitEventReceipts, databaseEffect } from './finance.shared';
import { ReceiptMediaService } from './receipt-media.service';

export const financeMediaHandlers = {
  'finance.receiptMedia.uploadOriginal': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const canSubmit = yield* canSubmitEventReceipts(
        tenant.id,
        user,
        input.eventId,
      );
      if (!canSubmit) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message: 'Forbidden',
            permission: `finance:submitReceipts:${input.eventId}`,
          }),
        );
      }

      const event = yield* databaseEffect((database) =>
        database.query.eventInstances.findFirst({
          columns: {
            id: true,
          },
          where: {
            id: input.eventId,
            tenantId: tenant.id,
          },
        }),
      );
      if (!event) {
        return yield* Effect.fail(
          new FinanceResourceNotFoundError({
            id: input.eventId,
            message: 'Event not found for receipt upload',
            resource: 'event',
          }),
        );
      }

      const uploaded = yield* ReceiptMediaService.uploadOriginal({
        eventId: input.eventId,
        fileBase64: input.fileBase64,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType,
        tenantId: tenant.id,
        userId: user.id,
      });

      return {
        sizeBytes: input.fileSizeBytes,
        storageKey: uploaded.storageKey,
        storageUrl: uploaded.storageUrl,
      };
    }),
} satisfies Partial<AppRpcHandlers>;
