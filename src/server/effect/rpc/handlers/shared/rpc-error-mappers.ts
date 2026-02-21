import {
  type EventRegistrationError,
} from '../domains/events/events.errors';
import {
  type ReceiptMediaError,
} from '../domains/finance/finance.errors';
import {
  type TemplateSimpleError,
} from '../domains/templates/templates.errors';

export const mapEventRegistrationErrorToRpc = (
  error: EventRegistrationError,
): 'CONFLICT' | 'INTERNAL_SERVER_ERROR' | 'NOT_FOUND' => {
  switch (error._tag) {
    case 'EventRegistrationConflictError':
      return 'CONFLICT';
    case 'EventRegistrationNotFoundError':
      return 'NOT_FOUND';
    case 'EventRegistrationInternalError':
      return 'INTERNAL_SERVER_ERROR';
  }
};

export const mapTemplateSimpleErrorToRpc = (
  error: TemplateSimpleError,
): 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR' | 'NOT_FOUND' => {
  switch (error._tag) {
    case 'TemplateSimpleBadRequestError':
      return 'BAD_REQUEST';
    case 'TemplateSimpleNotFoundError':
      return 'NOT_FOUND';
    case 'TemplateSimpleInternalError':
      return 'INTERNAL_SERVER_ERROR';
  }
};

export const mapReceiptMediaErrorToRpc = (
  error: ReceiptMediaError,
): 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR' => {
  switch (error._tag) {
    case 'ReceiptMediaBadRequestError':
      return 'BAD_REQUEST';
    case 'ReceiptMediaServiceUnavailableError':
      return 'INTERNAL_SERVER_ERROR';
    case 'ReceiptMediaInternalError':
      return 'INTERNAL_SERVER_ERROR';
  }
};
