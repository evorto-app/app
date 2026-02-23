import { describe, expect, it } from 'vitest';

import { AppRpcs } from '../../../../shared/rpc-contracts/app-rpcs';
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
} from './index';

describe('app rpc handlers coverage', () => {
  it('implements all rpc tags from AppRpcs exactly once', () => {
    const implementedHandlers = {
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
    };

    const implementedTags = Object.keys(implementedHandlers).toSorted();
    const rpcTags = [...AppRpcs.requests.keys()].toSorted();

    expect(implementedTags).toEqual(rpcTags);
  });
});
