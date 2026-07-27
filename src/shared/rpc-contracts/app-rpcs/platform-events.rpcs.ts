import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { EventCheckInTimingIssue } from '@shared/event-check-in';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import { nonNegativeNumber } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant, TenantTimezone } from '../../../types/custom/tenant';
import { EventLocation } from '../../../types/location';
import { iconSchema } from '../../types/icon';
import { EventCheckInUnavailableError } from './events.errors';
import { EventReviewStatus, EventsRegistrationStatus } from './events.rpcs';
import { IconRecord } from './icons.rpcs';
import {
  PlatformOperationRpcError,
  PlatformTenantMutationContext,
  PlatformTenantTarget,
} from './platform-operations.shared';
import {
  TemplateGraphInput,
  TemplateGraphRecord,
  TemplateRegistrationMode,
} from './templates.rpcs';

const nonNegativeInteger = nonNegativeNumber.check(Schema.isInt());
const registrationAddonQuantity = nonNegativeInteger.check(
  Schema.isLessThanOrEqualTo(MAX_REGISTRATION_ADDON_QUANTITY),
);
const registrationQuestionDescription = Schema.NullOr(
  Schema.String.check(
    Schema.isMaxLength(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH),
  ),
);
const registrationQuestionTitle = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_REGISTRATION_QUESTION_TITLE_LENGTH),
);

export const PlatformEventListRecord = Schema.Struct({
  announcementRoleCount: nonNegativeInteger,
  end: Schema.NonEmptyString,
  hasRegistrationOptions: Schema.Boolean,
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  status: EventReviewStatus,
  title: Schema.NonEmptyString,
});

export type PlatformEventListRecord = Schema.Schema.Type<
  typeof PlatformEventListRecord
>;

export const PlatformEventRegistrationOptionRecord = Schema.Struct({
  cancellationDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeInteger),
  checkedInSpots: nonNegativeInteger,
  closeRegistrationTime: Schema.NonEmptyString,
  confirmedSpots: nonNegativeInteger,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.NullOr(nonNegativeInteger),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeInteger,
  refundFeesOnCancellation: Schema.NullOr(Schema.Boolean),
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: nonNegativeInteger,
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeInteger),
});

export const PlatformEventWritableRegistrationOptionInput = Schema.Struct({
  ...PlatformEventRegistrationOptionRecord.fields,
  registrationMode: TemplateRegistrationMode,
});

export const PlatformEventAddonRegistrationOptionRecord = Schema.Struct({
  includedQuantity: registrationAddonQuantity,
  optionalPurchaseQuantity: registrationAddonQuantity,
  registrationOptionId: Schema.NonEmptyString,
});

export const PlatformEventAddonRecord = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  maxQuantityPerUser: Schema.Number.check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MAX_REGISTRATION_ADDON_QUANTITY),
  ),
  price: nonNegativeInteger,
  registrationOptions: Schema.Array(PlatformEventAddonRegistrationOptionRecord),
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: nonNegativeInteger,
});

export const PlatformEventQuestionRecord = Schema.Struct({
  description: registrationQuestionDescription,
  id: Schema.NonEmptyString,
  registrationOptionId: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: nonNegativeInteger,
  title: registrationQuestionTitle,
});

export const PlatformEventDetailRecord = Schema.Struct({
  addOns: Schema.Array(PlatformEventAddonRecord),
  announcementRoleIds: Schema.Array(Schema.NonEmptyString),
  creator: Schema.Struct({
    email: Schema.String,
    firstName: Schema.String,
    id: Schema.NonEmptyString,
    lastName: Schema.String,
  }),
  description: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  icon: iconSchema,
  id: Schema.NonEmptyString,
  location: Schema.NullOr(EventLocation),
  questions: Schema.Array(PlatformEventQuestionRecord),
  registrationCount: nonNegativeInteger,
  registrationOptions: Schema.Array(PlatformEventRegistrationOptionRecord),
  reviewedAt: Schema.NullOr(Schema.NonEmptyString),
  simpleModeEnabled: Schema.Boolean,
  start: Schema.NonEmptyString,
  status: EventReviewStatus,
  statusComment: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
});

