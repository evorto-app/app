import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { EventListingAudience } from '@shared/event-listing-audience';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import {
  literalUnion,
  nonNegativeNumber,
  positiveNumber,
} from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { EventLocation } from '../../../types/location';
import { iconSchema } from '../../types/icon';
import {
  TemplateGraphRpcError,
  TemplatesGroupedByCategoryError,
  TemplateSimpleRpcError,
} from './templates.errors';

export const TemplateRegistrationMode = literalUnion('application', 'fcfs');

const NonNegativeInteger = nonNegativeNumber.check(Schema.isInt());
const PositiveInteger = positiveNumber.check(Schema.isInt());
const RegistrationAddonQuantity = NonNegativeInteger.check(
  Schema.isLessThanOrEqualTo(MAX_REGISTRATION_ADDON_QUANTITY),
);
const PositiveRegistrationAddonQuantity = PositiveInteger.check(
  Schema.isLessThanOrEqualTo(MAX_REGISTRATION_ADDON_QUANTITY),
);
const RegistrationQuestionDescription = Schema.NullOr(
  Schema.String.check(
    Schema.isMaxLength(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH),
  ),
);
const RegistrationQuestionTitle = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
);

export const TemplateRoleRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export const TemplateRegistrationOptionRecord = Schema.Struct({
  cancellationDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeNumber),
  closeRegistrationOffset: Schema.Number,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.NullOr(Schema.Number),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  refundFeesOnCancellation: Schema.NullOr(Schema.Boolean),
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  roles: Schema.Array(TemplateRoleRecord),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeNumber),
});

export const TemplateAddonRegistrationOptionRecord = Schema.Struct({
  includedQuantity: nonNegativeNumber,
  optionalPurchaseQuantity: nonNegativeNumber,
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
  description: RegistrationQuestionDescription,
  id: Schema.NonEmptyString,
  registrationOptionId: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: Schema.Number,
  title: RegistrationQuestionTitle,
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

export const TemplateGraphRegistrationOptionInput = Schema.Struct({
  cancellationDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeNumber),
  closeRegistrationOffset: nonNegativeNumber,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.NullOr(nonNegativeNumber),
  id: Schema.optional(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  key: Schema.NonEmptyString,
  openRegistrationOffset: nonNegativeNumber,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeNumber,
  refundFeesOnCancellation: Schema.NullOr(Schema.Boolean),
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: positiveNumber,
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeNumber),
});

export type TemplateGraphRegistrationOptionInput = Schema.Schema.Type<
  typeof TemplateGraphRegistrationOptionInput
>;

export const TemplateGraphAddonRegistrationOptionInput = Schema.Struct({
  includedQuantity: RegistrationAddonQuantity,
  optionalPurchaseQuantity: RegistrationAddonQuantity,
  registrationOptionKey: Schema.NonEmptyString,
});

export const TemplateGraphAddonInput = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  id: Schema.optional(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  key: Schema.NonEmptyString,
  maxQuantityPerUser: PositiveRegistrationAddonQuantity,
  price: nonNegativeNumber,
  registrationOptions: Schema.mutable(
    Schema.Array(TemplateGraphAddonRegistrationOptionInput),
  ),
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: positiveNumber,
});

export type TemplateGraphAddonInput = Schema.Schema.Type<
  typeof TemplateGraphAddonInput
>;

export const TemplateGraphQuestionInput = Schema.Struct({
  description: RegistrationQuestionDescription,
  id: Schema.optional(Schema.NonEmptyString),
  key: Schema.NonEmptyString,
  registrationOptionKey: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: nonNegativeNumber,
  title: RegistrationQuestionTitle,
});

export type TemplateGraphQuestionInput = Schema.Schema.Type<
  typeof TemplateGraphQuestionInput
>;

export const TemplateGraphInput = Schema.Struct({
  addOns: Schema.mutable(Schema.Array(TemplateGraphAddonInput)).check(
    Schema.isMaxLength(MAX_EVENT_ADDON_TYPES),
  ),
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  listingAudience: EventListingAudience,
  location: Schema.NullOr(EventLocation),
  planningTips: Schema.NullOr(Schema.String),
  questions: Schema.mutable(Schema.Array(TemplateGraphQuestionInput)).check(
    Schema.isMaxLength(MAX_REGISTRATION_QUESTIONS),
  ),
  registrationOptions: Schema.mutable(
    Schema.Array(TemplateGraphRegistrationOptionInput),
  ),
  simpleModeEnabled: Schema.Boolean,
  title: Schema.NonEmptyString,
});

export type TemplateGraphInput = Schema.Schema.Type<typeof TemplateGraphInput>;

export const TemplateGraphRecord = Schema.Struct({
  ...TemplateFindOneRecord.fields,
  listingAudience: EventListingAudience,
  simpleModeEnabled: Schema.Boolean,
});

export type TemplateGraphRecord = Schema.Schema.Type<
  typeof TemplateGraphRecord
>;

export const TemplateListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateListRecord = Schema.Schema.Type<typeof TemplateListRecord>;

export const TemplatesCreate = asRpcMutation(
  Rpc.make('templates.create', {
    error: TemplateGraphRpcError,
    payload: TemplateGraphInput,
    success: TemplateGraphRecord,
  }),
);

export const TemplatesFindOne = asRpcQuery(
  Rpc.make('templates.findOne', {
    error: TemplateSimpleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: TemplateGraphRecord,
  }),
);

export const TemplatesUpdate = asRpcMutation(
  Rpc.make('templates.update', {
    error: TemplateGraphRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
      ...TemplateGraphInput.fields,
    }),
    success: TemplateGraphRecord,
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
  TemplatesCreate,
  TemplatesFindOne,
  TemplatesGroupedByCategory,
  TemplatesUpdate,
) {}
