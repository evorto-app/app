import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { NotAllowedComponent } from './not-allowed.component';

describe('NotAllowedComponent', () => {
  it('explains denied access without role-editor wording', async () => {
    const fixture = TestBed.createComponent(NotAllowedComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Your account does not have access to this page.');
    expect(text).toContain('ask the person who manages your Evorto access');
    expect(text).not.toContain('permission');
  });
});
