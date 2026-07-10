import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  EventStatusComponent,
  eventStatusLabel,
} from './event-status.component';

beforeEach(async () => {
  await TestBed.configureTestingModule({
    imports: [EventStatusComponent],
  }).compileComponents();
});

describe('eventStatusLabel', () => {
  it('uses published product language for approved events', () => {
    expect(eventStatusLabel('APPROVED')).toBe('Published');
  });

  it('keeps review workflow labels readable', () => {
    expect(eventStatusLabel('DRAFT')).toBe('Draft');
    expect(eventStatusLabel('PENDING_REVIEW')).toBe('Pending Review');
  });

  it('labels persisted feedback on a returned draft', () => {
    const fixture = TestBed.createComponent(EventStatusComponent);
    fixture.componentRef.setInput('status', 'DRAFT');
    fixture.componentRef.setInput('comment', 'Add clearer safety guidance.');
    fixture.componentRef.setInput('reviewer', 'Ada Reviewer');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Draft');
    expect(fixture.nativeElement.textContent).toContain(
      'Review feedback: Add clearer safety guidance.',
    );
    expect(fixture.nativeElement.textContent).toContain('(Ada Reviewer)');
  });
});
