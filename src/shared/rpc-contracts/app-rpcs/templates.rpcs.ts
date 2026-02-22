import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { iconSchema } from '../../types/icon';
import { TemplateCategoryRpcError } from './template-categories.rpcs';
export const TemplateSimpleRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type TemplateSimpleRpcError = Schema.Schema.Type<
  typeof TemplateSimpleRpcError
>;

export const TemplateRegistrationMode = Schema.Literal(
  'application',
  'fcfs',
  'random',
);

export const TemplateSimpleRegistrationInput = Schema.Struct({
  closeRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  price: Schema.Number.pipe(Schema.nonNegative()),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: Schema.Positive,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export const TemplateSimpleInput = Schema.Struct({
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  location: Schema.NullOr(Schema.Any),
  organizerRegistration: TemplateSimpleRegistrationInput,
  participantRegistration: TemplateSimpleRegistrationInput,
  title: Schema.NonEmptyString,
});

export const TemplateRoleRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export const TemplateRegistrationOptionRecord = Schema.Struct({
  closeRegistrationOffset: Schema.Number,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  roles: Schema.Array(TemplateRoleRecord),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
});

export const TemplateFindOneRecord = Schema.Struct({
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  id: Schema.NonEmptyString,
  location: Schema.NullOr(Schema.Any),
  registrationOptions: Schema.Array(TemplateRegistrationOptionRecord),
  title: Schema.NonEmptyString,
});

export const TemplateListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateListRecord = Schema.Schema.Type<typeof TemplateListRecord>;

export const TemplatesCreateSimpleTemplate = asRpcMutation(
  Rpc.make('templates.createSimpleTemplate', {
    error: TemplateSimpleRpcError,
    payload: TemplateSimpleInput,
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const TemplatesFindOne = asRpcQuery(
  Rpc.make('templates.findOne', {
    error: TemplateSimpleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: TemplateFindOneRecord,
  }),
);

export const TemplatesUpdateSimpleTemplate = asRpcMutation(
  Rpc.make('templates.updateSimpleTemplate', {
    error: TemplateSimpleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
      ...TemplateSimpleInput.fields,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const TemplatesByCategoryRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  templates: Schema.Array(TemplateListRecord),
  title: Schema.NonEmptyString,
});

export type TemplatesByCategoryRecord = Schema.Schema.Type<
  typeof TemplatesByCategoryRecord
>;

export const TemplatesGroupedByCategory = asRpcQuery(
  Rpc.make('templates.groupedByCategory', {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplatesByCategoryRecord),
  }),
);

export class TemplatesRpcs extends RpcGroup.make(
  TemplatesCreateSimpleTemplate,
  TemplatesFindOne,
  TemplatesGroupedByCategory,
  TemplatesUpdateSimpleTemplate,
) {}
