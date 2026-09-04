import { TestBed } from '@angular/core/testing';
import { MAX_REGISTRATION_GUESTS } from '@shared/registration-quantity-limits';
import { MAX_REGISTRATION_ANSWER_LENGTH } from '@shared/registration-question-limits';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  EventRegistrationOptionComponent,
  type EventRegistrationOptionView,
  registrationAddonIsSoldOut,
  registrationAddonMaxSelectableQuantity,
  registrationAddonPurchasePayload,
  registrationAddonSelectedTotalPrice,
  registrationAddonSoldOutLabel,
  registrationOptionAudienceCopy,
  registrationOptionAvailability,
  registrationOptionAvailableSpots,
  registrationOptionCanJoinWaitlist,
  registrationOptionIsFull,
  registrationOptionSelectedTotalPrice,
  registrationOptionWriteActionDisabled,
  registrationQuestionAnswerPayload,
  registrationQuestionsMissingRequired,
  registrationWriteErrorMessage,
} from './event-registration-option.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

describe('registration write errors', () => {
  it('shows the safe reason when registration conditions changed', () => {
    expect(
      registrationWriteErrorMessage({
        _tag: 'EventRegistrationConflictError',
        message: 'This sign-up choice is now full.',
      }),
    ).toBe('This sign-up choice is now full.');
  });

  it('keeps unexpected server details private', () => {
    expect(
      registrationWriteErrorMessage({
        _tag: 'EventRegistrationInternalError',
        message: 'database constraint event_registrations_tenant_id_fkey',
      }),
    ).toBe("We couldn't complete this request. Try again.");
  });
});

describe('unsupported registration mode template', () => {
  it('shows the warning before add-ons, questions, authentication, or write controls', () => {
    const template = readSource(
      'src/app/events/event-registration-option/event-registration-option.component.html',
    );
    const guardIndex = template.indexOf('@if (!registrationModeSupported())');
    const supportedModeBranchIndex = template.indexOf('} @else {', guardIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(template.lastIndexOf('@if (!registrationModeSupported())')).toBe(
      guardIndex,
    );
    expect(supportedModeBranchIndex).toBeGreaterThan(guardIndex);

    for (const editableMarker of [
      '@if (addOns().length',
      '@if (registrationOption().questions.length',
      '@if (authenticationQuery.isPending())',
      '<input',
      '<textarea',
      '<button',
      'href="/forward-login',
    ]) {
      expect(template.indexOf(editableMarker)).toBeGreaterThan(
        supportedModeBranchIndex,
      );
    }
  });
});

describe('guest selection template', () => {
  it('explains account ownership and capacity in the Material field', () => {
    const template = readSource(
      'src/app/events/event-registration-option/event-registration-option.component.html',
    );

    expect(template).toContain(
      'Guests do not need separate accounts. Each guest uses one',
    );
    expect(template).toContain('available spot and shares your registration.');
    expect(template).toContain('subscriptSizing="dynamic"');
    expect(template).toContain('selectedSpotCount() === 1 ? "spot" : "spots"');
  });
});

describe('registration add-on template', () => {
  it('distinguishes included prices from optional unit prices and names quantity controls', () => {
    const template = readSource(
      'src/app/events/event-registration-option/event-registration-option.component.html',
    );

    expect(template).toContain('Included in registration price');
    expect(template).toContain('per extra item');
    expect(template).toContain('@else if (soldOut)');
    expect(template).toContain('addonSoldOutLabel(includedQuantity)');
    expect(template).toContain(
      `[attr.aria-label]="'Quantity for ' + addOn.title"`,
    );
  });
});

describe('registrationOptionAudienceCopy', () => {
  it('keeps participant options on registration copy', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: false,
        registrationMode: 'fcfs',
      }),
    ).toEqual({
      actionSuffix: 'register',
      helperText: 'Use this option when you are attending the event.',
      label: 'Participant option',
      primaryAction: 'Register',
    });
  });

  it('uses distinct organizer/helper signup copy', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: true,
        registrationMode: 'fcfs',
      }),
    ).toEqual({
      actionSuffix: 'sign up as organizer/helper',
      helperText: 'Use this option when you are helping run the event.',
      label: 'Organizer/helper option',
      primaryAction: 'Sign up as organizer/helper',
    });
  });

  it('uses application copy for manual approval participant options', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: false,
        registrationMode: 'application',
      }),
    ).toEqual({
      actionSuffix: 'apply',
      helperText:
        'Applying does not charge you or confirm a spot. An organizer reviews the application first; if this option has a fee, payment starts only after approval.',
      label: 'Manual approval option',
      primaryAction: 'Apply for approval',
    });
  });

  it('explains approval and deferred access for organizer/helper applications', () => {
    expect(
      registrationOptionAudienceCopy({
        organizingRegistration: true,
        registrationMode: 'application',
      }),
    ).toEqual({
      actionSuffix: 'apply as organizer/helper',
      helperText:
        'Applying does not confirm organizer access. An organizer reviews your application first; if this option has a fee, payment starts only after approval.',
      label: 'Organizer/helper application',
      primaryAction: 'Apply as organizer/helper',
    });
  });
});

