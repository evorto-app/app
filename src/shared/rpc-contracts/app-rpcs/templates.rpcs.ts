import * as RpcGroup from '@effect/rpc/RpcGroup';

import { TemplatesCreateSimpleTemplate, TemplatesFindOne, TemplatesGroupedByCategory, TemplatesUpdateSimpleTemplate } from './definitions';

export class TemplatesRpcs extends RpcGroup.make(
  TemplatesCreateSimpleTemplate,
  TemplatesFindOne,
  TemplatesGroupedByCategory,
  TemplatesUpdateSimpleTemplate,
) {}
