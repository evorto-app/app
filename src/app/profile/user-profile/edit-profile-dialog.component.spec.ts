import { describe, expect, it } from 'vitest';

import { editProfileDialogResultFromFormValue } from './edit-profile-dialog.component';

describe('editProfileDialogResultFromFormValue', () => {
  it('trims required profile fields and clears blank reimbursement details', () => {
    expect(
      editProfileDialogResultFromFormValue({
        communicationEmail: ' events@example.com ',
        firstName: ' Alice ',
        iban: '   ',
        lastName: ' Updated ',
        paypalEmail: '',
      }),
    ).toEqual({
      communicationEmail: 'events@example.com',
      firstName: 'Alice',
      iban: null,
      lastName: 'Updated',
      paypalEmail: null,
    });
  });

  it('preserves non-empty global reimbursement details for profile persistence', () => {
    expect(
      editProfileDialogResultFromFormValue({
        communicationEmail: 'finance@example.com',
        firstName: 'Alice',
        iban: ' NL91ABNA0417164300 ',
        lastName: 'One',
        paypalEmail: ' paypal@example.com ',
      }),
    ).toEqual({
      communicationEmail: 'finance@example.com',
      firstName: 'Alice',
      iban: 'NL91ABNA0417164300',
      lastName: 'One',
      paypalEmail: 'paypal@example.com',
    });
  });
});
