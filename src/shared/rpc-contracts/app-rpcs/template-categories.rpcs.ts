import * as RpcGroup from '@effect/rpc/RpcGroup';

import { TemplateCategoriesCreate, TemplateCategoriesFindMany, TemplateCategoriesUpdate } from './definitions';

export class TemplateCategoriesRpcs extends RpcGroup.make(
  TemplateCategoriesFindMany,
  TemplateCategoriesCreate,
  TemplateCategoriesUpdate,
) {}
