import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { iconSchema } from '../../types/icon';
export const TemplateCategoryRpcError = Schema.Literal(
  'FORBIDDEN',
  'UNAUTHORIZED',
);

export type TemplateCategoryRpcError = Schema.Schema.Type<
  typeof TemplateCategoryRpcError
>;

export const TemplateCategoryRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateCategoryRecord = Schema.Schema.Type<
  typeof TemplateCategoryRecord
>;

export const TemplateCategoriesFindMany = asRpcQuery(
  Rpc.make('templateCategories.findMany', {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplateCategoryRecord),
  }),
);

export const TemplateCategoriesCreate = asRpcMutation(
  Rpc.make('templateCategories.create', {
    error: TemplateCategoryRpcError,
    payload: Schema.Struct({
      icon: iconSchema,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const TemplateCategoriesUpdate = asRpcMutation(
  Rpc.make('templateCategories.update', {
    error: TemplateCategoryRpcError,
    payload: Schema.Struct({
      icon: iconSchema,
      id: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: TemplateCategoryRecord,
  }),
);

export class TemplateCategoriesRpcs extends RpcGroup.make(
  TemplateCategoriesFindMany,
  TemplateCategoriesCreate,
  TemplateCategoriesUpdate,
) {}
