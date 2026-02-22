/* eslint-disable unicorn/throw-new-error */

import { Schema } from 'effect';

export type EventRegistrationError =
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError;

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
