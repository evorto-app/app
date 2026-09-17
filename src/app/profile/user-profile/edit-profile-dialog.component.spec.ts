import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { UsersUpdateProfileInput } from '../../../shared/rpc-contracts/app-rpcs/users.rpcs';
import {
  EditProfileDialogComponent,
  type EditProfileDialogData,
  type EditProfileDialogResult,
  editProfileDialogResultFromFormValue,
} from './edit-profile-dialog.component';

describe('editProfileDialogResultFromFormValue', () => {
  it('trims required profile fields and clears blank reimbursement details', () => {
    expect(
      editProfileDialogResultFromFormValue({
        communicationEmail: ' Events@Example.COM ',
        firstName: ' Alice ',
        iban: ' '.repeat(3),
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
        iban: ' nl91 abna 0417 1643 00 ',
        lastName: 'One',
        paypalEmail: ' PayPal@Example.COM ',
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

describe('profile payout serialization', () => {
  it('normalizes payout and notification email details', () => {
    const result = editProfileDialogResultFromFormValue({
      communicationEmail: ' Events@Example.COM ',
      firstName: ' Alice ',
      iban: ' nl91 abna 0417 1643 00 ',
      lastName: ' Updated ',
      paypalEmail: ' PayPal@Example.COM ',
    });
    expect(result).toEqual({
      communicationEmail: 'events@example.com',
      firstName: 'Alice',
      iban: 'NL91ABNA0417164300',
      lastName: 'Updated',
      paypalEmail: 'paypal@example.com',
    });
    expect(
      Schema.encodeSync(UsersUpdateProfileInput)(
        UsersUpdateProfileInput.make(result),
      ),
    ).toEqual(result);
  });
});

const withPayoutDialog = async (
  check: (context: {
    close: ReturnType<typeof vi.fn<(value?: EditProfileDialogResult) => void>>;
    field: (label: string) => HTMLInputElement;
    fill: (label: string, value: string) => HTMLInputElement;
    fixture: ComponentFixture<EditProfileDialogComponent>;
    root: HTMLElement;
    saveProfile: ReturnType<typeof vi.fn<EditProfileDialogData['save']>>;
  }) => Promise<void>,
): Promise<void> => {
  let fixture: ComponentFixture<EditProfileDialogComponent> | undefined;
  const failures: unknown[] = [];
  try {
    const saveProfile = vi
      .fn<EditProfileDialogData['save']>()
      .mockResolvedValue({ saved: true });
    const data: EditProfileDialogData = {
      communicationEmail: 'Events@Example.COM',
      firstName: 'Alice',
      iban: null,
      lastName: 'Doe',
      paypalEmail: null,
      save: saveProfile,
    };
    const close = vi.fn<(value?: EditProfileDialogResult) => void>();
    await TestBed.configureTestingModule({
      imports: [EditProfileDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: data },
        {
          provide: MatDialogRef,
          useValue: { close } satisfies Pick<
            MatDialogRef<EditProfileDialogComponent, EditProfileDialogResult>,
            'close'
          >,
        },
      ],
    }).compileComponents();
    const createdFixture = TestBed.createComponent(EditProfileDialogComponent);
    fixture = createdFixture;
    createdFixture.detectChanges();
    await createdFixture.whenStable();
    createdFixture.detectChanges();
    const root: unknown = createdFixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected profile dialog DOM');
    const field = (label: string): HTMLInputElement => {
      const input = [...root.querySelectorAll('mat-form-field')]
        .find(
          (element) =>
            element.querySelector('mat-label')?.textContent?.trim() === label,
        )
        ?.querySelector('input');
      if (!(input instanceof HTMLInputElement))
        throw new Error(`Missing profile input: ${label}`);
      return input;
    };
    const fill = (label: string, value: string): HTMLInputElement => {
      const input = field(label);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      createdFixture.detectChanges();
      return input;
    };
    await check({
      close,
      field,
      fill,
      fixture: createdFixture,
      root,
      saveProfile,
    });
  } catch (error) {
    failures.push(error);
  }
  for (const cleanup of [
    () => fixture?.destroy(),
    () => TestBed.resetTestingModule(),
  ]) {
    try {
      cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Profile payout assertions and cleanup failed',
    );
};

describe('profile payout form validation', () => {
  it('retains invalid entries until corrected and closes with encoder-compatible payout values', async () => {
    await withPayoutDialog(
      async ({ close, field, fill, fixture, root, saveProfile }) => {
        const iban = fill(
          'IBAN (for reimbursements)',
          'DE88370400440532013000',
        );
        const paypal = fill('PayPal email (for reimbursements)', 'payout');
        const save = root.querySelector('button[type="submit"]');
        if (!(save instanceof HTMLButtonElement))
          throw new Error('Expected profile Save button');
        expect(save.disabled).toBe(true);
        await fixture.componentInstance.onSubmit(new Event('submit'));
        fixture.detectChanges();
        expect(close).not.toHaveBeenCalled();
        expect(saveProfile).not.toHaveBeenCalled();
        expect(iban.value).toBe('DE88370400440532013000');
        expect(paypal.value).toBe('payout');
        expect(root.textContent).toContain(
          'Enter a valid IBAN, including its country code and check digits.',
        );
        expect(root.textContent).toContain(
          'Enter a valid PayPal email address.',
        );
        fill('IBAN (for reimbursements)', ' nl91 abna 0417 1643 00 ');
        expect(save.disabled).toBe(true);
        fill('PayPal email (for reimbursements)', ' PayPal@Example.COM ');
        expect(save.disabled).toBe(false);
        expect(field('Email for updates').value).toBe('Events@Example.COM');
        await fixture.componentInstance.onSubmit(new Event('submit'));
        expect(close).toHaveBeenCalledExactlyOnceWith({
          communicationEmail: 'events@example.com',
          firstName: 'Alice',
          iban: 'NL91ABNA0417164300',
          lastName: 'Doe',
          paypalEmail: 'paypal@example.com',
        });
        expect(saveProfile).toHaveBeenCalledExactlyOnceWith({
          communicationEmail: 'events@example.com',
          firstName: 'Alice',
          iban: 'NL91ABNA0417164300',
          lastName: 'Doe',
          paypalEmail: 'paypal@example.com',
        });
        const saved = close.mock.calls[0]?.[0];
        if (!saved) throw new Error('Expected saved profile payload');
        expect(
          Schema.encodeSync(UsersUpdateProfileInput)(
            UsersUpdateProfileInput.make(saved),
          ),
        ).toEqual(saved);
      },
    );
  });

  it('keeps blank payout fields optional and preserves current required fields', async () => {
    await withPayoutDialog(async ({ close, fill, fixture, saveProfile }) => {
      fill('IBAN (for reimbursements)', ' '.repeat(3));
      fill('PayPal email (for reimbursements)', ' '.repeat(3));
      fill('First name', '');
      await fixture.componentInstance.onSubmit(new Event('submit'));
      expect(close).not.toHaveBeenCalled();
      expect(saveProfile).not.toHaveBeenCalled();
      fill('First name', 'Alice');
      fill('Email for updates', 'invalid');
      await fixture.componentInstance.onSubmit(new Event('submit'));
      expect(close).not.toHaveBeenCalled();
      expect(saveProfile).not.toHaveBeenCalled();
      fill('Email for updates', 'Events@Example.COM');
      await fixture.componentInstance.onSubmit(new Event('submit'));
      expect(close).toHaveBeenCalledExactlyOnceWith({
        communicationEmail: 'events@example.com',
        firstName: 'Alice',
        iban: null,
        lastName: 'Doe',
        paypalEmail: null,
      });
      expect(saveProfile).toHaveBeenCalledExactlyOnceWith({
        communicationEmail: 'events@example.com',
        firstName: 'Alice',
        iban: null,
        lastName: 'Doe',
        paypalEmail: null,
      });
    });
  });
});
