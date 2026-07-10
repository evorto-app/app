import { RpcUnauthorizedError } from '@shared/errors/rpc-errors';
import { RegistrationTransferUnauthorizedError } from '@shared/rpc-contracts/app-rpcs/registration-transfers.errors';
import { Effect } from 'effect';

import type { AppRpcHandlers } from './shared/handler-types';

import { RegistrationTransferService } from '../../../registrations/registration-transfer.service';
import { RpcAccess } from './shared/rpc-access.service';

const requireTransferUser = RpcAccess.requireUser().pipe(
  Effect.mapError((error) =>
    error instanceof RpcUnauthorizedError
      ? new RegistrationTransferUnauthorizedError({
          message: 'Authenticated participant account required',
        })
      : error,
  ),
);

export const registrationTransferHandlers = {
  'registrationTransfers.cancel': ({ transferId }) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      const user = yield* requireTransferUser;
      const service = yield* RegistrationTransferService;
      return yield* service.cancel({
        tenant: context.tenant,
        transferId,
        user,
      });
    }),

  'registrationTransfers.claim': (input) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      const user = yield* requireTransferUser;
      const service = yield* RegistrationTransferService;
      return yield* service.claim({
        addOns: input.addOns,
        answers: input.answers,
        credential: input.credential,
        guestCount: input.guestCount,
        tenant: context.tenant,
        user,
      });
    }),

  'registrationTransfers.createOffer': ({ registrationId }) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      const user = yield* requireTransferUser;
      const service = yield* RegistrationTransferService;
      return yield* service.createOffer({
        registrationId,
        tenant: context.tenant,
        user,
      });
    }),

  'registrationTransfers.getClaim': ({ credential }) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      const user = yield* requireTransferUser;
      const service = yield* RegistrationTransferService;
      return yield* service.getClaim({
        credential,
        tenant: context.tenant,
        user,
      });
    }),

  'registrationTransfers.retryCheckout': ({ transferId }) =>
    Effect.gen(function* () {
      const context = yield* RpcAccess.current();
      const user = yield* requireTransferUser;
      const service = yield* RegistrationTransferService;
      return yield* service.retryCheckout({
        tenant: context.tenant,
        transferId,
        user,
      });
    }),
} satisfies Partial<AppRpcHandlers>;