describe('registrationOptionIsFull', () => {
  it('treats confirmed plus reserved spots as unavailable capacity', () => {
    expect(
      registrationOptionIsFull({
        confirmedSpots: 8,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(true);
  });

  it('keeps registration available when any spot remains', () => {
    expect(
      registrationOptionIsFull({
        confirmedSpots: 7,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });
});

describe('registrationOptionCanJoinWaitlist', () => {
  it('allows waitlist joining for full participant first-come options', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 8,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(true);
  });

  it('does not offer waitlists for organizer/helper options', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 8,
        organizingRegistration: true,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });

  it('does not offer waitlists for stored unsupported participant modes', () => {
    for (const registrationMode of ['application', 'random'] as const) {
      expect(
        registrationOptionCanJoinWaitlist({
          confirmedSpots: 8,
          organizingRegistration: false,
          registrationMode,
          reservedSpots: 2,
          spots: 10,
        }),
      ).toBe(false);
    }
  });

  it('keeps normal registration primary while spots remain', () => {
    expect(
      registrationOptionCanJoinWaitlist({
        confirmedSpots: 7,
        organizingRegistration: false,
        registrationMode: 'fcfs',
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(false);
  });
});

describe('registrationOptionAvailableSpots', () => {
  it('subtracts confirmed and reserved spots from total capacity', () => {
    expect(
      registrationOptionAvailableSpots({
        confirmedSpots: 3,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(5);
  });

  it('never returns negative available capacity', () => {
    expect(
      registrationOptionAvailableSpots({
        confirmedSpots: 10,
        reservedSpots: 2,
        spots: 10,
      }),
    ).toBe(0);
  });
});

describe('registrationOptionAvailability', () => {
  const currentTime = new Date('2026-09-15T12:00:00.000Z');

  it('blocks direct registration before the option opens', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-20T12:00:00.000Z',
          openRegistrationTime: '2026-09-16T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('tooEarly');
  });

  it('blocks direct registration after the option closes', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-14T12:00:00.000Z',
          openRegistrationTime: '2026-09-10T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('tooLate');
  });

  it('keeps direct registration open inside the registration window', () => {
    expect(
      registrationOptionAvailability(
        {
          closeRegistrationTime: '2026-09-20T12:00:00.000Z',
          openRegistrationTime: '2026-09-10T12:00:00.000Z',
        },
        currentTime,
      ),
    ).toBe('open');
  });
});

describe('registrationOptionSelectedTotalPrice', () => {
  it('uses discounted buyer price for the signed-in user and full price for guests', () => {
    expect(
      registrationOptionSelectedTotalPrice(
        {
          effectivePrice: 1500,
          price: 2000,
        },
        2,
      ),
    ).toBe(5500);
  });

  it('falls back to the option price when no discount is active', () => {
    expect(
      registrationOptionSelectedTotalPrice(
        {
          price: 2000,
        },
        2,
      ),
    ).toBe(6000);
  });

  it('does not let negative guest counts reduce the total', () => {
    expect(
      registrationOptionSelectedTotalPrice(
        {
          effectivePrice: 1500,
          price: 2000,
        },
        -1,
      ),
    ).toBe(1500);
  });
});

describe('registration add-on selections', () => {
  const addOns = [
    {
      allowPurchaseDuringRegistration: true,
      id: 'addon-1',
      price: 500,
      registrationOptions: [
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 2,
          registrationOptionId: 'option-1',
        },
      ],
    },
    {
      allowPurchaseDuringRegistration: true,
      id: 'addon-2',
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 4,
          registrationOptionId: 'option-1',
        },
      ],
    },
  ] as const;

  it('normalizes selected add-ons for the registration mutation payload', () => {
    expect(
      registrationAddonPurchasePayload(
        addOns,
        {
          'addon-1': 2,
          'addon-2': 0,
        },
        'option-1',
      ),
    ).toEqual([
      {
        addOnId: 'addon-1',
        quantity: 2,
      },
    ]);
  });

  it('adds selected paid add-ons to the checkout total', () => {
    expect(
      registrationAddonSelectedTotalPrice(
        addOns,
        {
          'addon-1': 2,
          'addon-2': 4,
        },
        'option-1',
      ),
    ).toBe(1000);
  });

  it('caps selectable add-ons by attached quantity and remaining stock', () => {
    expect(
      registrationAddonMaxSelectableQuantity(
        {
          allowPurchaseDuringRegistration: true,
          maxQuantityPerUser: 5,
          registrationOptions: [
            {
              includedQuantity: 1,
              optionalPurchaseQuantity: 4,
              registrationOptionId: 'option-1',
            },
          ],
          totalAvailableQuantity: 3,
        },
        'option-1',
      ),
    ).toBe(2);
  });

  it('does not count included add-ons against the optional per-user limit', () => {
    expect(
      registrationAddonMaxSelectableQuantity(
        {
          allowPurchaseDuringRegistration: true,
          maxQuantityPerUser: 3,
          registrationOptions: [
            {
              includedQuantity: 2,
              optionalPurchaseQuantity: 3,
              registrationOptionId: 'option-1',
            },
          ],
          totalAvailableQuantity: 10,
        },
        'option-1',
      ),
    ).toBe(3);
  });

  it('marks a configured optional add-on as sold out when no stock remains', () => {
    const soldOutAddOn = {
      allowPurchaseDuringRegistration: true,
      maxQuantityPerUser: 3,
      registrationOptions: [
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 3,
          registrationOptionId: 'option-1',
        },
      ],
      totalAvailableQuantity: 0,
    } as const;

    expect(
      registrationAddonMaxSelectableQuantity(soldOutAddOn, 'option-1'),
    ).toBe(0);
    expect(registrationAddonIsSoldOut(soldOutAddOn, 'option-1')).toBe(true);
  });

  it('clarifies whether the whole add-on or only extra items are sold out', () => {
    expect(registrationAddonSoldOutLabel(0)).toBe('Sold out');
    expect(registrationAddonSoldOutLabel(2)).toBe('Extra items sold out');
  });

  it('shows included add-ons without allowing optional selection outside the registration purchase window', () => {
    const includedOnlyAddOn = {
      allowPurchaseDuringRegistration: false,
      id: 'included-only',
      maxQuantityPerUser: 3,
      price: 500,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 3,
          registrationOptionId: 'option-1',
        },
      ],
      totalAvailableQuantity: 10,
    } as const;

    expect(
      registrationAddonMaxSelectableQuantity(includedOnlyAddOn, 'option-1'),
    ).toBe(0);
    expect(
      registrationAddonPurchasePayload(
        [includedOnlyAddOn],
        { 'included-only': 3 },
        'option-1',
      ),
    ).toEqual([]);
    expect(
      registrationAddonSelectedTotalPrice(
        [includedOnlyAddOn],
        { 'included-only': 3 },
        'option-1',
      ),
    ).toBe(0);
    expect(registrationAddonIsSoldOut(includedOnlyAddOn, 'option-1')).toBe(
      false,
    );
  });
});

describe('registrationOptionWriteActionDisabled', () => {
  it('disables registration writes while register or waitlist mutations are pending', () => {
    expect(
      registrationOptionWriteActionDisabled({
        answersTooLong: false,
        controlsInteractive: true,
        mutationPending: true,
      }),
    ).toBe(true);
  });

  it('disables registration writes before the client controls are interactive', () => {
    expect(
      registrationOptionWriteActionDisabled({
        answersTooLong: false,
        controlsInteractive: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('allows registration writes while no register or waitlist mutation is pending', () => {
    expect(
      registrationOptionWriteActionDisabled({
        answersTooLong: false,
        controlsInteractive: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });

  it('disables registration writes while required answers are missing', () => {
    expect(
      registrationOptionWriteActionDisabled({
        answersTooLong: false,
        controlsInteractive: true,
        missingRequiredAnswers: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });
});

describe('registration question answers', () => {
  const option = {
    questions: [
      {
        description: null,
        id: 'question-1',
        required: true,
        sortOrder: 0,
        title: 'Emergency contact',
      },
      {
        description: null,
        id: 'question-2',
        required: false,
        sortOrder: 1,
        title: 'Dietary notes',
      },
    ],
  } as const;

  it('normalizes non-empty answers for the registration mutation payload', () => {
    expect(
      registrationQuestionAnswerPayload(option, {
        'question-1': '  Alice  ',
        'question-2': ' '.repeat(3),
      }),
    ).toEqual([
      {
        answer: 'Alice',
        questionId: 'question-1',
      },
    ]);
  });

  it('detects missing required answers', () => {
    expect(
      registrationQuestionsMissingRequired(option, {
        'question-1': ' '.repeat(3),
      }),
    ).toBe(true);
    expect(
      registrationQuestionsMissingRequired(option, {
        'question-1': 'Alice',
      }),
    ).toBe(false);
  });
});

type AuthenticationOptions = ReturnType<
  RegistrationClient['config']['isAuthenticated']['queryOptions']
>;
type RegisterOptions = ReturnType<
  RegistrationClient['events']['registerForEvent']['mutationOptions']
>;
type RegistrationClient = ReturnType<typeof AppRpc.injectClient>;
type WaitlistOptions = ReturnType<
  RegistrationClient['events']['joinWaitlist']['mutationOptions']
>;
const submitRegistration = vi.fn<NonNullable<RegisterOptions['mutationFn']>>();
const submitWaitlist = vi.fn<NonNullable<WaitlistOptions['mutationFn']>>();
const registrationOptions = (): RegisterOptions => ({
  mutationFn: submitRegistration,
  mutationKey: ['register'],
});
const waitlistOptions = (): WaitlistOptions => ({
  mutationFn: submitWaitlist,
  mutationKey: ['waitlist'],
});
const authenticationOptions = (): AuthenticationOptions => ({
  queryFn: async () => true,
  queryKey: [['config', 'isAuthenticated'], { type: 'query' }],
});

const boundedRegistrationOption = (
  overrides: Partial<EventRegistrationOptionView> = {},
): EventRegistrationOptionView => ({
  closeRegistrationTime: new Date(Date.now() + 60_000).toISOString(),
  confirmedSpots: 0,
  description: null,
  eventId: 'bounded-event',
  id: 'bounded-option',
  isPaid: false,
  openRegistrationTime: new Date(Date.now() - 60_000).toISOString(),
  organizingRegistration: false,
  price: 0,
  questions: [
    {
      description: null,
      id: 'bounded-question',
      required: true,
      sortOrder: 0,
      title: 'Your answer',
    },
  ],
  registrationMode: 'fcfs',
  reservedSpots: 0,
  spots: 50,
  title: 'Participant',
  ...overrides,
});

describe('EventRegistrationOptionComponent input limits', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    submitRegistration.mockReset().mockResolvedValue(undefined);
    submitWaitlist.mockReset().mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    await TestBed.configureTestingModule({
      imports: [EventRegistrationOptionComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            config: {
              isAuthenticated: { queryOptions: authenticationOptions },
            },
            events: {
              canOrganize: {
                queryKey: ({ eventId }: { eventId: string }) => [
                  'organize',
                  eventId,
                ],
              },
              findOne: { queryKey: ({ id }: { id: string }) => ['event', id] },
              getRegistrationStatus: {
                queryKey: ({ eventId }: { eventId: string }) => [
                  'registration-status',
                  eventId,
                ],
              },
              joinWaitlist: { mutationOptions: waitlistOptions },
              registerForEvent: { mutationOptions: registrationOptions },
            },
            users: {
              canUseScanner: { queryKey: () => ['scanner'] },
              events: { queryKey: () => ['user-events'] },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    queryClient.clear();
  });

  const render = async (option: EventRegistrationOptionView) => {
    const fixture = TestBed.createComponent(EventRegistrationOptionComponent);
    fixture.componentRef.setInput('registrationOption', option);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected an HTML registration root');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('button')).not.toBeNull();
    });
    return { element, fixture };
  };

  it('caps guests at the shared maximum and remaining capacity before submitting', async () => {
    const option = boundedRegistrationOption({ questions: [] });
    const { element, fixture } = await render(option);
    const guests = element.querySelector('input[type="number"]');
    if (!(guests instanceof HTMLInputElement))
      throw new Error('Expected a guest quantity input');
    expect(guests.max).toBe(String(MAX_REGISTRATION_GUESTS));
    guests.value = String(MAX_REGISTRATION_GUESTS + 5);
    guests.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(guests.value).toBe(String(MAX_REGISTRATION_GUESTS));
    guests.value = String(MAX_REGISTRATION_GUESTS + 1);
    guests.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(guests.value).toBe(String(MAX_REGISTRATION_GUESTS));
    fixture.componentRef.setInput('registrationOption', {
      ...option,
      spots: 4,
    });
    fixture.detectChanges();
    expect(guests.max).toBe('3');
    const registerButton = element.querySelector('button');
    if (!(registerButton instanceof HTMLButtonElement))
      throw new Error('Expected a registration button');
    registerButton.click();
    await fixture.whenStable();
    expect(submitRegistration).toHaveBeenCalledOnce();
    expect(submitRegistration.mock.calls[0]?.[0]).toMatchObject({
      guestCount: 3,
    });
  });

  it.each([false, true])(
    'blocks an overlong answer and accepts the boundary for waitlist=%s',
    async (waitlist) => {
      const option = boundedRegistrationOption({
        confirmedSpots: waitlist ? 50 : 0,
      });
      const { element, fixture } = await render(option);
      const answer = element.querySelector('textarea');
      if (!(answer instanceof HTMLTextAreaElement))
        throw new Error('Expected an answer textarea');
      expect(answer.maxLength).toBe(MAX_REGISTRATION_ANSWER_LENGTH);
      answer.value = 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH + 1);
      answer.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(element.textContent?.replaceAll(/\s+/g, ' ')).toContain(
        `Each answer must be ${MAX_REGISTRATION_ANSWER_LENGTH} characters or fewer.`,
      );
      expect(answer.getAttribute('aria-describedby')?.split(' ')).toContain(
        option.id + '-answer-length-error',
      );
      const button = element.querySelector('button');
      if (!(button instanceof HTMLButtonElement))
        throw new Error('Expected a sign-up button');
      expect(button.disabled).toBe(true);
      if (waitlist) fixture.componentInstance.joinWaitlist(option);
      else fixture.componentInstance.register(option);
      expect(submitRegistration).not.toHaveBeenCalled();
      expect(submitWaitlist).not.toHaveBeenCalled();
      answer.value = 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH);
      answer.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
      button.click();
      await fixture.whenStable();
      const mutation = waitlist ? submitWaitlist : submitRegistration;
      expect(mutation).toHaveBeenCalledOnce();
      expect(mutation.mock.calls[0]?.[0]).toMatchObject({
        answers: [
          {
            answer: 'a'.repeat(MAX_REGISTRATION_ANSWER_LENGTH),
            questionId: 'bounded-question',
          },
        ],
      });
    },
  );
});
