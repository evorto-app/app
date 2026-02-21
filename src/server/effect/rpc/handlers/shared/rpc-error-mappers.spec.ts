import { describe, expect, it } from 'vitest';

import {
  EventRegistrationConflictError,
  EventRegistrationInternalError,
  EventRegistrationNotFoundError,
} from '../domains/events/events.errors';
import {
  ReceiptMediaBadRequestError,
  ReceiptMediaInternalError,
  ReceiptMediaServiceUnavailableError,
} from '../domains/finance/finance.errors';
import {
  TemplateSimpleBadRequestError,
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
} from '../domains/templates/templates.errors';
import {
  mapEventRegistrationErrorToRpc,
  mapReceiptMediaErrorToRpc,
  mapTemplateSimpleErrorToRpc,
} from './rpc-error-mappers';

describe('rpc-error-mappers', () => {
  it('maps event registration tagged errors to legacy rpc literals', () => {
    expect(
      mapEventRegistrationErrorToRpc(
        new EventRegistrationConflictError({ message: 'conflict' }),
      ),
    ).toBe('CONFLICT');
    expect(
      mapEventRegistrationErrorToRpc(
        new EventRegistrationNotFoundError({ message: 'missing' }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      mapEventRegistrationErrorToRpc(
        new EventRegistrationInternalError({ message: 'internal' }),
      ),
    ).toBe('INTERNAL_SERVER_ERROR');
  });

  it('maps template tagged errors to legacy rpc literals', () => {
    expect(
      mapTemplateSimpleErrorToRpc(
        new TemplateSimpleBadRequestError({ message: 'bad' }),
      ),
    ).toBe('BAD_REQUEST');
    expect(
      mapTemplateSimpleErrorToRpc(
        new TemplateSimpleNotFoundError({ message: 'missing' }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      mapTemplateSimpleErrorToRpc(
        new TemplateSimpleInternalError({ message: 'internal' }),
      ),
    ).toBe('INTERNAL_SERVER_ERROR');
  });

  it('maps receipt media tagged errors to legacy rpc literals', () => {
    expect(
      mapReceiptMediaErrorToRpc(
        new ReceiptMediaBadRequestError({ message: 'bad' }),
      ),
    ).toBe('BAD_REQUEST');
    expect(
      mapReceiptMediaErrorToRpc(
        new ReceiptMediaServiceUnavailableError({ message: 'down' }),
      ),
    ).toBe('INTERNAL_SERVER_ERROR');
    expect(
      mapReceiptMediaErrorToRpc(
        new ReceiptMediaInternalError({ message: 'internal' }),
      ),
    ).toBe('INTERNAL_SERVER_ERROR');
  });
});
