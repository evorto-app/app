import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import {
  BadRequestConflictForbiddenInternalNotFoundUnauthorizedRpcError,
  BadRequestForbiddenInternalUnauthorizedRpcError,
  ConflictForbiddenNotFoundUnauthorizedRpcError,
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
  ForbiddenOrUnauthorizedRpcError,
  ForbiddenRpcError,
  InternalNotFoundUnauthorizedRpcError,
  RpcNotFoundError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';
import { iconSchema } from '../../types/icon';
export const EventsRpcError = UnauthorizedRpcError;

export type EventsRpcError = UnauthorizedRpcError;

export const EventsReviewRpcError = ForbiddenOrUnauthorizedRpcError;

export type EventsReviewRpcError = ForbiddenOrUnauthorizedRpcError;

export const EventReviewStatus = Schema.Literal(
  'APPROVED',
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
);

export type EventReviewStatus = Schema.Schema.Type<typeof EventReviewStatus>;

export const EventsCanOrganize = asRpcQuery(
  Rpc.make('events.canOrganize', {
    error: EventsRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Boolean,
  }),
);

export const EventsCancelPendingRegistrationError =
  InternalNotFoundUnauthorizedRpcError;

export type EventsCancelPendingRegistrationError =
  InternalNotFoundUnauthorizedRpcError;

export const EventsCancelPendingRegistration = asRpcMutation(
  Rpc.make('events.cancelPendingRegistration', {
    error: EventsCancelPendingRegistrationError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsCreateRpcError = BadRequestForbiddenInternalUnauthorizedRpcError;

export type EventsCreateRpcError =
  BadRequestForbiddenInternalUnauthorizedRpcError;

export const EventsCreateRegistrationOptionInput = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number.pipe(Schema.nonNegative()),
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: Schema.Literal('application', 'fcfs', 'random'),
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number.pipe(Schema.nonNegative()),
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
});

export const EventsCreate = asRpcMutation(
  Rpc.make('events.create', {
    error: EventsCreateRpcError,
    payload: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      registrationOptions: Schema.Array(EventsCreateRegistrationOptionInput),
      start: Schema.NonEmptyString,
      templateId: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const EventsEventListRpcError = ForbiddenRpcError;

export type EventsEventListRpcError = ForbiddenRpcError;

export const EventsEventListInput = Schema.Struct({
  includeUnlisted: Schema.optional(Schema.Boolean),
  limit: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
    default: () => 100,
  }),
  offset: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
    default: () => 0,
  }),
  startAfter: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => new Date().toISOString(),
  }),
  status: Schema.optionalWith(Schema.Array(EventReviewStatus), {
    default: () => [],
  }),
  userId: Schema.optional(Schema.NonEmptyString),
});

export type EventsEventListInput = Schema.Schema.Type<
  typeof EventsEventListInput
>;

export const EventsEventListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  status: EventReviewStatus,
  title: Schema.NonEmptyString,
  unlisted: Schema.Boolean,
  userIsCreator: Schema.Boolean,
  userRegistered: Schema.Boolean,
});

export type EventsEventListRecord = Schema.Schema.Type<
  typeof EventsEventListRecord
>;

export const EventsEventListDayRecord = Schema.Struct({
  day: Schema.NonEmptyString,
  events: Schema.Array(EventsEventListRecord),
});

export type EventsEventListDayRecord = Schema.Schema.Type<
  typeof EventsEventListDayRecord
>;

export const EventsEventList = asRpcQuery(
  Rpc.make('events.eventList', {
    error: EventsEventListRpcError,
    payload: EventsEventListInput,
    success: Schema.Array(EventsEventListDayRecord),
  }),
);

export const EventsFindOneForEditRpcError =
  ConflictForbiddenNotFoundUnauthorizedRpcError;

export type EventsFindOneForEditRpcError =
  ConflictForbiddenNotFoundUnauthorizedRpcError;

export const EventsFindOneForEditRegistrationMode = Schema.Literal(
  'application',
  'fcfs',
  'random',
);

export const EventsFindOneForEditRegistrationOption = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: EventsFindOneForEditRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
});

