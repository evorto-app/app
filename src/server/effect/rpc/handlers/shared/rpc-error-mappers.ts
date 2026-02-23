import {
  type EventRegistrationError,
} from '../events/events.errors';
import {
  type ReceiptMediaError,
} from '../finance/finance.errors';
import {
  type TemplateSimpleError,
} from '../templates/templates.errors';

export const mapEventRegistrationErrorToRpc = (
  error: EventRegistrationError,
): 'CONFLICT' | 'INTERNAL_SERVER_ERROR' | 'NOT_FOUND' => {
  switch (error['_tag']) {
    case 'EventRegistrationConflictError': {
      return 'CONFLICT';
    }
    case 'EventRegistrationInternalError': {
      return 'INTERNAL_SERVER_ERROR';
    }
    case 'EventRegistrationNotFoundError': {
      return 'NOT_FOUND';
    }
    default: {
      return 'INTERNAL_SERVER_ERROR';
    }
  }
};

export const mapTemplateSimpleErrorToRpc = (
  error: TemplateSimpleError,
): 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR' | 'NOT_FOUND' => {
  switch (error['_tag']) {
    case 'TemplateSimpleBadRequestError': {
      return 'BAD_REQUEST';
    }
    case 'TemplateSimpleInternalError': {
      return 'INTERNAL_SERVER_ERROR';
    }
    case 'TemplateSimpleNotFoundError': {
      return 'NOT_FOUND';
    }
    default: {
      return 'INTERNAL_SERVER_ERROR';
    }
  }
};

export const mapReceiptMediaErrorToRpc = (
  error: ReceiptMediaError,
): 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR' => {
  switch (error['_tag']) {
    case 'ReceiptMediaBadRequestError': {
      return 'BAD_REQUEST';
    }
    case 'ReceiptMediaInternalError': {
      return 'INTERNAL_SERVER_ERROR';
    }
    case 'ReceiptMediaServiceUnavailableError': {
      return 'INTERNAL_SERVER_ERROR';
    }
    default: {
      return 'INTERNAL_SERVER_ERROR';
    }
  }
};
