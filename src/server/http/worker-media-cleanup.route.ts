import { Effect } from 'effect';
import { HttpRouter as HttpLayerRouter } from 'effect/unstable/http';

import { processReceiptOrphans } from '../finance/receipt-orphan-cleanup';
import { processTenantBrandAssetOrphans } from '../tenant-brand-assets';
import { handleWorkerTrigger } from './worker-email-delivery.route';

export const workerReceiptOrphanCleanupPath =
  '/internal/worker/receipt-orphan-cleanup';

// Reuse the existing private, scheduled worker trigger for both owned image stores.
export const workerReceiptOrphanCleanupRouteLayer = HttpLayerRouter.add(
  'POST',
  workerReceiptOrphanCleanupPath,
  (request) =>
    handleWorkerTrigger(request, ({ limit }) => {
      const options = limit === undefined ? {} : { batchSize: limit };
      return Effect.all(
        {
          brandAssets: processTenantBrandAssetOrphans(options),
          receipt: processReceiptOrphans(options),
        },
        { concurrency: 2 },
      ).pipe(
        Effect.map(({ brandAssets, receipt }) => ({ ...receipt, brandAssets })),
      );
    }),
);