export const EventsFindOneForEdit = asRpcQuery(
  Rpc.make('events.findOneForEdit', {
    error: EventsFindOneForEditRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      id: Schema.NonEmptyString,
      location: Schema.NullOr(Schema.Any),
      registrationOptions: Schema.Array(EventsFindOneForEditRegistrationOption),
      start: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
  }),
);

export const EventsFindOneRpcError = RpcNotFoundError;

export type EventsFindOneRpcError = Schema.Schema.Type<typeof RpcNotFoundError>;

export const EventsFindOneRegistrationOption = Schema.Struct({
  appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
  checkedInSpots: Schema.Number,
  closeRegistrationTime: Schema.NonEmptyString,
  confirmedSpots: Schema.Number,
  description: Schema.NullOr(Schema.String),
  discountApplied: Schema.Boolean,
  effectivePrice: Schema.Number,
  esnCardDiscountedPrice: Schema.NullOr(Schema.Number),
  eventId: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: EventsFindOneForEditRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
});

export const EventsFindOne = asRpcQuery(
  Rpc.make('events.findOne', {
    error: EventsFindOneRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      creatorId: Schema.NonEmptyString,
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      id: Schema.NonEmptyString,
      location: Schema.NullOr(Schema.Any),
      registrationOptions: Schema.Array(EventsFindOneRegistrationOption),
      reviewer: Schema.NullOr(
        Schema.Struct({
          firstName: Schema.String,
          lastName: Schema.String,
        }),
      ),
      start: Schema.NonEmptyString,
      status: EventReviewStatus,
      statusComment: Schema.NullOr(Schema.String),
      title: Schema.NonEmptyString,
      unlisted: Schema.Boolean,
    }),
  }),
);

export const EventsGetOrganizeOverviewUser = Schema.Struct({
  appliedDiscountedPrice: Schema.NullOr(Schema.Number),
  appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
  basePriceAtRegistration: Schema.NullOr(Schema.Number),
  checkedIn: Schema.Boolean,
  checkInTime: Schema.NullOr(Schema.String),
  discountAmount: Schema.NullOr(Schema.Number),
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
});

export const EventsGetOrganizeOverviewOption = Schema.Struct({
  organizingRegistration: Schema.Boolean,
  registrationOptionId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  users: Schema.Array(EventsGetOrganizeOverviewUser),
});

export const EventsGetOrganizeOverview = asRpcQuery(
  Rpc.make('events.getOrganizeOverview', {
    error: EventsRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Array(EventsGetOrganizeOverviewOption),
  }),
);

export const EventsRegistrationStatusRecord = Schema.Struct({
  appliedDiscountedPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  appliedDiscountType: Schema.optional(
    Schema.NullOr(Schema.Literal('esnCard')),
  ),
  basePriceAtRegistration: Schema.optional(Schema.NullOr(Schema.Number)),
  checkoutUrl: Schema.optional(Schema.NullOr(Schema.String)),
  discountAmount: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.NonEmptyString,
  paymentPending: Schema.Boolean,
  registeredDescription: Schema.optional(Schema.NullOr(Schema.String)),
  registrationOptionId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  status: Schema.String,
});

export type EventsRegistrationStatusRecord = Schema.Schema.Type<
  typeof EventsRegistrationStatusRecord
>;

export const EventsGetRegistrationStatus = asRpcQuery(
  Rpc.make('events.getRegistrationStatus', {
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      isRegistered: Schema.Boolean,
      registrations: Schema.Array(EventsRegistrationStatusRecord),
    }),
  }),
);

export const EventsPendingReviewRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  start: Schema.String,
  title: Schema.NonEmptyString,
});

export type EventsPendingReviewRecord = Schema.Schema.Type<
  typeof EventsPendingReviewRecord
>;

export const EventsGetPendingReviews = asRpcQuery(
  Rpc.make('events.getPendingReviews', {
    error: EventsReviewRpcError,
    payload: Schema.Void,
    success: Schema.Array(EventsPendingReviewRecord),
  }),
);

