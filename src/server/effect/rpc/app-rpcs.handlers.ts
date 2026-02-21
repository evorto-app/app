import { Effect } from 'effect';

import { AppRpcs } from '../../../shared/rpc-contracts/app-rpcs';
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

const handlers = AppRpcs.of({
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

export const appRpcHandlers = AppRpcs.toLayer(Effect.succeed(handlers));
