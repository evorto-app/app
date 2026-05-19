import { describe, expect, it } from 'vitest';

import {
  createAccountErrorMessage,
  createAccountModelFromAuthData,
  createAccountPayloadFromModel,
} from './create-account.helpers';

describe('createAccountModelFromAuthData', () => {
  it('prefills account fields from trimmed Auth0 data', () => {
    expect(
      createAccountModelFromAuthData(
        {
          communicationEmail: '',
          firstName: '',
          lastName: '',
        },
        {
          email: ' alice@example.com ',
          family_name: ' Doe ',
          given_name: ' Alice ',
          sub: 'auth0|alice',
        },
      ),
    ).toEqual({
      communicationEmail: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Doe',
    });
  });

  it('preserves existing form values when Auth0 data is missing or blank', () => {
    expect(
      createAccountModelFromAuthData(
        {
          communicationEmail: 'notify@example.com',
          firstName: 'Manual',
          lastName: 'Name',
        },
        {
          email: '',
          family_name: null,
          given_name: ' ',
        },
      ),
    ).toEqual({
      communicationEmail: 'notify@example.com',
      firstName: 'Manual',
      lastName: 'Name',
    });
  });
});

describe('createAccountPayloadFromModel', () => {
  it('trims account creation fields before submitting them', () => {
    expect(
      createAccountPayloadFromModel({
        communicationEmail: ' notify@example.com ',
        firstName: ' Alice ',
        lastName: ' Doe ',
      }),
    ).toEqual({
      communicationEmail: 'notify@example.com',
      firstName: 'Alice',
      lastName: 'Doe',
    });
  });
});

describe('createAccountErrorMessage', () => {
  it('uses the domain error message when account creation fails', () => {
    expect(
      createAccountErrorMessage({
        _tag: 'UserConflictError',
        message: 'User account already exists',
      }),
    ).toBe('User account already exists');
  });

  it('falls back to account creation copy for unknown failures', () => {
    expect(createAccountErrorMessage(null)).toBe('Failed to create account');
  });
});