export const EventsReviewEventRpcError =
  ConflictForbiddenNotFoundUnauthorizedRpcError;

export type EventsReviewEventRpcError =
  ConflictForbiddenNotFoundUnauthorizedRpcError;

export const EventsReviewEvent = asRpcMutation(
  Rpc.make('events.reviewEvent', {
    error: EventsReviewEventRpcError,
    payload: Schema.Struct({
      approved: Schema.Boolean,
      comment: Schema.optional(Schema.NonEmptyString),
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsRegisterForEventError = Schema.Union(
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
  UnauthorizedRpcError,
);

export type EventsRegisterForEventError = Schema.Schema.Type<
  typeof EventsRegisterForEventError
>;

export const EventsRegisterForEvent = asRpcMutation(
  Rpc.make('events.registerForEvent', {
    error: EventsRegisterForEventError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationOptionId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsRegistrationScannedError = Schema.Union(
  RpcNotFoundError,
  UnauthorizedRpcError,
);

export type EventsRegistrationScannedError = Schema.Schema.Type<
  typeof EventsRegistrationScannedError
>;

export const EventsRegistrationScanned = asRpcQuery(
  Rpc.make('events.registrationScanned', {
    error: EventsRegistrationScannedError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      allowCheckin: Schema.Boolean,
      appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
      event: Schema.Struct({
        start: Schema.NonEmptyString,
        title: Schema.NonEmptyString,
      }),
      registrationOption: Schema.Struct({
        title: Schema.NonEmptyString,
      }),
      registrationStatusIssue: Schema.Boolean,
      sameUserIssue: Schema.Boolean,
      user: Schema.Struct({
        firstName: Schema.NonEmptyString,
        lastName: Schema.NonEmptyString,
      }),
    }),
  }),
);

export const EventsSubmitForReviewRpcError =
  ConflictForbiddenNotFoundUnauthorizedRpcError;

export type EventsSubmitForReviewRpcError =
  ConflictForbiddenNotFoundUnauthorizedRpcError;

export const EventsSubmitForReview = asRpcMutation(
  Rpc.make('events.submitForReview', {
    error: EventsSubmitForReviewRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsUpdateListingRpcError = ForbiddenOrUnauthorizedRpcError;

export type EventsUpdateListingRpcError = ForbiddenOrUnauthorizedRpcError;

export const EventsUpdateListing = asRpcMutation(
  Rpc.make('events.updateListing', {
    error: EventsUpdateListingRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      unlisted: Schema.Boolean,
    }),
    success: Schema.Void,
  }),
);

export const EventsUpdateRpcError =
  BadRequestConflictForbiddenInternalNotFoundUnauthorizedRpcError;

export type EventsUpdateRpcError =
  BadRequestConflictForbiddenInternalNotFoundUnauthorizedRpcError;

export const EventsUpdateRegistrationOptionInput = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  esnCardDiscountedPrice: Schema.optional(
    Schema.NullOr(Schema.Number.pipe(Schema.nonNegative())),
  ),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number.pipe(Schema.nonNegative()),
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: Schema.Literal('application', 'fcfs', 'random'),
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number.pipe(Schema.nonNegative()),
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
});

export const EventsUpdate = asRpcMutation(
  Rpc.make('events.update', {
    error: EventsUpdateRpcError,
    payload: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      eventId: Schema.NonEmptyString,
      icon: iconSchema,
      location: Schema.NullOr(Schema.Any),
      registrationOptions: Schema.Array(EventsUpdateRegistrationOptionInput),
      start: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export class EventsRpcs extends RpcGroup.make(
  EventsCancelPendingRegistration,
  EventsCanOrganize,
  EventsCreate,
  EventsEventList,
  EventsFindOne,
  EventsFindOneForEdit,
  EventsGetOrganizeOverview,
  EventsGetPendingReviews,
  EventsGetRegistrationStatus,
  EventsRegisterForEvent,
  EventsRegistrationScanned,
  EventsReviewEvent,
  EventsSubmitForReview,
  EventsUpdate,
  EventsUpdateListing,
) {}
