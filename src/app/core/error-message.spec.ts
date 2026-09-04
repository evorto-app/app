import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './error-message';

describe('getErrorMessage', () => {
  const contextualFallback = 'The profile could not be saved. Try again.';

  it.each([
    'database connection string leaked here',
    new Error('database connection string leaked here'),
    {
      _tag: 'RpcInternalServerError',
      message: 'database connection string leaked here',
    },
  ])('uses contextual copy instead of technical error details', (error) => {
    expect(getErrorMessage(error, contextualFallback)).toBe(contextualFallback);
  });

  it('uses plain default copy when no contextual fallback is supplied', () => {
    expect(getErrorMessage({ _tag: 'RpcInternalServerError' })).toBe(
      'Something went wrong. Try again.',
    );
  });

  it('returns a message only for an explicitly expected product outcome', () => {
    expect(
      getErrorMessage(
        {
          _tag: 'EventRegistrationConflictError',
          message: 'This registration has already been cancelled.',
        },
        contextualFallback,
        ['EventRegistrationConflictError'],
      ),
    ).toBe('This registration has already been cancelled.');
  });

  it('accepts an expected RPC error decoded through its schema', () => {
    const error = Schema.decodeUnknownSync(RpcBadRequestError)({
      _tag: 'RpcBadRequestError',
      message: 'This website address is already in use.',
    });

    expect(error).toBeInstanceOf(Error);
    expect(
      getErrorMessage(error, contextualFallback, ['RpcBadRequestError']),
    ).toBe('This website address is already in use.');
  });

  it('does not expose a native Error even when it is given an expected tag', () => {
    const error = Object.assign(
      new Error('database connection string leaked here'),
      {
        _tag: 'EventRegistrationConflictError',
      },
    );

    expect(
      getErrorMessage(error, contextualFallback, [
        'EventRegistrationConflictError',
      ]),
    ).toBe(contextualFallback);
  });

  it.each([
    'EventRegistrationInternalError',
    'ReceiptMediaInternalError',
    'RegistrationTransferInternalError',
    'RpcForbiddenError',
    'RpcInternalServerError',
    'RpcUnauthorizedError',
  ])('never exposes the message for unsafe tag %s', (tag) => {
    expect(
      getErrorMessage(
        {
          _tag: tag,
          message: 'database connection string leaked here',
        },
        contextualFallback,
        [tag],
      ),
    ).toBe(contextualFallback);
  });

  it('falls back when an expected product outcome has no useful message', () => {
    expect(
      getErrorMessage(
        { _tag: 'EventRegistrationConflictError', message: ' '.repeat(3) },
        contextualFallback,
        ['EventRegistrationConflictError'],
      ),
    ).toBe(contextualFallback);
  });
});
