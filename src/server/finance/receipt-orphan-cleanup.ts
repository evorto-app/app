import { Database } from '@db/index';
import { financeReceiptUploads } from '@db/schema';
import { and, asc, eq, inArray, lte, or } from 'drizzle-orm';
import { Cause, Clock, Duration, Effect, Schedule } from 'effect';

import { ObjectStorage } from '../integrations/object-storage';

const defaultBatchSize = 25;
const maximumBatchSize = 100;
const pollingInterval = Duration.minutes(5);
const safetyGraceMilliseconds = 15 * 60 * 1000;
const readyOrphanRetentionMilliseconds = 24 * 60 * 60 * 1000;

type ReceiptUploadStatus = 'consumed' | 'pending' | 'ready' | 'rejected';

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

    return yield* Database.use((database) =>
      database.transaction((transaction) =>
        Effect.gen(function* () {
          const candidates = yield* transaction
            .select({
              id: financeReceiptUploads.id,
              storageKey: financeReceiptUploads.storageKey,
            })
            .from(financeReceiptUploads)
            .where(
              or(
                and(
                  inArray(financeReceiptUploads.status, [
                    'pending',
                    'rejected',
                  ]),
                  lte(financeReceiptUploads.expiresAt, expiredCutoff),
                ),
                and(
                  eq(financeReceiptUploads.status, 'ready'),
                  lte(financeReceiptUploads.updatedAt, readyCutoff),
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

          let deleted = 0;
          for (const candidate of candidates) {
            const exists = yield* objectStorage.exists(candidate.storageKey);
            if (exists) {
              yield* objectStorage.deleteObject(candidate.storageKey);
            }
            const rows = yield* transaction
              .delete(financeReceiptUploads)
              .where(
                and(
                  eq(financeReceiptUploads.id, candidate.id),
                  inArray(financeReceiptUploads.status, [
                    'pending',
                    'ready',
                    'rejected',
                  ]),
                ),
              )
              .returning({ id: financeReceiptUploads.id });
            deleted += rows.length;
          }

          return { deleted, scanned: candidates.length };
        }),
      ),
    );
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
