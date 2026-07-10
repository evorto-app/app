import { and, eq, isNull } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import { financeReceiptUploads } from '../../../../../db/schema';
import { RpcForbiddenError } from '../../../../../shared/errors/rpc-errors';
import {
  FinanceResourceNotFoundError,
  ReceiptMediaInternalError,
} from '../../../../../shared/rpc-contracts/app-rpcs/finance.errors';
import { RpcAccess } from '../shared/rpc-access.service';
import { canSubmitEventReceipts, databaseEffect } from './finance.shared';
import {
  buildReceiptStorageKey,
  ReceiptMediaService,
} from './receipt-media.service';

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

      const uploadId = createId();
      const storageKey = buildReceiptStorageKey({
        eventId: input.eventId,
        fileName: input.fileName,
        tenantId: tenant.id,
        uploadId,
        userId: user.id,
      });
      const preflightRows = yield* Database.use((database) =>
        database
          .insert(financeReceiptUploads)
          .values({
            consumedAt: null,
            eventId: input.eventId,
            fileName: input.fileName,
            id: uploadId,
            mimeType: input.mimeType,
            sizeBytes: input.fileSizeBytes,
            storageKey,
            storageUrl: null,
            tenantId: tenant.id,
            uploadedAt: null,
            uploadedByUserId: user.id,
          })
          .returning({ id: financeReceiptUploads.id }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ReceiptMediaInternalError({
              cause,
              message: 'Failed to prepare receipt upload',
            }),
        ),
      );
      const preflight = preflightRows[0];
      if (!preflight) {
        return yield* Effect.die(
          new Error(
            `Receipt upload preflight returned no rows for event ${input.eventId}`,
          ),
        );
      }

      const uploaded = yield* ReceiptMediaService.uploadOriginal({
        eventId: input.eventId,
        fileBase64: input.fileBase64,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType,
        tenantId: tenant.id,
        uploadId,
        userId: user.id,
      });
      const completedRows = yield* Database.use((database) =>
        database
          .update(financeReceiptUploads)
          .set({
            storageUrl: uploaded.storageUrl,
            uploadedAt: new Date(),
          })
          .where(
            and(
              eq(financeReceiptUploads.id, uploadId),
              eq(financeReceiptUploads.tenantId, tenant.id),
              eq(financeReceiptUploads.eventId, input.eventId),
              eq(financeReceiptUploads.uploadedByUserId, user.id),
              eq(financeReceiptUploads.storageKey, uploaded.storageKey),
              isNull(financeReceiptUploads.uploadedAt),
              isNull(financeReceiptUploads.consumedAt),
            ),
          )
          .returning({ id: financeReceiptUploads.id }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ReceiptMediaInternalError({
              cause,
              message: 'Failed to finalize receipt upload',
            }),
        ),
      );
      if (completedRows.length !== 1) {
        return yield* Effect.fail(
          new ReceiptMediaInternalError({
            message: 'Failed to finalize receipt upload',
          }),
        );
      }

      return {
        uploadId,
      };
    }),
} satisfies Partial<AppRpcHandlers>;
