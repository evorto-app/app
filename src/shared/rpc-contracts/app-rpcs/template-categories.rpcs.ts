import * as RpcGroup from '@effect/rpc/RpcGroup';

import { TemplateCategoriesFindMany, TemplateCategoriesCreate, TemplateCategoriesUpdate } from './definitions';

export class TemplateCategoriesRpcs extends RpcGroup.make(
  TemplateCategoriesFindMany,
  TemplateCategoriesCreate,
  TemplateCategoriesUpdate,
) {}