export type PlatformEventDetailRecord = Schema.Schema.Type<
  typeof PlatformEventDetailRecord
>;

export const PlatformEventTarget = Schema.Struct({
  ...PlatformTenantTarget.fields,
  eventId: Schema.NonEmptyString,
});

export const PlatformEventMutationTarget = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  eventId: Schema.NonEmptyString,
});

export const PlatformEventsList = asRpcQuery(
  Rpc.make('platform.events.list', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: Schema.Array(PlatformEventListRecord),
  }),
);

export const PlatformEventFormOptionsRecord = Schema.Struct({
  creators: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      firstName: Schema.String,
      id: Schema.NonEmptyString,
      lastName: Schema.String,
    }),
  ),
  esnCardEnabled: Schema.Boolean,
  roles: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      name: Schema.NonEmptyString,
    }),
  ),
  taxRates: Schema.Array(
    Schema.Struct({
      displayName: Schema.NullOr(Schema.String),
      percentage: Schema.NullOr(Schema.String),
      stripeTaxRateId: Schema.NonEmptyString,
    }),
  ),
  templates: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
  ),
  timezone: TenantTimezone,
});

export const PlatformEventsFormOptions = asRpcQuery(
  Rpc.make('platform.events.formOptions', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: PlatformEventFormOptionsRecord,
  }),
);

export const PlatformEventsCreateInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  creatorUserId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  templateId: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type PlatformEventsCreateInput = Schema.Schema.Type<
  typeof PlatformEventsCreateInput
>;

export const PlatformEventsCreate = asRpcMutation(
  Rpc.make('platform.events.create', {
    error: PlatformOperationRpcError,
    payload: PlatformEventsCreateInput,
    success: PlatformEventDetailRecord,
  }),
);

export const PlatformEventsFindOne = asRpcQuery(
  Rpc.make('platform.events.findOne', {
    error: PlatformOperationRpcError,
    payload: PlatformEventTarget,
    success: PlatformEventDetailRecord,
  }),
);

