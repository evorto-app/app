import '@angular/compiler';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

import {
  platformEventAddOnAvailabilityIssue,
  platformEventAddOnMappingIssue,
  platformEventAddOnQuantityLimitIssue,
  platformEventAddOnStockIssue,
  platformEventAddonTypeLimitIssue,
  platformEventDiscountedPriceIssue,
  platformEventEditorIsReadOnly,
  platformEventIntegerIssue,
  platformEventPaidAddOnPriceIssue,
  platformEventPaidRegistrationPriceIssue,
  platformEventPaidTaxRateIssue,
  platformEventQuestionOptionIssue,
  platformEventRegistrationWindowHasValidOrder,
  platformEventSimpleModeIssue,
  platformEventTitleIssue,
} from './platform-event-detail.component';

describe('platform event registration-mode compatibility', () => {
  it('keeps every non-draft event editor read-only', () => {
    expect(platformEventEditorIsReadOnly('DRAFT')).toBe(false);
    expect(platformEventEditorIsReadOnly('PENDING_REVIEW')).toBe(true);
    expect(platformEventEditorIsReadOnly('APPROVED')).toBe(true);

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );
    expect(template).toContain(
      '[disabled]="eventEditorIsReadOnly(event.status)"',
    );
    expect(template).toContain(
      '[attr.inert]="eventEditorIsReadOnly(event.status) ? \'\' : null"',
    );
    expect(template).toContain('Return this event to draft before editing it.');
  });

  it('keeps simple events to one organizer and one participant registration', () => {
    const validOptions = [
      { organizingRegistration: true },
      { organizingRegistration: false },
    ];

    expect(platformEventSimpleModeIssue(true, validOptions)).toBeNull();
    expect(
      platformEventSimpleModeIssue(true, [
        { organizingRegistration: true },
        { organizingRegistration: true },
      ]),
    ).toBe(
      'Simple events need one organizer registration and one participant registration.',
    );
    expect(
      platformEventSimpleModeIssue(false, [
        { organizingRegistration: true },
        { organizingRegistration: true },
      ]),
    ).toBeNull();

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );
    expect(template).toContain('simpleModeIssue() !== null');
    expect(template).toContain('@if (simpleModeIssue(); as error)');
  });

  it('keeps platform event editing on the supported registration modes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).toContain('<mat-option value="fcfs"');
    expect(template).toContain('<mat-option value="application"');
    expect(template).not.toContain('unsupportedRegistrationOptions');
    expect(source).not.toContain('unsupportedPlatformEventRegistrationOptions');
    expect(template).toContain('event.simpleModeEnabled');
    expect(source).toContain('globalAdmin.tenants.findOne.queryOptions');
    expect(source).not.toContain('resetPlatformEventGraphPayments');
    expect(source).toContain('paidGraphBlocked');
    expect(template).toContain('[disabled]="!stripeConnected()"');
    expect(template).toContain('status could not be loaded');
    expect(template).toContain('data is preserved');
    expect(template).toContain('cannot be saved until Stripe is connected');
    expect(template).toContain('Event editing settings could not be loaded');
    expect(template).toContain('(click)="formOptionsQuery.refetch()"');
    expect(template).toContain('!formOptionsReady()');
  });

  it('blocks invalid target-timezone registration windows instead of saving stale instants', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('invalidRegistrationWindowFields');
    expect(source).toContain('new Set([...fields, fieldKey])');
    expect(template).toContain('invalidRegistrationWindowFields().size > 0');
    expect(template).toContain('Enter a valid time in');
    expect(template).not.toContain('| date:');
  });

  it('blocks reversed event and registration windows with field-level guidance', () => {
    expect(
      platformEventRegistrationWindowHasValidOrder({
        closeRegistrationTime: '2026-07-14T10:00:00.000Z',
        openRegistrationTime: '2026-07-14T11:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      platformEventRegistrationWindowHasValidOrder({
        closeRegistrationTime: '2026-07-14T11:00:00.000Z',
        openRegistrationTime: '2026-07-14T11:00:00.000Z',
      }),
    ).toBe(true);

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('validate(event.end');
    expect(source).toContain('hasInvalidRegistrationWindowOrder');
    expect(source).toContain('The event must end after it starts.');
    expect(template).toContain('Registration must close at or after it opens.');
    expect(template).toContain('hasInvalidRegistrationWindowOrder()');
  });

  it('accepts ordinary currency amounts while retaining minor-unit graph values', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('majorCurrencyInputToMinorUnits');
    expect(source).toContain('currencyAmountErrors().size > 0');
    expect(template).toMatch(
      /\[value\]="\s*minorUnitsToMajorCurrencyInput\(option\.price\)\s*"/,
    );
    expect(template).toContain('(input)="setAddOnPrice(addOnIndex, $event)"');
    expect(template).toContain('targetTenantCurrency()');
    expect(template).not.toContain('Price in minor units');
  });

  it('requires paid registration and add-on prices to contain at least one minor unit', () => {
    expect(platformEventPaidRegistrationPriceIssue(false, 0)).toBeNull();
    expect(platformEventPaidRegistrationPriceIssue(true, 0)).toBe(
      'Paid registrations must cost at least 0.01.',
    );
    expect(platformEventPaidRegistrationPriceIssue(true, 1)).toBeNull();
    expect(platformEventPaidAddOnPriceIssue(false, 0)).toBeNull();
    expect(platformEventPaidAddOnPriceIssue(true, 0)).toBe(
      'Paid add-ons must cost at least 0.01.',
    );
    expect(platformEventPaidAddOnPriceIssue(true, 1)).toBeNull();
    expect(platformEventDiscountedPriceIssue(true, 1000, 2000, true)).toBe(
      'Discounted price cannot exceed the base price.',
    );
    expect(platformEventDiscountedPriceIssue(true, 1000, 900, true)).toBeNull();
    expect(platformEventDiscountedPriceIssue(true, 1000, 900, false)).toBe(
      'Remove the ESNcard price because ESNcard discounts are disabled for this organization.',
    );

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'platformEventPaidRegistrationPriceIssue(option.isPaid, option.price)',
    );
    expect(source).toContain(
      'platformEventPaidAddOnPriceIssue(addOn.isPaid, addOn.price)',
    );
    expect(source).toContain('platformEventDiscountedPriceIssue(');
    expect(template).toMatch(
      /<mat-label>\s*Price[\s\S]*?min="0\.01"[\s\S]*?setOptionPrice\(optionIndex, 'price', \$event\)/,
    );
  });

  it('treats blank required numeric edits as invalid instead of retaining stale values', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(platformEventIntegerIssue(NaN, 0)).toBe(
      'Enter a whole number of zero or more.',
    );
    expect(platformEventIntegerIssue(0, 0)).toBeNull();
    expect(platformEventIntegerIssue(0, 1)).toBe(
      'Enter a whole number of at least one.',
    );
    expect(source).toContain('value === null ? NaN : value');
    expect(source).toContain('this.graphHasIssues()');
    expect(template).toContain('graphHasIssues()');
  });

  it('offers only named organization-role checkboxes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).not.toContain('<mat-label>Role IDs</mat-label>');
    expect(template).not.toContain('setOptionRoleIds');
    expect(template).toContain('{{ role.name }}');
    expect(source).not.toContain('setOptionRoleIds');
  });

  it('allows optional-only add-on mappings and rejects an empty mapping', () => {
    const addOn = { maxQuantityPerUser: 2, totalAvailableQuantity: 3 };
    expect(platformEventAddOnMappingIssue(addOn, 0, 2)).toBeNull();
    expect(platformEventAddOnMappingIssue(addOn, 1, 0)).toBeNull();
    expect(platformEventAddOnMappingIssue(addOn, 0, 0)).toBe(
      'Include or offer at least one unit.',
    );
    expect(platformEventAddOnMappingIssue(addOn, 2, 2)).toBe(
      'Included and optional quantities cannot exceed available stock.',
    );
    expect(platformEventAddOnMappingIssue(addOn, 0, 3)).toBe(
      'Optional quantity cannot exceed the maximum per attendee.',
    );
    expect(
      platformEventAddOnAvailabilityIssue({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
      }),
    ).toBe('Choose when this add-on is available.');
    expect(
      platformEventAddOnStockIssue({
        maxQuantityPerUser: 4,
        totalAvailableQuantity: 3,
      }),
    ).toBe('Maximum per attendee cannot exceed available stock.');
    const taxRateIds = new Set(['txr_1']);
    expect(platformEventPaidTaxRateIssue(true, null, taxRateIds)).toBe(
      'Select an inclusive tax rate for this paid item.',
    );
    expect(
      platformEventPaidTaxRateIssue(true, 'txr_inactive', taxRateIds),
    ).toBe(
      'This tax rate is no longer available. Choose another inclusive tax rate.',
    );
    expect(platformEventPaidTaxRateIssue(true, 'txr_1', taxRateIds)).toBeNull();

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(template).toMatch(/<mat-label>Included<\/mat-label>[\s\S]*?min="0"/);
    expect(template).toContain('addOnMappingIssue(');
    expect(template).toContain('addOnAvailabilityIssue(addOn)');
    expect(template).toContain('paidTaxRateIssue(');
  });

  it('accepts platform add-on caps and rejects cap plus one', () => {
    const addOn = {
      maxQuantityPerUser: MAX_REGISTRATION_ADDON_QUANTITY,
      totalAvailableQuantity: 100,
    };

    expect(
      platformEventAddOnQuantityLimitIssue(MAX_REGISTRATION_ADDON_QUANTITY),
    ).toBeNull();
    expect(
      platformEventAddOnQuantityLimitIssue(MAX_REGISTRATION_ADDON_QUANTITY + 1),
    ).toBe(
      `Maximum per attendee cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY}.`,
    );
    expect(platformEventAddOnMappingIssue(addOn, 4, 6)).toBeNull();
    expect(platformEventAddOnMappingIssue(addOn, 4, 7)).toBe(
      `Included and optional quantities cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY} per registration.`,
    );
    expect(
      platformEventAddonTypeLimitIssue(
        Array.from({ length: MAX_EVENT_ADDON_TYPES }),
      ),
    ).toBeNull();
    expect(
      platformEventAddonTypeLimitIssue(
        Array.from({ length: MAX_EVENT_ADDON_TYPES + 1 }),
      ),
    ).toBe(`Events support at most ${MAX_EVENT_ADDON_TYPES} add-on types.`);

    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );
    expect(
      template.match(/\[max\]="maxRegistrationAddonQuantity"/g)?.length,
    ).toBe(3);
    expect(template).toContain(
      '[disabled]="graph.addOns.length >= maxEventAddonTypes"',
    );
    expect(template).toContain('addOnTypeLimitIssue(graph.addOns)');
  });

  it('explains blank graph titles and invalid question targets before saving', () => {
    const registrationOptionIds = new Set(['option-1']);

    expect(platformEventTitleIssue('  ', 'registration option')).toBe(
      'Enter a registration option title.',
    );
    expect(platformEventTitleIssue('Dinner', 'add-on')).toBeNull();
    expect(
      platformEventQuestionOptionIssue('missing-option', registrationOptionIds),
    ).toBe('Select a registration option for this question.');
    expect(
      platformEventQuestionOptionIssue('option-1', registrationOptionIds),
    ).toBeNull();

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
      ),
      'utf8',
    );

    expect(source).toContain('platformEventGraphHasIssues');
    expect(template).toContain(
      'titleIssue(option.title, "registration option")',
    );
    expect(template).toContain('questionOptionIssue(');
  });
});
