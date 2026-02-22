import { Effect } from 'effect';

import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
import { RpcRequestContextMiddleware } from '../../../shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import {
  adminHandlers,
  configHandlers,
  discountHandlers,
  editorMediaHandlers,
  eventHandlers,
  financeHandlers,
  globalAdminHandlers,
  iconHandlers,
  taxRateHandlers,
  templateCategoryHandlers,
  templateHandlers,
  userHandlers,
} from './handlers';

export const ServerAppRpcs = AppRpcs.middleware(RpcRequestContextMiddleware);

const handlers = ServerAppRpcs.of({
  ...adminHandlers,
  ...configHandlers,
  ...discountHandlers,
  ...editorMediaHandlers,
  ...eventHandlers,
  ...financeHandlers,
  ...globalAdminHandlers,
  ...iconHandlers,
  ...taxRateHandlers,
  ...templateCategoryHandlers,
  ...templateHandlers,
  ...userHandlers,
});

export const appRpcHandlers = ServerAppRpcs.toLayer(Effect.succeed(handlers));
