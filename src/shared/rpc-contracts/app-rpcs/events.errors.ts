import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';

export type EventRegistrationError =
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError;

export class EventConflictError extends Schema.TaggedError<EventConflictError>()(
  'EventConflictError',
  {
    message: Schema.String,
  },
) {}

export class EventNotFoundError extends Schema.TaggedError<EventNotFoundError>()(
  'EventNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

export class EventRegistrationConflictError extends Schema.TaggedError<EventRegistrationConflictError>()(
  'EventRegistrationConflictError',
  {
    message: Schema.String,
  },
) {}

export class EventRegistrationInternalError extends Schema.TaggedError<EventRegistrationInternalError>()(
  'EventRegistrationInternalError',
  {
    message: Schema.String,
  },
) {}

export class EventRegistrationNotFoundError extends Schema.TaggedError<EventRegistrationNotFoundError>()(
  'EventRegistrationNotFoundError',
  {
    message: Schema.String,
  },
) {}

export const EventsRpcError = UnauthorizedRpcError;
export type EventsRpcError = UnauthorizedRpcError;

export const EventsReviewRpcError = ForbiddenOrUnauthorizedRpcError;
export type EventsReviewRpcError = ForbiddenOrUnauthorizedRpcError;

export const EventsCancelPendingRegistrationError = Schema.Union(
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
  RpcUnauthorizedError,
);
export type EventsCancelPendingRegistrationError = Schema.Schema.Type<
  typeof EventsCancelPendingRegistrationError
>;

export const EventsCreateRpcError =
  Schema.Union(
    RpcBadRequestError,
    RpcForbiddenError,
    RpcInternalServerError,
    RpcUnauthorizedError,
  );
export type EventsCreateRpcError = Schema.Schema.Type<typeof EventsCreateRpcError>;

export const EventsEventListRpcError = RpcForbiddenError;
export type EventsEventListRpcError = Schema.Schema.Type<typeof EventsEventListRpcError>;

export const EventsFindOneForEditRpcError = Schema.Union(
  EventConflictError,
  EventNotFoundError,
  RpcForbiddenError,
  RpcUnauthorizedError,
);
export type EventsFindOneForEditRpcError = Schema.Schema.Type<
  typeof EventsFindOneForEditRpcError
>;

export const EventsFindOneRpcError = EventNotFoundError;
export type EventsFindOneRpcError = Schema.Schema.Type<typeof EventsFindOneRpcError>;

export const EventsReviewEventRpcError = Schema.Union(
  EventConflictError,
  EventNotFoundError,
  RpcForbiddenError,
  RpcUnauthorizedError,
);
export type EventsReviewEventRpcError = Schema.Schema.Type<
  typeof EventsReviewEventRpcError
>;

export const EventsRegisterForEventError = Schema.Union(
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
  RpcUnauthorizedError,
);
export type EventsRegisterForEventError = Schema.Schema.Type<
  typeof EventsRegisterForEventError
>;

export const EventsRegistrationScannedError = Schema.Union(
  EventRegistrationNotFoundError,
  RpcUnauthorizedError,
);
export type EventsRegistrationScannedError = Schema.Schema.Type<
  typeof EventsRegistrationScannedError
>;

export const EventsSubmitForReviewRpcError = Schema.Union(
  EventConflictError,
  EventNotFoundError,
  RpcForbiddenError,
  RpcUnauthorizedError,
);
export type EventsSubmitForReviewRpcError = Schema.Schema.Type<
  typeof EventsSubmitForReviewRpcError
>;

export const EventsUpdateListingRpcError = ForbiddenOrUnauthorizedRpcError;
export type EventsUpdateListingRpcError = ForbiddenOrUnauthorizedRpcError;

export const EventsUpdateRpcError = Schema.Union(
  RpcBadRequestError,
  EventConflictError,
  RpcForbiddenError,
  RpcInternalServerError,
  EventNotFoundError,
  RpcUnauthorizedError,
);
export type EventsUpdateRpcError = Schema.Schema.Type<typeof EventsUpdateRpcError>;
