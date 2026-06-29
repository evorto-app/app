import '@angular/compiler';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  eventAddonPurchaseTiming,
  eventAddonsForRegistrationOption,
  eventRegistrationOptionTitle,
  eventReviewActionDisabled,
  eventSubmitForReviewActionDisabled,
  registrationOptionsState,
} from './event-details.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('registrationOptionsState', () => {
  it('shows available registration options when at least one option is visible', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [{}],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('visible');
  });

  it('shows an explicit ineligible state when every option is hidden by role eligibility', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: true,
      }),
    ).toBe('hiddenByEligibility');
  });

  it('keeps optionless events distinct from role-ineligible events', () => {
    expect(
      registrationOptionsState({
        registrationOptions: [],
        registrationOptionsHiddenByEligibility: false,
      }),
    ).toBe('none');
  });
});

describe('eventReviewActionDisabled', () => {
  it('allows review actions only for reviewers on pending events without an in-flight review', () => {
    expect(
      eventReviewActionDisabled({
        canReview: true,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(false);
    expect(
      eventReviewActionDisabled({
        canReview: false,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
    expect(
      eventReviewActionDisabled({
        canReview: true,
        mutationPending: true,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
    expect(
      eventReviewActionDisabled({
        canReview: true,
        mutationPending: false,
        status: 'APPROVED',
      }),
    ).toBe(true);
  });
});

describe('eventSubmitForReviewActionDisabled', () => {
  it('allows editable draft and rejected events to be submitted while no submit is pending', () => {
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        mutationPending: false,
        status: 'DRAFT',
      }),
    ).toBe(false);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        mutationPending: false,
        status: 'REJECTED',
      }),
    ).toBe(false);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: false,
        mutationPending: false,
        status: 'DRAFT',
      }),
    ).toBe(true);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        mutationPending: true,
        status: 'DRAFT',
      }),
    ).toBe(true);
    expect(
      eventSubmitForReviewActionDisabled({
        canEdit: true,
        mutationPending: false,
        status: 'PENDING_REVIEW',
      }),
    ).toBe(true);
  });
});

describe('eventAddonPurchaseTiming', () => {
  it('lists every enabled add-on purchase window in display order', () => {
    expect(
      eventAddonPurchaseTiming({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        allowPurchaseDuringRegistration: true,
      }),
    ).toBe('During registration, Before event, During event');
  });

  it('marks add-ons without purchase windows as unavailable', () => {
    expect(
      eventAddonPurchaseTiming({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
      }),
    ).toBe('Unavailable');
  });
});

describe('eventRegistrationOptionTitle', () => {
  it('resolves event-scoped add-on registration option labels', () => {
    expect(
      eventRegistrationOptionTitle(
        {
          registrationOptions: [
            {
              id: 'option-1',
              title: 'Participant',
            },
          ],
        },
        'option-1',
      ),
    ).toBe('Participant');
  });

  it('keeps copied add-ons readable when an option is no longer visible', () => {
    expect(
      eventRegistrationOptionTitle(
        {
          registrationOptions: [],
        },
        'option-1',
      ),
    ).toBe('Unknown registration option');
  });
});

describe('eventAddonsForRegistrationOption', () => {
  it('returns registration-time add-ons attached to the selected option', () => {
    expect(
      eventAddonsForRegistrationOption(
        {
          addOns: [
            {
              allowPurchaseDuringRegistration: true,
              registrationOptions: [{ registrationOptionId: 'option-1' }],
            },
            {
              allowPurchaseDuringRegistration: false,
              registrationOptions: [{ registrationOptionId: 'option-1' }],
            },
            {
              allowPurchaseDuringRegistration: true,
              registrationOptions: [{ registrationOptionId: 'option-2' }],
            },
          ],
        },
        'option-1',
      ),
    ).toHaveLength(1);
  });
});

describe('EventDetails template', () => {
  it('keeps event and registration actions behind explicit query states', () => {
    const template = readSource(
      'src/app/events/event-details/event-details.component.html',
    );

    expect(template).toContain('eventQuery.isPending()');
    expect(template).toContain('Loading event ...');
    expect(template).toContain('eventQuery.isError()');
    expect(template).toContain('Failed to load event.');
    expect(template).toContain('eventQuery.isSuccess()');
    expect(template).toContain('registrationStatusQuery.isPending()');
    expect(template).toContain('registrationStatusQuery.isError()');
    expect(template).toContain('Failed to load registration status.');
    expect(template).toContain('registrationStatusQuery.isSuccess()');
  });
});
