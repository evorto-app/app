import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { notificationEmailPattern } from '@shared/notification-email';
import {
  literalUnion,
  nonNegativeNumber,
  positiveNumber,
} from '@shared/schema-utilities';
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
  EventsOrganizeRpcError,
  EventsRegisterForEventError,
  EventsRegistrationAddonFulfillmentError,
  EventsRegistrationScannedError,
  EventsReviewEventRpcError,
  EventsReviewRpcError,
  EventsSubmitForReviewRpcError,
  EventsUpdateListingRpcError,
  EventsUpdateRpcError,
} from './events.errors';

const TransferTargetEmail = Schema.NonEmptyString.check(
  Schema.isPattern(notificationEmailPattern),
);

const NullablePolicyHoursInput = Schema.NullOr(nonNegativeNumber).pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
);
const NullableRefundFeesInput = Schema.NullOr(Schema.Boolean).pipe(
  Schema.withDecodingDefaultTypeKey(Effect.succeed(null)),
);
const NonNegativeInteger = nonNegativeNumber.check(Schema.isInt());
const PositiveInteger = positiveNumber.check(Schema.isInt());
const RegistrationAddonOperationKey = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
);
const RegistrationAddonCancellationReason = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(500),
);

export const EventReviewStatus = literalUnion(
  'APPROVED',
  'DRAFT',
  'PENDING_REVIEW',
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

export const EventsCancellableRegistrationStatus = literalUnion(
  'CONFIRMED',
  'PENDING',
  'WAITLIST',
);

export type EventsCancellableRegistrationStatus = Schema.Schema.Type<
  typeof EventsCancellableRegistrationStatus
>;

export const EventsWritableRegistrationMode = literalUnion(
  'application',
  'fcfs',
);

export const EventsCanOrganize = asRpcQuery(
  Rpc.make('events.canOrganize', {
    error: EventsOrganizeRpcError,
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
      expectedPaymentPending: Schema.Boolean,
      expectedStatus: EventsCancellableRegistrationStatus,
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
      expectedPaymentPending: Schema.Boolean,
      expectedStatus: EventsCancellableRegistrationStatus,
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsApproveRegistrationResult = Schema.Struct({
  status: Schema.Literals(['confirmed', 'paymentPending']),
});

export const EventsApproveRegistration = asRpcMutation(
  Rpc.make('events.approveRegistration', {
    error: EventsCheckInRegistrationError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
    }),
    success: EventsApproveRegistrationResult,
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
  cancellationDeadlineHoursBeforeStart: NullablePolicyHoursInput,
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeNumber,
  refundFeesOnCancellation: NullableRefundFeesInput,
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: EventsWritableRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  sourceTemplateRegistrationOptionId: Schema.optional(Schema.NonEmptyString),
  spots: nonNegativeNumber,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: NullablePolicyHoursInput,
});

export const EventsCreate = asRpcMutation(
  Rpc.make('events.create', {
    error: EventsCreateRpcError,
    payload: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      location: Schema.optional(Schema.NullOr(EventLocation)),
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
  cancellationDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeNumber),
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  refundFeesOnCancellation: Schema.NullOr(Schema.Boolean),
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: EventsFindOneForEditRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: Schema.NullOr(nonNegativeNumber),
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
  questions: Schema.Array(
    Schema.Struct({
      description: Schema.NullOr(Schema.String),
      id: Schema.NonEmptyString,
      required: Schema.Boolean,
      sortOrder: Schema.Number,
      title: Schema.NonEmptyString,
    }),
  ),
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

export const EventsFindOneAddonRegistrationOption = Schema.Struct({
  includedQuantity: nonNegativeNumber,
  optionalPurchaseQuantity: nonNegativeNumber,
  registrationOptionId: Schema.NonEmptyString,
});

export const EventsFindOneAddon = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  maxQuantityPerUser: Schema.Number,
  price: Schema.Number,
  registrationOptions: Schema.Array(EventsFindOneAddonRegistrationOption),
  stripeTaxRateId: Schema.NullOr(Schema.String),
  taxRateDisplayName: Schema.NullOr(Schema.String),
  taxRatePercentage: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: Schema.Number,
});

export const EventsFindOne = asRpcQuery(
  Rpc.make('events.findOne', {
    error: EventsFindOneRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      addOns: Schema.Array(EventsFindOneAddon),
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
  addonPurchases: Schema.Array(
    Schema.Struct({
      quantity: Schema.Number,
      title: Schema.NonEmptyString,
      unitPrice: Schema.Number,
    }),
  ),
  appliedDiscountedPrice: Schema.NullOr(Schema.Number),
  appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
  basePriceAtRegistration: Schema.NullOr(Schema.Number),
  checkedIn: Schema.Boolean,
  checkInTime: Schema.NullOr(Schema.String),
  discountAmount: Schema.NullOr(Schema.Number),
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  manualApprovalAvailable: Schema.Boolean,
  paymentPending: Schema.Boolean,
  paymentSetupRequired: Schema.Boolean,
  registrationId: Schema.NonEmptyString,
  status: EventsRegistrationStatus,
  transferAvailable: Schema.Boolean,
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
    error: EventsOrganizeRpcError,
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

export const EventsRegistrationAddonRecord = Schema.Struct({
  addOnId: Schema.NonEmptyString,
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  cancelledQuantity: NonNegativeInteger,
  currency: Schema.NonEmptyString,
  currentPurchaseWindow: Schema.Literals([
    'beforeEvent',
    'duringEvent',
    'afterEvent',
  ]),
  description: Schema.NullOr(Schema.String),
  includedQuantity: NonNegativeInteger,
  isPaid: Schema.Boolean,
  maxPurchasableQuantity: NonNegativeInteger,
  maxQuantityPerUser: PositiveInteger,
  nextPurchaseTaxRateDisplayName: Schema.NullOr(Schema.String),
  nextPurchaseTaxRateInclusive: Schema.NullOr(Schema.Boolean),
  nextPurchaseTaxRatePercentage: Schema.NullOr(Schema.String),
  nextPurchaseUnitGrossAmount: Schema.NullOr(NonNegativeInteger),
  nextPurchaseUnitPrice: NonNegativeInteger,
  nextPurchaseUnitTaxAmount: Schema.NullOr(NonNegativeInteger),
  optionalPurchaseQuantity: NonNegativeInteger,
  pendingCheckoutExpiresAt: Schema.NullOr(Schema.NonEmptyString),
  pendingCheckoutUrl: Schema.NullOr(Schema.NonEmptyString),
  pendingOperationKey: Schema.NullOr(RegistrationAddonOperationKey),
  pendingQuantity: NonNegativeInteger,
  purchaseAvailable: Schema.Boolean,
  purchaseBlockedReason: Schema.Literals([
    'none',
    'registrationStatus',
    'eventUnavailable',
    'activeTransfer',
    'paymentPending',
    'beforeEventDisabled',
    'duringEventDisabled',
    'eventEnded',
    'multipleNotAllowed',
    'optionLimitReached',
    'userLimitReached',
    'outOfStock',
    'paymentUnavailable',
    'taxUnavailable',
  ]),
  purchaseStatus: Schema.Literals(['available', 'blocked', 'paymentPending']),
  redeemedQuantity: NonNegativeInteger,
  remainingQuantity: NonNegativeInteger,
  settledPurchasedQuantity: NonNegativeInteger,
  title: Schema.NonEmptyString,
  totalAvailableQuantity: NonNegativeInteger,
  totalQuantity: NonNegativeInteger,
});

export type EventsRegistrationAddonRecord = Schema.Schema.Type<
  typeof EventsRegistrationAddonRecord
>;

export const EventsRegistrationTransferBlockedReason = Schema.Literals([
  'none',
  'registrationStatus',
  'checkedIn',
  'eventUnavailable',
  'activeTransfer',
  'addonPaymentPending',
  'addonFulfillmentState',
  'unsupportedPaymentMethod',
  'paidAddon',
  'deadlinePassed',
]);

export const EventsRegistrationStatusRecord = Schema.Struct({
  activeTransfer: Schema.NullOr(
    Schema.Struct({
      expiresAt: Schema.NonEmptyString,
      registrationSide: Schema.Literals(['recipient', 'source']),
      status: Schema.Literals([
        'checkout_pending',
        'open',
        'refund_pending',
        'refund_failed',
      ]),
      transferId: Schema.NonEmptyString,
    }),
  ),
  addonPurchases: Schema.Array(
    Schema.Struct({
      quantity: Schema.Number,
      title: Schema.NonEmptyString,
      unitPrice: Schema.Number,
    }),
  ),
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
  registrationAddOns: Schema.Array(EventsRegistrationAddonRecord),
  registrationOptionId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  status: EventsRegistrationStatus,
  transferAvailable: Schema.Boolean,
  transferBlockedReason: EventsRegistrationTransferBlockedReason,
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

export const EventsPurchaseRegistrationAddonResult = Schema.Union([
  Schema.Struct({
    orderId: Schema.NonEmptyString,
    status: Schema.Literal('completed'),
  }),
  Schema.Struct({
    checkoutUrl: Schema.NonEmptyString,
    expiresAt: Schema.NonEmptyString,
    orderId: Schema.NonEmptyString,
    status: Schema.Literal('checkoutRequired'),
  }),
]);

export type EventsPurchaseRegistrationAddonResult = Schema.Schema.Type<
  typeof EventsPurchaseRegistrationAddonResult
>;

export const EventsPurchaseRegistrationAddonPayload = Schema.Struct({
  addOnId: Schema.NonEmptyString,
  operationKey: RegistrationAddonOperationKey,
  quantity: PositiveInteger,
  registrationId: Schema.NonEmptyString,
});

export const EventsPurchaseRegistrationAddon = asRpcMutation(
  Rpc.make('events.purchaseRegistrationAddon', {
    error: EventsRegisterForEventError,
    payload: EventsPurchaseRegistrationAddonPayload,
    success: EventsPurchaseRegistrationAddonResult,
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

export const EventsRegistrationQuestionAnswerInput = Schema.Struct({
  answer: Schema.String,
  questionId: Schema.NonEmptyString,
});

export const EventsRegistrationAddonInput = Schema.Struct({
  addOnId: Schema.NonEmptyString,
  quantity: nonNegativeNumber,
});

export const EventsRegisterForEventPayload = Schema.Struct({
  addOns: Schema.optional(Schema.Array(EventsRegistrationAddonInput)),
  answers: Schema.optional(Schema.Array(EventsRegistrationQuestionAnswerInput)),
  eventId: Schema.NonEmptyString,
  guestCount: nonNegativeNumber,
  registrationOptionId: Schema.NonEmptyString,
});

export const EventsRegisterForEvent = asRpcMutation(
  Rpc.make('events.registerForEvent', {
    error: EventsRegisterForEventError,
    payload: EventsRegisterForEventPayload,
    success: Schema.Void,
  }),
);

export const EventsJoinWaitlistPayload = Schema.Struct({
  answers: Schema.optional(Schema.Array(EventsRegistrationQuestionAnswerInput)),
  eventId: Schema.NonEmptyString,
  registrationOptionId: Schema.NonEmptyString,
});

export const EventsJoinWaitlist = asRpcMutation(
  Rpc.make('events.joinWaitlist', {
    error: EventsRegisterForEventError,
    payload: EventsJoinWaitlistPayload,
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
      checkInTimingIssue: Schema.Boolean,
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

export const EventsRegistrationAddonRefundStatus = literalUnion(
  'notApplicable',
  'notRequested',
  'pending',
  'partiallyRefunded',
  'refunded',
  'failed',
  'cancelledWithoutRefund',
  'notRequired',
);

export type EventsRegistrationAddonRefundStatus = Schema.Schema.Type<
  typeof EventsRegistrationAddonRefundStatus
>;

export const EventsRegistrationAddonRefundAvailability = literalUnion(
  'none',
  'noMonetaryRefundRequired',
  'monetaryRefundAvailable',
);

export type EventsRegistrationAddonRefundAvailability = Schema.Schema.Type<
  typeof EventsRegistrationAddonRefundAvailability
>;

export const EventsRegistrationAddonCancellationBlockedReason = literalUnion(
  'none',
  'permission',
  'registrationStatus',
  'noQuantity',
);

export type EventsRegistrationAddonCancellationBlockedReason =
  Schema.Schema.Type<typeof EventsRegistrationAddonCancellationBlockedReason>;

export const EventsRegistrationAddonFulfillmentRecord = Schema.Struct({
  addOnId: Schema.NonEmptyString,
  cancellablePurchasedQuantity: NonNegativeInteger,
  cancellableQuantity: NonNegativeInteger,
  cancellationAvailable: Schema.Boolean,
  cancellationBlockedReason: EventsRegistrationAddonCancellationBlockedReason,
  cancelledQuantity: NonNegativeInteger,
  includedQuantity: NonNegativeInteger,
  latestFulfillmentEventId: Schema.NullOr(Schema.NonEmptyString),
  latestRedemptionEventId: Schema.NullOr(Schema.NonEmptyString),
  purchasedQuantity: NonNegativeInteger,
  redeemedQuantity: NonNegativeInteger,
  redemptionAvailable: Schema.Boolean,
  refundAvailability: EventsRegistrationAddonRefundAvailability,
  refundStatus: EventsRegistrationAddonRefundStatus,
  registrationAddonId: Schema.NonEmptyString,
  remainingQuantity: NonNegativeInteger,
  title: Schema.NonEmptyString,
  totalQuantity: NonNegativeInteger,
  undoAvailable: Schema.Boolean,
});

export type EventsRegistrationAddonFulfillmentRecord = Schema.Schema.Type<
  typeof EventsRegistrationAddonFulfillmentRecord
>;

export const EventsGetRegistrationAddonFulfillment = asRpcQuery(
  Rpc.make('events.getRegistrationAddonFulfillment', {
    error: EventsRegistrationAddonFulfillmentError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      addOns: Schema.Array(EventsRegistrationAddonFulfillmentRecord),
      registrationId: Schema.NonEmptyString,
    }),
  }),
);

export const EventsRedeemRegistrationAddon = asRpcMutation(
  Rpc.make('events.redeemRegistrationAddon', {
    error: EventsRegistrationAddonFulfillmentError,
    payload: Schema.Struct({
      operationKey: RegistrationAddonOperationKey,
      registrationAddonId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      fulfillmentEventId: Schema.NonEmptyString,
    }),
  }),
);

export const EventsUndoRegistrationAddonRedemption = asRpcMutation(
  Rpc.make('events.undoRegistrationAddonRedemption', {
    error: EventsRegistrationAddonFulfillmentError,
    payload: Schema.Struct({
      operationKey: RegistrationAddonOperationKey,
      redemptionEventId: Schema.NonEmptyString,
      registrationAddonId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      fulfillmentEventId: Schema.NonEmptyString,
    }),
  }),
);

export const EventsCancelRegistrationAddon = asRpcMutation(
  Rpc.make('events.cancelRegistrationAddon', {
    error: EventsRegistrationAddonFulfillmentError,
    payload: Schema.Struct({
      operationKey: RegistrationAddonOperationKey,
      quantity: PositiveInteger,
      reason: RegistrationAddonCancellationReason,
      refundRequested: Schema.Boolean,
      registrationAddonId: Schema.NonEmptyString,
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      fulfillmentEventId: Schema.NonEmptyString,
      refundStatus: EventsRegistrationAddonRefundStatus,
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
  cancellationDeadlineHoursBeforeStart: NullablePolicyHoursInput,
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  esnCardDiscountedPrice: Schema.optional(Schema.NullOr(nonNegativeNumber)),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeNumber,
  refundFeesOnCancellation: NullableRefundFeesInput,
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: EventsWritableRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: nonNegativeNumber,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: NullablePolicyHoursInput,
});

export const EventGraphRegistrationOptionInput = Schema.Struct({
  cancellationDeadlineHoursBeforeStart: NullablePolicyHoursInput,
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.NullOr(nonNegativeNumber),
  id: Schema.optional(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  key: Schema.NonEmptyString,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: nonNegativeNumber,
  refundFeesOnCancellation: NullableRefundFeesInput,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: EventsWritableRegistrationMode,
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: nonNegativeNumber,
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  transferDeadlineHoursBeforeStart: NullablePolicyHoursInput,
});

export type EventGraphRegistrationOptionInput = Schema.Schema.Type<
  typeof EventGraphRegistrationOptionInput
>;

export const EventGraphAddonRegistrationOptionInput = Schema.Struct({
  includedQuantity: NonNegativeInteger,
  optionalPurchaseQuantity: NonNegativeInteger,
  registrationOptionKey: Schema.NonEmptyString,
});

export const EventGraphAddonInput = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  id: Schema.optional(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  key: Schema.NonEmptyString,
  maxQuantityPerUser: PositiveInteger,
  price: NonNegativeInteger,
  registrationOptions: Schema.mutable(
    Schema.Array(EventGraphAddonRegistrationOptionInput),
  ),
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: NonNegativeInteger,
});

export type EventGraphAddonInput = Schema.Schema.Type<
  typeof EventGraphAddonInput
>;

export const EventGraphQuestionInput = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  id: Schema.optional(Schema.NonEmptyString),
  key: Schema.NonEmptyString,
  registrationOptionKey: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: NonNegativeInteger,
  title: Schema.NonEmptyString,
});

export type EventGraphQuestionInput = Schema.Schema.Type<
  typeof EventGraphQuestionInput
>;

export const EventGraphAddonRecord = Schema.Struct({
  allowMultiple: Schema.Boolean,
  allowPurchaseBeforeEvent: Schema.Boolean,
  allowPurchaseDuringEvent: Schema.Boolean,
  allowPurchaseDuringRegistration: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  maxQuantityPerUser: Schema.Number,
  price: Schema.Number,
  registrationOptions: Schema.Array(EventsFindOneAddonRegistrationOption),
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
  totalAvailableQuantity: Schema.Number,
});

export const EventGraphQuestionRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  registrationOptionId: Schema.NonEmptyString,
  required: Schema.Boolean,
  sortOrder: Schema.Number,
  title: Schema.NonEmptyString,
});

export const EventGraphEditRecord = Schema.Struct({
  addOns: Schema.Array(EventGraphAddonRecord),
  description: Schema.NonEmptyString,
  end: Schema.NonEmptyString,
  icon: iconSchema,
  id: Schema.NonEmptyString,
  location: Schema.NullOr(EventLocation),
  questions: Schema.Array(EventGraphQuestionRecord),
  registrationOptions: Schema.Array(EventsFindOneForEditRegistrationOption),
  simpleModeEnabled: Schema.Boolean,
  start: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type EventGraphEditRecord = Schema.Schema.Type<
  typeof EventGraphEditRecord
>;

export const EventsFindGraphForEdit = asRpcQuery(
  Rpc.make('events.findGraphForEdit', {
    error: EventsFindOneForEditRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: EventGraphEditRecord,
  }),
);

export const EventsUpdateGraph = asRpcMutation(
  Rpc.make('events.updateGraph', {
    error: EventsUpdateRpcError,
    payload: Schema.Struct({
      addOns: Schema.mutable(Schema.Array(EventGraphAddonInput)),
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      eventId: Schema.NonEmptyString,
      icon: iconSchema,
      location: Schema.NullOr(EventLocation),
      questions: Schema.mutable(Schema.Array(EventGraphQuestionInput)),
      registrationOptions: Schema.mutable(
        Schema.Array(EventGraphRegistrationOptionInput),
      ),
      simpleModeEnabled: Schema.Boolean,
      start: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

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
  EventsApproveRegistration,
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
  EventsFindGraphForEdit,
  EventsFindTransferTargets,
  EventsGetRegistrationAddonFulfillment,
  EventsGetOrganizeOverview,
  EventsGetPendingReviews,
  EventsGetRegistrationStatus,
  EventsJoinWaitlist,
  EventsPurchaseRegistrationAddon,
  EventsRegisterForEvent,
  EventsRedeemRegistrationAddon,
  EventsRegistrationScanned,
  EventsReviewEvent,
  EventsSubmitForReview,
  EventsUpdate,
  EventsUpdateGraph,
  EventsUpdateListing,
  EventsUndoRegistrationAddonRedemption,
  EventsCancelRegistrationAddon,
) {}
