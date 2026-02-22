/* eslint-disable unicorn/throw-new-error */

import { Schema } from 'effect';

export type TemplateSimpleError =
  | TemplateSimpleBadRequestError
  | TemplateSimpleInternalError
  | TemplateSimpleNotFoundError;

export class TemplateSimpleBadRequestError extends Schema.TaggedError<TemplateSimpleBadRequestError>()(
  'TemplateSimpleBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleInternalError extends Schema.TaggedError<TemplateSimpleInternalError>()(
  'TemplateSimpleInternalError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleNotFoundError extends Schema.TaggedError<TemplateSimpleNotFoundError>()(
  'TemplateSimpleNotFoundError',
  {
    message: Schema.String,
  },
) {}
