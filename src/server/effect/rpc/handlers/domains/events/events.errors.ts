import { Schema } from 'effect';

export class EventRegistrationConflictError extends Schema.TaggedError<EventRegistrationConflictError>()(
  'EventRegistrationConflictError',
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

export class EventRegistrationInternalError extends Schema.TaggedError<EventRegistrationInternalError>()(
  'EventRegistrationInternalError',
  {
    message: Schema.String,
  },
) {}

export type EventRegistrationError =
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError;