export const PlatformEventsUpdateInput = Schema.Struct({
  ...PlatformEventMutationTarget.fields,
  addOns: Schema.Array(
    Schema.Struct({
      ...PlatformEventAddonRecord.fields,
      id: Schema.optional(Schema.NonEmptyString),
    }),
  ).check(Schema.isMaxLength(MAX_EVENT_ADDON_TYPES)),
  description: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  icon: iconSchema,
  location: Schema.NullOr(EventLocation),
  questions: Schema.Array(
    Schema.Struct({
      ...PlatformEventQuestionRecord.fields,
      id: Schema.optional(Schema.NonEmptyString),
    }),
  ).check(Schema.isMaxLength(MAX_REGISTRATION_QUESTIONS)),
  registrationOptions: Schema.Array(
    PlatformEventWritableRegistrationOptionInput,
  ),
  start: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type PlatformEventsUpdateInput = Schema.Schema.Type<
  typeof PlatformEventsUpdateInput
>;

export const PlatformEventsUpdate = asRpcMutation(
  Rpc.make('platform.events.update', {
    error: PlatformOperationRpcError,
    payload: PlatformEventsUpdateInput,
    success: PlatformEventDetailRecord,
  }),
);

export const PlatformEventsSubmitForReview = asRpcMutation(
  Rpc.make('platform.events.submitForReview', {
    error: PlatformOperationRpcError,
    payload: PlatformEventMutationTarget,
    success: PlatformEventDetailRecord,
  }),
);

export const PlatformEventsReviewInput = Schema.Struct({
  ...PlatformEventMutationTarget.fields,
  approved: Schema.Boolean,
  comment: Schema.optional(Schema.String),
});

export type PlatformEventsReviewInput = Schema.Schema.Type<
  typeof PlatformEventsReviewInput
>;

export const PlatformEventsReview = asRpcMutation(
  Rpc.make('platform.events.review', {
    error: PlatformOperationRpcError,
    payload: PlatformEventsReviewInput,
    success: PlatformEventDetailRecord,
  }),
);

export const PlatformEventsUpdateAnnouncementDiscoveryInput = Schema.Struct({
  ...PlatformEventMutationTarget.fields,
  announcementRoleIds: Schema.Array(Schema.NonEmptyString),
});

export type PlatformEventsUpdateAnnouncementDiscoveryInput = Schema.Schema.Type<
  typeof PlatformEventsUpdateAnnouncementDiscoveryInput
>;

export const PlatformEventsUpdateAnnouncementDiscovery = asRpcMutation(
  Rpc.make('platform.events.updateAnnouncementDiscovery', {
    error: PlatformOperationRpcError,
    payload: PlatformEventsUpdateAnnouncementDiscoveryInput,
    success: PlatformEventDetailRecord,
  }),
);

export const PlatformTemplateListRecord = Schema.Struct({
  categoryTitle: Schema.NonEmptyString,
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export const PlatformTemplateFormOptionsRecord = Schema.Struct({
  categories: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
  ),
  esnCardEnabled: Schema.Boolean,
  iconChoices: Schema.Array(IconRecord),
});

export const PlatformTemplatesList = asRpcQuery(
  Rpc.make('platform.templates.list', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: Schema.Array(PlatformTemplateListRecord),
  }),
);

export const PlatformTemplatesFindOne = asRpcQuery(
  Rpc.make('platform.templates.findOne', {
    error: PlatformOperationRpcError,
    payload: Schema.Struct({
      ...PlatformTenantTarget.fields,
      templateId: Schema.NonEmptyString,
    }),
    success: TemplateGraphRecord,
  }),
);

export const PlatformTemplatesFormOptions = asRpcQuery(
  Rpc.make('platform.templates.formOptions', {
    error: PlatformOperationRpcError,
    payload: PlatformTenantTarget,
    success: PlatformTemplateFormOptionsRecord,
  }),
);

export const PlatformTemplatesCreateInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  ...TemplateGraphInput.fields,
});

export type PlatformTemplatesCreateInput = Schema.Schema.Type<
  typeof PlatformTemplatesCreateInput
>;

export const PlatformTemplatesCreate = asRpcMutation(
  Rpc.make('platform.templates.create', {
    error: PlatformOperationRpcError,
    payload: PlatformTemplatesCreateInput,
    success: TemplateGraphRecord,
  }),
);

export const PlatformTemplatesUpdateInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  ...TemplateGraphInput.fields,
  templateId: Schema.NonEmptyString,
});

export type PlatformTemplatesUpdateInput = Schema.Schema.Type<
  typeof PlatformTemplatesUpdateInput
>;

export const PlatformTemplatesUpdate = asRpcMutation(
  Rpc.make('platform.templates.update', {
    error: PlatformOperationRpcError,
    payload: PlatformTemplatesUpdateInput,
    success: TemplateGraphRecord,
  }),
);

export const PlatformRegistrationListRecord = Schema.Struct({
  attendee: Schema.Struct({
    email: Schema.String,
    firstName: Schema.String,
    id: Schema.NonEmptyString,
    lastName: Schema.String,
  }),
  checkInTime: Schema.NullOr(Schema.NonEmptyString),
  event: Schema.Struct({
    id: Schema.NonEmptyString,
    start: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
  }),
  id: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  status: EventsRegistrationStatus,
});

