import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { UsersCreateAccountInput, UsersUpdateProfileInput } from './users.rpcs';

describe('users RPC input schemas', () => {
  it('accepts account-creation notification email addresses', () => {
    expect(
      Schema.decodeUnknownSync(UsersCreateAccountInput)({
        communicationEmail: 'notify@example.com',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toEqual({
      communicationEmail: 'notify@example.com',
      firstName: 'Alice',
      lastName: 'Doe',
    });
  });

  it('rejects invalid account-creation notification email addresses', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersCreateAccountInput)({
        communicationEmail: 'not-an-email',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toThrow();
  });

  it('rejects invalid profile notification email addresses', () => {
    expect(() =>
      Schema.decodeUnknownSync(UsersUpdateProfileInput)({
        communicationEmail: 'finance',
        firstName: 'Alice',
        lastName: 'Doe',
      }),
    ).toThrow();
  });
});
