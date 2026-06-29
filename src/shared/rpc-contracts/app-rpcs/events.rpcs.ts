import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { notificationEmailPattern } from '@shared/notification-email';
import { literalUnion, nonNegativeNumber } from '@shared/schema-utilities';
import { Effect, Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { EventLocation } from '../../../types/location';
import { iconSchema } from '../../types/icon';
import {
  EventsCancelPendingRegistrationError,
  EventsCheckInRegistrationError,
  EventsCreateRpcError,
  EventsEventListRpcError,
  EventsFindOneForEditRpcError,
  EventsFindOneRpcError,
  EventsRegisterForEventError,
  EventsRegistrationScannedError,
  EventsReviewEventRpcError,
  EventsReviewRpcError,
  EventsRpcError,
  EventsSubmitForReviewRpcError,
  EventsUpdateListingRpcError,
  EventsUpdateRpcError,
} from './events.errors';

const TransferTargetEmail = Schema.NonEmptyString.check(
  Schema.isPattern(notificationEmailPattern),
);

export const EventReviewStatus = literalUnion(
  'APPROVED',
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
);

export type EventReviewStatus = Schema.Schema.Type<typeof EventReviewStatus>;

export const EventsRegistrationStatus = literalUnion(
  'CANCELLED',
  'CONFIRMED',
  'PENDING',
  'WAITLIST',
);

export type EventsRegistrationStatus = Schema.Schema.Type<
  typeof EventsRegistrationStatus
>;

export const EventsCanOrganize = asRpcQuery(
  Rpc.make('events.canOrganize', {
    error: EventsRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Boolean,
  }),
);

export const EventsCancelPendingRegistration = asRpcMutation(
  Rpc.make('events.cancelPendingRegistration', {
    error: EventsCancelPendingRegistrationError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsCancelRegistration = asRpcMutation(
  Rpc.make('events.cancelRegistration', {
    error: EventsCancelPendingRegistrationError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsCancelEventRegistration = asRpcMutation(
  Rpc.make('events.cancelEventRegistration', {
    error: EventsCheckInRegistrationError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsTransferEventRegistration = asRpcMutation(
  Rpc.make('events.transferEventRegistration', {
    error: EventsCheckInRegistrationError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
      targetUserId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsTransferMyRegistration = asRpcMutation(
  Rpc.make('events.transferMyRegistration', {
    error: EventsCheckInRegistrationError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
      targetEmail: TransferTargetEmail,
    }),
    success: Schema.Void,
  }),
);

export const EventsCheckInRegistration = asRpcMutation(
  Rpc.make('events.checkInRegistration', {
    error: EventsCheckInRegistrationError,
    payload: Schema.Struct({
      guestCheckInCount: nonNegativeNumber,
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      alreadyCheckedIn: Schema.Boolean,
      checkInTime: Schema.NonEmptyString,
    }),
  }),
);

export const EventsCreateRegistrationOptionInput = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeNumber,
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: literalUnion('application', 'fcfs', 'random'),
  roleIds: Schema.Array(Schema.NonEmptyString),
  sourceTemplateRegistrationOptionId: Schema.optional(Schema.NonEmptyString),
  spots: nonNegativeNumber,
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

export const EventsEventListInput = Schema.Struct({
  includeUnlisted: Schema.optional(Schema.Boolean),
  limit: nonNegativeNumber.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(100)),
  ),
  offset: nonNegativeNumber.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
  ),
  startAfter: Schema.NonEmptyString.pipe(
    Schema.withDecodingDefaultTypeKey(
      Effect.sync(() => new Date().toISOString()),
    ),
  ),
  status: Schema.Array(EventReviewStatus).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
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

export const EventsFindOneForEditRegistrationMode = literalUnion(
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
      location: Schema.NullOr(EventLocation),
      registrationOptions: Schema.Array(EventsFindOneForEditRegistrationOption),
      start: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
  }),
);

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
  reservedSpots: Schema.Number,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  taxRateDisplayName: Schema.NullOr(Schema.String),
  taxRatePercentage: Schema.NullOr(Schema.String),
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
      location: Schema.NullOr(EventLocation),
      registrationOptions: Schema.Array(EventsFindOneRegistrationOption),
      registrationOptionsHiddenByEligibility: Schema.Boolean,
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
  registrationId: Schema.NonEmptyString,
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

export const EventsTransferTargetRecord = Schema.Struct({
  email: Schema.String,
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
});

export const EventsFindTransferTargets = asRpcQuery(
  Rpc.make('events.findTransferTargets', {
    error: EventsCheckInRegistrationError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
      search: Schema.optional(Schema.String),
    }),
    success: Schema.Array(EventsTransferTargetRecord),
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
  guestCount: Schema.Number,
  id: Schema.NonEmptyString,
  paymentPending: Schema.Boolean,
  registeredDescription: Schema.optional(Schema.NullOr(Schema.String)),
  registrationOptionId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  status: EventsRegistrationStatus,
  transferAvailable: Schema.Boolean,
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

export const EventsRegisterForEvent = asRpcMutation(
  Rpc.make('events.registerForEvent', {
    error: EventsRegisterForEventError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      guestCount: nonNegativeNumber,
      registrationOptionId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsJoinWaitlist = asRpcMutation(
  Rpc.make('events.joinWaitlist', {
    error: EventsRegisterForEventError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationOptionId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsRegistrationScanned = asRpcQuery(
  Rpc.make('events.registrationScanned', {
    error: EventsRegistrationScannedError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      allowCheckin: Schema.Boolean,
      alreadyCheckedInIssue: Schema.Boolean,
      appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
      attendeeCheckedIn: Schema.Boolean,
      checkedInGuestCount: Schema.Number,
      event: Schema.Struct({
        start: Schema.NonEmptyString,
        title: Schema.NonEmptyString,
      }),
      guestCount: Schema.Number,
      registrationOption: Schema.Struct({
        title: Schema.NonEmptyString,
      }),
      registrationStatusIssue: Schema.Boolean,
      remainingGuestCount: Schema.Number,
      sameUserIssue: Schema.Boolean,
      user: Schema.Struct({
        firstName: Schema.NonEmptyString,
        lastName: Schema.NonEmptyString,
      }),
    }),
  }),
);

export const EventsSubmitForReview = asRpcMutation(
  Rpc.make('events.submitForReview', {
    error: EventsSubmitForReviewRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

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

export const EventsUpdateRegistrationOptionInput = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  esnCardDiscountedPrice: Schema.optional(Schema.NullOr(nonNegativeNumber)),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeNumber,
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: literalUnion('application', 'fcfs', 'random'),
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: nonNegativeNumber,
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
      location: Schema.NullOr(EventLocation),
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
  EventsCancelRegistration,
  EventsCancelEventRegistration,
  EventsTransferEventRegistration,
  EventsTransferMyRegistration,
  EventsCanOrganize,
  EventsCheckInRegistration,
  EventsCreate,
  EventsEventList,
  EventsFindOne,
  EventsFindOneForEdit,
  EventsFindTransferTargets,
  EventsGetOrganizeOverview,
  EventsGetPendingReviews,
  EventsGetRegistrationStatus,
  EventsJoinWaitlist,
  EventsRegisterForEvent,
  EventsRegistrationScanned,
  EventsReviewEvent,
  EventsSubmitForReview,
  EventsUpdate,
  EventsUpdateListing,
) {}
