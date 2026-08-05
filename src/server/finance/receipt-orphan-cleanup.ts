import { Database } from '@db/index';
import { financeReceiptUploads } from '@db/schema';
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm';
import { Cause, Clock, Data, Duration, Effect, Schedule } from 'effect';

import {
  ObjectStorage,
  ObjectStorageNotFoundError,
} from '../integrations/object-storage';

const defaultBatchSize = 25;
const maximumBatchSize = 100;
const pollingInterval = Duration.minutes(5);
const safetyGraceMilliseconds = 15 * 60 * 1000;
const readyOrphanRetentionMilliseconds = 24 * 60 * 60 * 1000;

type ReceiptUploadStatus =
  'cleaning' | 'consumed' | 'finalizing' | 'pending' | 'ready' | 'rejected';

export class ReceiptOrphanCleanupError extends Data.TaggedError(
  'ReceiptOrphanCleanupError',
)<{
  readonly failedUploadIds: readonly string[];
}> {}

export const normalizeReceiptOrphanBatchSize = (
  batchSize = defaultBatchSize,
) =>
  Number.isFinite(batchSize)
    ? Math.min(maximumBatchSize, Math.max(1, Math.trunc(batchSize)))
    : defaultBatchSize;

export const isReceiptUploadOrphan = (input: {
  readonly expiresAt: Date;
  readonly now: Date;
  readonly status: ReceiptUploadStatus;
  readonly updatedAt: Date;
}) => {
  if (input.status === 'consumed') {
    return false;
  }
  if (input.status === 'cleaning') {
    return (
      input.updatedAt.getTime() <= input.now.getTime() - safetyGraceMilliseconds
    );
  }
  if (input.status === 'ready') {
    return (
      input.updatedAt.getTime() <=
      input.now.getTime() - readyOrphanRetentionMilliseconds
    );
  }
  return (
    input.expiresAt.getTime() <= input.now.getTime() - safetyGraceMilliseconds
  );
};

export const processReceiptOrphans = Effect.fn('processReceiptOrphans')(
  function* (options: { batchSize?: number; now?: Date } = {}) {
    const objectStorage = yield* ObjectStorage;
    const now = options.now ?? new Date(yield* Clock.currentTimeMillis);
    const batchSize = normalizeReceiptOrphanBatchSize(options.batchSize);
    const expiredCutoff = new Date(now.getTime() - safetyGraceMilliseconds);
    const readyCutoff = new Date(
      now.getTime() - readyOrphanRetentionMilliseconds,
    );

    const candidates = yield* Database.use((database) =>
      database.transaction((transaction) =>
        Effect.gen(function* () {
          const rows = yield* transaction
            .select({
              id: financeReceiptUploads.id,
              storageKey: financeReceiptUploads.storageKey,
            })
            .from(financeReceiptUploads)
            .where(
              or(
                and(
                  inArray(financeReceiptUploads.status, [
                    'finalizing',
                    'pending',
                    'rejected',
                  ]),
                  lte(financeReceiptUploads.expiresAt, expiredCutoff),
                ),
                and(
                  eq(financeReceiptUploads.status, 'ready'),
                  lte(financeReceiptUploads.updatedAt, readyCutoff),
                ),
                and(
                  eq(financeReceiptUploads.status, 'cleaning'),
                  lte(financeReceiptUploads.updatedAt, expiredCutoff),
                ),
              ),
            )
            .orderBy(
              asc(financeReceiptUploads.updatedAt),
              asc(financeReceiptUploads.id),
            )
            .limit(batchSize)
            .for('update', {
              of: financeReceiptUploads,
              skipLocked: true,
            });

          if (rows.length === 0) {
            return [];
          }
          return yield* transaction
            .update(financeReceiptUploads)
            .set({ status: 'cleaning', updatedAt: now })
            .where(
              inArray(
                financeReceiptUploads.id,
                rows.map((row) => row.id),
              ),
            )
            .returning({
              id: financeReceiptUploads.id,
              storageKey: financeReceiptUploads.storageKey,
            });
        }),
      ),
    );

    let deleted = 0;
    const failedUploadIds: string[] = [];
    for (const candidate of candidates) {
      const storageDeleted = yield* objectStorage
        .deleteObject(candidate.storageKey)
        .pipe(
          Effect.as(true),
          Effect.catch((error) =>
            error instanceof ObjectStorageNotFoundError
              ? Effect.succeed(true)
              : Effect.logError(
                  'Failed to delete claimed receipt orphan from storage',
                ).pipe(
                  Effect.annotateLogs({ uploadId: candidate.id }),
                  Effect.as(false),
                ),
          ),
        );
      if (!storageDeleted) {
        failedUploadIds.push(candidate.id);
        continue;
      }

      const databaseDeleted = yield* Database.use((database) =>
        database
          .delete(financeReceiptUploads)
          .where(
            and(
              eq(financeReceiptUploads.id, candidate.id),
              eq(financeReceiptUploads.status, 'cleaning'),
            ),
          )
          .returning({ id: financeReceiptUploads.id }),
      ).pipe(
        Effect.map((rows) => rows.length === 1),
        Effect.catch(() =>
          Effect.logError(
            'Failed to delete claimed receipt orphan database row',
          ).pipe(
            Effect.annotateLogs({ uploadId: candidate.id }),
            Effect.as(false),
          ),
        ),
      );
      if (!databaseDeleted) {
        failedUploadIds.push(candidate.id);
        continue;
      }
      deleted += 1;
    }

    if (failedUploadIds.length > 0) {
      return yield* Effect.fail(
        new ReceiptOrphanCleanupError({ failedUploadIds }),
      );
    }

    return { deleted, scanned: candidates.length };
  },
);

const runReceiptOrphanCleanupIteration = processReceiptOrphans().pipe(
  Effect.tap((summary) =>
    summary.scanned > 0
      ? Effect.logInfo('Processed receipt upload orphans').pipe(
          Effect.annotateLogs(summary),
        )
      : Effect.void,
  ),
  Effect.catchCause((cause) =>
    Cause.hasInterrupts(cause)
      ? Effect.failCause(cause)
      : Effect.logError('Receipt orphan cleanup iteration failed').pipe(
          Effect.annotateLogs({ cause: String(cause) }),
        ),
  ),
);

export const runReceiptOrphanCleanupWorker =
  runReceiptOrphanCleanupIteration.pipe(
    Effect.repeat(Schedule.spaced(pollingInterval)),
  );