export const PlatformRegistrationDetailRecord = Schema.Struct({
  ...PlatformRegistrationListRecord.fields,
  allowCheckIn: Schema.Boolean,
  attendeeCheckedIn: Schema.Boolean,
  cancellation: Schema.Struct({
    available: Schema.Boolean,
    blockedReason: Schema.NullOr(Schema.String),
    deadline: Schema.NonEmptyString,
    deadlinePassed: Schema.Boolean,
    refund: Schema.Struct({
      amount: Schema.NullOr(nonNegativeInteger),
      feesIncluded: Schema.Boolean,
      method: Schema.NullOr(
        Schema.Literals(['cash', 'paypal', 'stripe', 'transfer']),
      ),
      required: Schema.Boolean,
    }),
  }),
  checkedInGuestCount: nonNegativeInteger,
  checkInTimingIssue: Schema.NullOr(EventCheckInTimingIssue),
  currency: Tenant.fields.currency,
  guestCount: nonNegativeInteger,
  manualApprovalAvailable: Schema.Boolean,
  paymentPending: Schema.Boolean,
  registrationMode: TemplateRegistrationMode,
  registrationStatusIssue: Schema.Boolean,
  remainingGuestCount: nonNegativeInteger,
});

export type PlatformRegistrationDetailRecord = Schema.Schema.Type<
  typeof PlatformRegistrationDetailRecord
>;

export const PlatformRegistrationsFindOne = asRpcQuery(
  Rpc.make('platform.registrations.findOne', {
    error: PlatformOperationRpcError,
    payload: Schema.Struct({
      ...PlatformTenantTarget.fields,
      registrationId: Schema.NonEmptyString,
    }),
    success: PlatformRegistrationDetailRecord,
  }),
);

export const PlatformRegistrationsCheckInInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  guestCheckInCount: nonNegativeInteger,
  registrationId: Schema.NonEmptyString,
});

export type PlatformRegistrationsCheckInInput = Schema.Schema.Type<
  typeof PlatformRegistrationsCheckInInput
>;

export const PlatformRegistrationsCheckInError = Schema.Union([
  EventCheckInUnavailableError,
  PlatformOperationRpcError,
]);
export type PlatformRegistrationsCheckInError = Schema.Schema.Type<
  typeof PlatformRegistrationsCheckInError
>;

export const PlatformRegistrationsCheckIn = asRpcMutation(
  Rpc.make('platform.registrations.checkIn', {
    error: PlatformRegistrationsCheckInError,
    payload: PlatformRegistrationsCheckInInput,
    success: PlatformRegistrationDetailRecord,
  }),
);

export const PlatformRegistrationsApproveInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  registrationId: Schema.NonEmptyString,
});

export type PlatformRegistrationsApproveInput = Schema.Schema.Type<
  typeof PlatformRegistrationsApproveInput
>;

export const PlatformRegistrationsApprove = asRpcMutation(
  Rpc.make('platform.registrations.approve', {
    error: PlatformOperationRpcError,
    payload: PlatformRegistrationsApproveInput,
    success: PlatformRegistrationDetailRecord,
  }),
);

export const PlatformRegistrationsCancelInput = Schema.Struct({
  ...PlatformTenantMutationContext.fields,
  registrationId: Schema.NonEmptyString,
});

export type PlatformRegistrationsCancelInput = Schema.Schema.Type<
  typeof PlatformRegistrationsCancelInput
>;

export const PlatformRegistrationsCancel = asRpcMutation(
  Rpc.make('platform.registrations.cancel', {
    error: PlatformOperationRpcError,
    payload: PlatformRegistrationsCancelInput,
    success: PlatformRegistrationDetailRecord,
  }),
);

export class PlatformEventsRpcs extends RpcGroup.make(
  PlatformEventsCreate,
  PlatformEventsFindOne,
  PlatformEventsFormOptions,
  PlatformEventsList,
  PlatformEventsReview,
  PlatformEventsSubmitForReview,
  PlatformEventsUpdate,
  PlatformEventsUpdateAnnouncementDiscovery,
  PlatformRegistrationsApprove,
  PlatformRegistrationsCancel,
  PlatformRegistrationsCheckIn,
  PlatformRegistrationsFindOne,
  PlatformTemplatesCreate,
  PlatformTemplatesFindOne,
  PlatformTemplatesFormOptions,
  PlatformTemplatesList,
  PlatformTemplatesUpdate,
) {}
