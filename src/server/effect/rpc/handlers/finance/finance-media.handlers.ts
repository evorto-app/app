import { Effect } from 'effect';

import type { AppRpcHandlers } from '../shared/handler-types';

import { RpcAccess } from '../shared/rpc-access.service';
import { ReceiptMediaService } from './receipt-media.service';

export const financeMediaHandlers = {
'finance.receiptMedia.uploadOriginal': (input, _options) =>
      Effect.gen(function* () {
        yield* RpcAccess.ensureAuthenticated();
        const { tenant } = yield* RpcAccess.current();
        const user = yield* RpcAccess.requireUser();

        const uploaded = yield* ReceiptMediaService.uploadOriginal({
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
