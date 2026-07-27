import { and, eq, gte } from 'drizzle-orm';
import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { Database } from '../../../../../db';
import { createId } from '../../../../../db/create-id';
import { financeReceiptUploads } from '../../../../../db/schema';
import {
  RpcBadRequestError,
  RpcForbiddenError,
} from '../../../../../shared/errors/rpc-errors';
import {
  FinanceResourceNotFoundError,
  ReceiptMediaInternalError,
} from '../../../../../shared/rpc-contracts/app-rpcs/finance.errors';
import { safeServerErrorSummary } from '../../../../utils/safe-server-error-summary';
import { RpcAccess } from '../shared/rpc-access.service';
import { canSubmitEventReceipts, databaseEffect } from './finance.shared';
import {
  buildReceiptUploadStorageKey,
  ReceiptMediaService,
  validateReceiptUploadMetadata,
} from './receipt-media.service';

const UPLOAD_POLICY_TTL_MILLISECONDS = 5 * 60 * 1000;

const storageMutationError = (message: string) =>
  new ReceiptMediaInternalError({ message });

const mapStorageMutationError =
  (operation: string, message: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, ReceiptMediaInternalError, R> =>
    effect.pipe(
      Effect.tapError((error) =>
        Effect.logError(message).pipe(
          Effect.annotateLogs(safeServerErrorSummary(operation, error)),
        ),
      ),
      Effect.mapError(() => storageMutationError(message)),
    );

const finalizedUpload = (upload: {
  fileName: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
}) => ({
  fileName: upload.fileName,
  mimeType: upload.mimeType,
  sizeBytes: upload.sizeBytes,
  uploadId: upload.id,
});

export const financeMediaHandlers = {
  'finance.receiptMedia.createUpload': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      yield* validateReceiptUploadMetadata({
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });

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
          columns: { id: true },
          where: { id: input.eventId, tenantId: tenant.id },
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

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + UPLOAD_POLICY_TTL_MILLISECONDS,
      );
      const uploadId = createId();
      const storageKey = buildReceiptUploadStorageKey({
        eventId: input.eventId,
        fileName: input.fileName,
        tenantId: tenant.id,
        uploadId,
        userId: user.id,
      });
      const inserted = yield* Database.use((database) =>
        database
          .insert(financeReceiptUploads)
          .values({
            consumedAt: null,
            eventId: input.eventId,
            expiresAt,
            fileName: input.fileName,
            id: uploadId,
            mimeType: input.mimeType,
            rejectionReason: null,
            sizeBytes: input.sizeBytes,
            status: 'pending',
            storageKey,
            tenantId: tenant.id,
            uploadedAt: null,
            uploadedByUserId: user.id,
          })
          .returning({ id: financeReceiptUploads.id }),
      ).pipe(
        mapStorageMutationError(
          'receiptMedia.upload.prepare',
          'Failed to prepare receipt upload',
        ),
      );
      if (inserted.length !== 1) {
        return yield* Effect.fail(
          storageMutationError('Failed to prepare receipt upload'),
        );
      }

      const signed = yield* ReceiptMediaService.createUploadPolicy({
        eventId: input.eventId,
        expiresAt,
        fileName: input.fileName,
        mimeType: input.mimeType,
        now,
        sizeBytes: input.sizeBytes,
        tenantId: tenant.id,
        uploadId,
        userId: user.id,
      });

      return {
        expiresAt: expiresAt.toISOString(),
        fields: signed.fields,
        uploadId,
        url: signed.url,
      };
    }),

  'finance.receiptMedia.finalizeUpload': (input, _options) =>
    Effect.gen(function* () {
      yield* RpcAccess.ensureAuthenticated();
      const { tenant } = yield* RpcAccess.current();
      const user = yield* RpcAccess.requireUser();
      const loadUpload = Database.use((database) =>
        database.query.financeReceiptUploads.findFirst({
          columns: {
            eventId: true,
            expiresAt: true,
            fileName: true,
            id: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            storageKey: true,
          },
          where: {
            id: input.uploadId,
            tenantId: tenant.id,
            uploadedByUserId: user.id,
          },
        }),
      ).pipe(
        mapStorageMutationError(
          'receiptMedia.upload.load',
          'Failed to load receipt upload',
        ),
      );
      const upload = yield* loadUpload;
      if (!upload) {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Receipt upload is unavailable',
            reason: 'receipt_upload_unavailable',
          }),
        );
      }

      const canSubmit = yield* canSubmitEventReceipts(
        tenant.id,
        user,
        upload.eventId,
      );
      if (!canSubmit) {
        return yield* Effect.fail(
          new RpcForbiddenError({
            message: 'Forbidden',
            permission: `finance:submitReceipts:${upload.eventId}`,
          }),
        );
      }
      if (upload.status === 'ready') {
        return finalizedUpload(upload);
      }
      if (upload.status !== 'pending') {
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Receipt upload cannot be finalized',
            reason: 'receipt_upload_unavailable',
          }),
        );
      }

      const now = new Date();
      if (upload.expiresAt.getTime() <= now.getTime()) {
        yield* Database.use((database) =>
          database
            .update(financeReceiptUploads)
            .set({ rejectionReason: 'expired', status: 'rejected' })
            .where(
              and(
                eq(financeReceiptUploads.id, upload.id),
                eq(financeReceiptUploads.status, 'pending'),
              ),
            ),
        ).pipe(
          mapStorageMutationError(
            'receiptMedia.upload.expire',
            'Failed to expire receipt upload',
          ),
        );
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Receipt upload has expired',
            reason: 'receipt_upload_expired',
          }),
        );
      }

      const claimedRows = yield* Database.use((database) =>
        database
          .update(financeReceiptUploads)
          .set({ status: 'finalizing' })
          .where(
            and(
              eq(financeReceiptUploads.id, upload.id),
              eq(financeReceiptUploads.tenantId, tenant.id),
              eq(financeReceiptUploads.eventId, upload.eventId),
              eq(financeReceiptUploads.uploadedByUserId, user.id),
              eq(financeReceiptUploads.storageKey, upload.storageKey),
              eq(financeReceiptUploads.status, 'pending'),
              gte(financeReceiptUploads.expiresAt, now),
            ),
          )
          .returning({
            eventId: financeReceiptUploads.eventId,
            fileName: financeReceiptUploads.fileName,
            id: financeReceiptUploads.id,
            mimeType: financeReceiptUploads.mimeType,
            sizeBytes: financeReceiptUploads.sizeBytes,
            storageKey: financeReceiptUploads.storageKey,
          }),
      ).pipe(
        mapStorageMutationError(
          'receiptMedia.upload.claim',
          'Failed to claim receipt upload for finalization',
        ),
      );
      const claimed = claimedRows[0];
      if (!claimed) {
        const concurrent = yield* loadUpload;
        if (concurrent?.status === 'ready') {
          return finalizedUpload(concurrent);
        }
        return yield* Effect.fail(
          new RpcBadRequestError({
            message: 'Receipt upload is already being finalized',
            reason: 'receipt_upload_unavailable',
          }),
        );
      }

      const inspected = yield* ReceiptMediaService.inspectUpload({
        eventId: claimed.eventId,
        fileName: claimed.fileName,
        mimeType: claimed.mimeType,
        sizeBytes: claimed.sizeBytes,
        storageKey: claimed.storageKey,
        tenantId: tenant.id,
        uploadId: claimed.id,
        userId: user.id,
      }).pipe(
        Effect.tapErrorTag('ReceiptMediaBadRequestError', (error) =>
          Database.use((database) =>
            database
              .update(financeReceiptUploads)
              .set({ rejectionReason: error.message, status: 'rejected' })
              .where(
                and(
                  eq(financeReceiptUploads.id, upload.id),
                  eq(financeReceiptUploads.status, 'finalizing'),
                ),
              ),
          ).pipe(
            mapStorageMutationError(
              'receiptMedia.upload.reject',
              'Failed to reject receipt upload',
            ),
          ),
        ),
      );
      const completed = yield* Database.use((database) =>
        database
          .update(financeReceiptUploads)
          .set({
            rejectionReason: null,
            status: 'ready',
            storageKey: inspected.storageKey,
            uploadedAt: now,
          })
          .where(
            and(
              eq(financeReceiptUploads.id, upload.id),
              eq(financeReceiptUploads.tenantId, tenant.id),
              eq(financeReceiptUploads.eventId, upload.eventId),
              eq(financeReceiptUploads.uploadedByUserId, user.id),
              eq(financeReceiptUploads.storageKey, claimed.storageKey),
              eq(financeReceiptUploads.status, 'finalizing'),
            ),
          )
          .returning({
            fileName: financeReceiptUploads.fileName,
            id: financeReceiptUploads.id,
            mimeType: financeReceiptUploads.mimeType,
            sizeBytes: financeReceiptUploads.sizeBytes,
          }),
      ).pipe(
        mapStorageMutationError(
          'receiptMedia.upload.finalize',
          'Failed to finalize receipt upload',
        ),
      );
      const finalized = completed[0];
      if (finalized) {
        return finalizedUpload(finalized);
      }

      yield* ReceiptMediaService.discardPromotedUpload(inspected.storageKey);
      return yield* Effect.fail(
        new RpcBadRequestError({
          message: 'Receipt upload could not be finalized',
          reason: 'receipt_upload_unavailable',
        }),
      );
    }),
} satisfies Partial<AppRpcHandlers>;
