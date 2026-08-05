import { describe, expect, it } from 'vitest';

import {
  isBrowsingOutsideHomeTenant,
  profileReimbursementReadiness,
  profileUpdateErrorMessage,
  profileUserAfterEdit,
} from './user-profile.component';

describe('profile overview', () => {
  it('warns only when the current tenant differs from an explicit home tenant', () => {
    expect(isBrowsingOutsideHomeTenant('tenant-home', 'tenant-away')).toBe(
      true,
    );
    expect(isBrowsingOutsideHomeTenant('tenant-home', 'tenant-home')).toBe(
      false,
    );
    expect(isBrowsingOutsideHomeTenant(undefined, 'tenant-away')).toBe(false);
  });

  it('summarizes reimbursement readiness without exposing bank details', () => {
    expect(
      profileReimbursementReadiness({
        iban: 'DE89370400440532013000',
        paypalEmail: 'member@example.com',
      }),
    ).toBe('IBAN and PayPal details added.');
    expect(
      profileReimbursementReadiness({
        iban: 'DE89370400440532013000',
      }),
    ).toBe('IBAN added.');
    expect(
      profileReimbursementReadiness({
        paypalEmail: 'member@example.com',
      }),
    ).toBe('PayPal account added.');
    expect(profileReimbursementReadiness({})).toBe(
      'No reimbursement details added.',
    );
  });

  it('merges saved profile fields into the visible profile cache', () => {
    expect(
      profileUserAfterEdit(
        {
          communicationEmail: 'old@example.com',
          email: 'login@example.com',
          firstName: 'Old',
          iban: null,
          id: 'user-1',
          lastName: 'Name',
          paypalEmail: null,
        },
        {
          communicationEmail: 'new@example.com',
          firstName: 'New',
          iban: 'DE89370400440532013000',
          lastName: 'Person',
          paypalEmail: null,
        },
      ),
    ).toEqual({
      communicationEmail: 'new@example.com',
      email: 'login@example.com',
      firstName: 'New',
      iban: 'DE89370400440532013000',
      id: 'user-1',
      lastName: 'Person',
      paypalEmail: null,
    });
  });

  it('shows profile corrections without exposing internal failures', () => {
    expect(
      profileUpdateErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Enter a valid IBAN.',
      }),
    ).toBe('Enter a valid IBAN.');
    expect(
      profileUpdateErrorMessage({
        _tag: 'RpcInternalServerError',
        message: 'database failed',
      }),
    ).toBe("We couldn't update your profile. Try again.");
  });
});
