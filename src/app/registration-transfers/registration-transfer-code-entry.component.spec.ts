import '@angular/compiler';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RegistrationTransferClaimComponent } from './registration-transfer-claim.component';
import {
  normalizeRegistrationTransferCode,
  RegistrationTransferCodeEntryComponent,
} from './registration-transfer-code-entry.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-registration-transfer-claim',
  template: `
    <button data-another-code (click)="enterAnotherCode.emit()">
      Enter another code
    </button>
  `,
})
class TransferClaimStub {
  readonly claimCode = input.required<string>();
  readonly enterAnotherCode = output();
}

const claimCode = 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890';

const rootElement = (
  fixture: ComponentFixture<RegistrationTransferCodeEntryComponent>,
): HTMLElement => {
  const root: unknown = fixture.nativeElement;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('Expected the transfer code entry element');
  }
  return root;
};

const enterCode = (
  fixture: ComponentFixture<RegistrationTransferCodeEntryComponent>,
  value: string,
): HTMLButtonElement => {
  const root = rootElement(fixture);
  const input = root.querySelector<HTMLInputElement>('input');
  const button = root.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!input || !button) {
    throw new Error('Expected the transfer code form controls');
  }
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
  return button;
};

describe('normalizeRegistrationTransferCode', () => {
  it('normalizes copied transfer codes before opening the review', () => {
    expect(normalizeRegistrationTransferCode(' abcd-1234-ef56 ')).toBe(
      'ABCD-1234-EF56',
    );
  });
});

describe('RegistrationTransferCodeEntryComponent validation', () => {
  beforeEach(async () => {
    TestBed.overrideComponent(RegistrationTransferCodeEntryComponent, {
      add: { imports: [TransferClaimStub] },
      remove: { imports: [RegistrationTransferClaimComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [RegistrationTransferCodeEntryComponent],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it.each([
    { label: 'uppercase', value: claimCode },
    { label: 'lowercase', value: claimCode.toLowerCase() },
    { label: 'padded', value: `  ${claimCode.toLowerCase()}  ` },
    {
      label: 'maximum-length padded',
      value: `${' '.repeat(512 - claimCode.length)}${claimCode.toLowerCase()}`,
    },
  ])('reviews a $label code after normalization', async ({ value }) => {
    const fixture = TestBed.createComponent(
      RegistrationTransferCodeEntryComponent,
    );
    fixture.detectChanges();
    const button = enterCode(fixture, value);
    expect(button.disabled).toBe(false);
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const review = fixture.debugElement.query(By.directive(TransferClaimStub));
    expect(review?.injector.get(TransferClaimStub).claimCode()).toBe(claimCode);
    expect(rootElement(fixture).querySelector('input')).toBeNull();
  });

  it.each([
    { label: 'empty', value: '' },
    { label: 'incomplete', value: 'ABCD-1234-EF56' },
    { label: 'non-hexadecimal', value: claimCode.replace('A', 'G') },
    { label: 'misplaced separator', value: claimCode.replace('-', '_') },
    {
      label: 'overlong padded',
      value: `${' '.repeat(513 - claimCode.length)}${claimCode}`,
    },
  ])('keeps an $label code outside the review', async ({ value }) => {
    const fixture = TestBed.createComponent(
      RegistrationTransferCodeEntryComponent,
    );
    fixture.detectChanges();
    const button = enterCode(fixture, value);
    expect(button.disabled).toBe(true);
    const formElement = rootElement(fixture).querySelector('form');
    if (!formElement) throw new Error('Expected the transfer code form');
    formElement.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.directive(TransferClaimStub)),
    ).toBeNull();
  });

  it('discards the selected private code before accepting another code', async () => {
    const fixture = TestBed.createComponent(
      RegistrationTransferCodeEntryComponent,
    );
    fixture.detectChanges();
    enterCode(fixture, claimCode).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const anotherCode = rootElement(fixture).querySelector<HTMLButtonElement>(
      '[data-another-code]',
    );
    if (!anotherCode) throw new Error('Expected the enter another code button');
    anotherCode.click();
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.directive(TransferClaimStub)),
    ).toBeNull();
    expect(
      rootElement(fixture).querySelector<HTMLInputElement>('input')?.value,
    ).toBe('');
  });
});
