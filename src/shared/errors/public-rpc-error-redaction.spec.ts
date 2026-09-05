import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { EventRegistrationInternalError } from '../rpc-contracts/app-rpcs/events.errors';
import {
  ReceiptMediaInternalError,
  ReceiptMediaServiceUnavailableError,
} from '../rpc-contracts/app-rpcs/finance.errors';
import { RegistrationTransferInternalError } from '../rpc-contracts/app-rpcs/registration-transfers.errors';
import { RpcBadRequestError, RpcInternalServerError } from './rpc-errors';

const sensitiveEmail = 'person@example.test';
const sensitiveIban = 'DE89370400440532013000';
const sensitiveSql = 'select * from finance_receipts where iban = $1';
const sensitiveTransferToken = 'transfer-token-do-not-encode';
const sensitiveCause = {
  body: {
    email: sensitiveEmail,
    token: sensitiveTransferToken,
  },
  parameters: [sensitiveIban],
  query: sensitiveSql,
  stack: `Error: ${sensitiveSql}`,
};

describe('public RPC error redaction', () => {
  it('does not encode internal causes on public error variants', () => {
    const encodedPayloads = [
      Schema.encodeUnknownSync(RpcInternalServerError)(
        Object.assign(
          new RpcInternalServerError({ message: 'Internal server error' }),
          { cause: sensitiveCause },
        ),
      ),
      Schema.encodeUnknownSync(EventRegistrationInternalError)(
        Object.assign(
          new EventRegistrationInternalError({
            message: 'Registration failed internally',
          }),
          { cause: sensitiveCause },
        ),
      ),
      Schema.encodeUnknownSync(ReceiptMediaInternalError)(
        Object.assign(
          new ReceiptMediaInternalError({
            message: 'Receipt storage failed internally',
          }),
          { cause: sensitiveCause },
        ),
      ),
      Schema.encodeUnknownSync(ReceiptMediaServiceUnavailableError)(
        Object.assign(
          new ReceiptMediaServiceUnavailableError({
            message: 'Receipt storage is unavailable',
          }),
          { cause: sensitiveCause },
        ),
      ),
      Schema.encodeUnknownSync(RegistrationTransferInternalError)(
        Object.assign(
          new RegistrationTransferInternalError({
            message: 'Registration transfer failed internally',
          }),
          { cause: sensitiveCause },
        ),
      ),
    ];

    for (const encoded of encodedPayloads) {
      const serialized = JSON.stringify(encoded);
      expect(encoded).not.toHaveProperty('cause');
      expect(serialized).not.toContain(sensitiveEmail);
      expect(serialized).not.toContain(sensitiveIban);
      expect(serialized).not.toContain(sensitiveSql);
      expect(serialized).not.toContain(sensitiveTransferToken);
    }
  });

  it('preserves the safe fields of expected tagged errors', () => {
    const encoded = Schema.encodeUnknownSync(RpcBadRequestError)(
      new RpcBadRequestError({
        message: 'Choose an active registration option',
        reason: 'registrationOptionInactive',
      }),
    );

    expect(encoded).toEqual({
      _tag: 'RpcBadRequestError',
      message: 'Choose an active registration option',
      reason: 'registrationOptionInactive',
    });
  });
});
