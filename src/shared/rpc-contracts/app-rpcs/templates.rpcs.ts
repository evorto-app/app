import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import {
  literalUnion,
  nonNegativeNumber,
  pickStruct,
  positiveNumber,
} from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { EventLocation } from '../../../types/location';
import { iconSchema } from '../../types/icon';
import {
  TemplatesGroupedByCategoryError,
  TemplateSimpleRpcError,
} from './templates.errors';

export const TemplateRegistrationMode = literalUnion(
  'application',
  'fcfs',
  'random',
);

export const TemplateSimpleRegistrationInput = Schema.Struct({
  closeRegistrationOffset: nonNegativeNumber,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  esnCardDiscountedPrice: Schema.optional(Schema.NullOr(nonNegativeNumber)),
  isPaid: Schema.Boolean,
  openRegistrationOffset: nonNegativeNumber,
  price: nonNegativeNumber,
  registeredDescription: Schema.optional(Schema.NullOr(Schema.String)),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: positiveNumber,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
});

export const TemplateSimpleAddonRegistrationOptionKind = literalUnion(
  'organizer',
  'participant',
);

export const TemplateSimpleAddonInput = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  isPaid: Schema.Boolean,
  maxQuantityPerUser: positiveNumber,
  price: nonNegativeNumber,
  quantity: positiveNumber,
  registrationOptionKind: TemplateSimpleAddonRegistrationOptionKind,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: positiveNumber,
});

export const TemplateSimpleQuestionRegistrationOptionKind = literalUnion(
  'organizer',
  'participant',
);

export const TemplateSimpleQuestionInput = Schema.Struct({
  description: Schema.optional(Schema.NullOr(Schema.String)),
  registrationOptionKind: TemplateSimpleQuestionRegistrationOptionKind,
  required: Schema.Boolean,
  title: Schema.NonEmptyString,
});

export const TemplateSimpleInput = Schema.Struct({
  addOns: Schema.optional(
    Schema.mutable(Schema.Array(TemplateSimpleAddonInput)),
  ),
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  location: Schema.NullOr(EventLocation),
  organizerRegistration: TemplateSimpleRegistrationInput,
  participantRegistration: TemplateSimpleRegistrationInput,
  planningTips: Schema.optional(Schema.NullOr(Schema.String)),
  questions: Schema.optional(
    Schema.mutable(Schema.Array(TemplateSimpleQuestionInput)),
  ),
  title: Schema.NonEmptyString,
});

export const TemplateRoleRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export const TemplateRegistrationOptionRecord = Schema.Struct({
  closeRegistrationOffset: Schema.Number,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.NullOr(Schema.Number),
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

export const TemplateAddonRegistrationOptionRecord = Schema.Struct({
  quantity: Schema.Number,
  registrationOptionId: Schema.NonEmptyString,
});

export const TemplateAddonRecord = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  maxQuantityPerUser: Schema.Number,
  price: Schema.Number,
  registrationOptions: Schema.Array(TemplateAddonRegistrationOptionRecord),
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: Schema.Number,
});

export const TemplateQuestionRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  registrationOptionId: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: Schema.Number,
  title: Schema.NonEmptyString,
});

export const TemplateFindOneRecord = Schema.Struct({
  addOns: Schema.Array(TemplateAddonRecord),
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  id: Schema.NonEmptyString,
  location: Schema.NullOr(EventLocation),
  planningTips: Schema.NullOr(Schema.String),
  questions: Schema.Array(TemplateQuestionRecord),
  registrationOptions: Schema.Array(TemplateRegistrationOptionRecord),
  title: Schema.NonEmptyString,
});
export type TemplateFindOneRecord = Schema.Schema.Type<
  typeof TemplateFindOneRecord
>;

export const TemplateListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateListRecord = Schema.Schema.Type<typeof TemplateListRecord>;
export const TemplateIdRecord = pickStruct(TemplateListRecord, ['id']);
export type TemplateIdRecord = Schema.Schema.Type<typeof TemplateIdRecord>;

export const TemplatesCreateSimpleTemplate = asRpcMutation(
  Rpc.make('templates.createSimpleTemplate', {
    error: TemplateSimpleRpcError,
    payload: TemplateSimpleInput,
    success: TemplateIdRecord,
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
    success: TemplateIdRecord,
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
    error: TemplatesGroupedByCategoryError,
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
