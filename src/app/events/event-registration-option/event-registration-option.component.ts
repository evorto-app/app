import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { interval, map } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { PriceWithTaxComponent } from '../../shared/components/inclusive-price-label/price-with-tax.component';

export interface EventRegistrationAddonView {
  allowPurchaseDuringRegistration: boolean;
  id: string;
  isPaid: boolean;
  maxQuantityPerUser: number;
  price: number;
  registrationOptions: readonly {
    includedQuantity: number;
    optionalPurchaseQuantity: number;
    registrationOptionId: string;
  }[];
  taxRateDisplayName?: null | string;
  taxRatePercentage?: null | string;
  title: string;
  totalAvailableQuantity: number;
}

export interface EventRegistrationOptionView {
  appliedDiscountType?: 'esnCard' | null;
  closeRegistrationTime: string;
  confirmedSpots: number;
  description: null | string;
  discountApplied?: boolean;
  effectivePrice?: number;
  esnCardDiscountedPrice?: null | number;
  eventId: string;
  id: string;
  isPaid: boolean;
  openRegistrationTime: string;
  organizingRegistration: boolean;
  price: number;
  questions: readonly {
    description: null | string;
    id: string;
    required: boolean;
    sortOrder: number;
    title: string;
  }[];
  registrationMode: 'application' | 'fcfs' | 'random';
  reservedSpots: number;
  spots: number;
  stripeTaxRateId?: null | string;
  taxRateDisplayName?: null | string;
  taxRatePercentage?: null | string;
  title: string;
}

export type RegistrationAvailability = 'open' | 'tooEarly' | 'tooLate';

export const registrationOptionAudienceCopy = (
  option: Pick<
    EventRegistrationOptionView,
    'organizingRegistration' | 'registrationMode'
  >,
): {
  actionSuffix: string;
  helperText: string;
  label: string;
  primaryAction: string;
} => {
  if (option.organizingRegistration) {
    return {
      actionSuffix: 'sign up as organizer/helper',
      helperText: 'Use this option when you are helping run the event.',
      label: 'Organizer/helper option',
      primaryAction: 'Sign up as organizer/helper',
    };
  }

  if (option.registrationMode === 'application') {
    return {
      actionSuffix: 'apply',
      helperText:
        'Applying does not charge you or confirm a spot. An organizer reviews the application first; if this option has a fee, payment starts only after approval.',
      label: 'Manual approval option',
      primaryAction: 'Apply for approval',
    };
  }

  return {
    actionSuffix: 'register',
    helperText: 'Use this option when you are attending the event.',
    label: 'Participant option',
    primaryAction: 'Register',
  };
};

export const registrationOptionIsFull = (
  option: Pick<
    EventRegistrationOptionView,
    'confirmedSpots' | 'reservedSpots' | 'spots'
  >,
): boolean => option.confirmedSpots + option.reservedSpots >= option.spots;

export const registrationOptionCanJoinWaitlist = (
  option: Pick<
    EventRegistrationOptionView,
    | 'confirmedSpots'
    | 'organizingRegistration'
    | 'registrationMode'
    | 'reservedSpots'
    | 'spots'
  >,
): boolean =>
  !option.organizingRegistration &&
  option.registrationMode === 'fcfs' &&
  registrationOptionIsFull(option);

export const registrationOptionAvailableSpots = (
  option: Pick<
    EventRegistrationOptionView,
    'confirmedSpots' | 'reservedSpots' | 'spots'
  >,
): number =>
  Math.max(0, option.spots - option.confirmedSpots - option.reservedSpots);

export const registrationOptionSelectedTotalPrice = (
  option: Pick<EventRegistrationOptionView, 'effectivePrice' | 'price'>,
  guestCount: number,
): number => {
  const buyerPrice = option.effectivePrice ?? option.price;
  return buyerPrice + option.price * Math.max(0, guestCount);
};

export const registrationAddonPurchasePayload = (
  addOns: readonly Pick<
    EventRegistrationAddonView,
    'id' | 'registrationOptions'
  >[],
  selections: Readonly<Record<string, number>>,
  registrationOptionId: string,
): { addOnId: string; quantity: number }[] =>
  addOns
    .filter((addOn) =>
      addOn.registrationOptions.some(
        (option) => option.registrationOptionId === registrationOptionId,
      ),
    )
    .map((addOn) => ({
      addOnId: addOn.id,
      quantity: Math.max(0, Math.trunc(selections[addOn.id] ?? 0)),
    }))
    .filter((addOn) => addOn.quantity > 0);

export const registrationAddonMaxSelectableQuantity = (
  addOn: Pick<
    EventRegistrationAddonView,
    'maxQuantityPerUser' | 'registrationOptions' | 'totalAvailableQuantity'
  >,
  registrationOptionId: string,
): number => {
  const attachment = addOn.registrationOptions.find(
    (option) => option.registrationOptionId === registrationOptionId,
  );

  if (!attachment || attachment.optionalPurchaseQuantity <= 0) {
    return 0;
  }

  return Math.min(
    attachment.optionalPurchaseQuantity,
    Math.max(0, addOn.maxQuantityPerUser - attachment.includedQuantity),
    Math.max(0, addOn.totalAvailableQuantity - attachment.includedQuantity),
  );
};

export const registrationAddonSelectedTotalPrice = (
  addOns: readonly Pick<
    EventRegistrationAddonView,
    'id' | 'price' | 'registrationOptions'
  >[],
  selections: Readonly<Record<string, number>>,
  registrationOptionId: string,
): number => {
  let total = 0;

  for (const addOn of addOns) {
    const attachment = addOn.registrationOptions.find(
      (option) => option.registrationOptionId === registrationOptionId,
    );
    if (!attachment || attachment.optionalPurchaseQuantity <= 0) continue;
    total += addOn.price * Math.max(0, Math.trunc(selections[addOn.id] ?? 0));
  }

  return total;
};

export const registrationQuestionAnswerPayload = (
  option: Pick<EventRegistrationOptionView, 'questions'>,
  answers: Readonly<Record<string, string>>,
): { answer: string; questionId: string }[] =>
  option.questions
    .map((question) => ({
      answer: (answers[question.id] ?? '').trim(),
      questionId: question.id,
    }))
    .filter((answer) => answer.answer.length > 0);

export const registrationQuestionsMissingRequired = (
  option: Pick<EventRegistrationOptionView, 'questions'>,
  answers: Readonly<Record<string, string>>,
): boolean =>
  option.questions.some(
    (question) => question.required && !(answers[question.id] ?? '').trim(),
  );

export const registrationOptionWriteActionDisabled = (input: {
  missingRequiredAnswers?: boolean;
  mutationPending: boolean;
}): boolean => input.mutationPending || input.missingRequiredAnswers === true;

export const registrationOptionAvailability = (
  option: Pick<
    EventRegistrationOptionView,
    'closeRegistrationTime' | 'openRegistrationTime'
  >,
  currentTime: Date,
): RegistrationAvailability => {
  if (new Date(option.openRegistrationTime) > currentTime) {
    return 'tooEarly';
  }
  if (new Date(option.closeRegistrationTime) < currentTime) {
    return 'tooLate';
  }
  return 'open';
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    CurrencyPipe,
    DatePipe,
    PriceWithTaxComponent,
  ],
  selector: 'app-event-registration-option',
  styles: ``,
  templateUrl: './event-registration-option.component.html',
})
export class EventRegistrationOptionComponent {
  public readonly addOns = input<readonly EventRegistrationAddonView[]>([]);
  public readonly registrationOption =
    input.required<EventRegistrationOptionView>();
  protected readonly audienceCopy = computed(() =>
    registrationOptionAudienceCopy(this.registrationOption()),
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly authenticationQuery = injectQuery(() =>
    this.rpc.config.isAuthenticated.queryOptions(),
  );
  protected readonly availableSpots = computed(() =>
    registrationOptionAvailableSpots(this.registrationOption()),
  );
  protected readonly full = computed(() => {
    const option = this.registrationOption();
    return (
      option.registrationMode !== 'application' &&
      registrationOptionIsFull(option)
    );
  });
  protected readonly guestCount = signal(0);
  protected readonly maxGuestCount = computed(() =>
    this.registrationOption().organizingRegistration
      ? 0
      : Math.max(0, this.availableSpots() - 1),
  );
  protected readonly registrationMutation = injectMutation(() =>
    this.rpc.events.registerForEvent.mutationOptions(),
  );
  protected readonly waitlistMutation = injectMutation(() =>
    this.rpc.events.joinWaitlist.mutationOptions(),
  );
  protected readonly mutationPending = computed(
    () =>
      this.registrationMutation.isPending() ||
      this.waitlistMutation.isPending(),
  );
  private readonly addonSelections = signal<Record<string, number>>({});
  protected readonly selectedAddonTotalPrice = computed(() =>
    registrationAddonSelectedTotalPrice(
      this.addOns(),
      this.addonSelections(),
      this.registrationOption().id,
    ),
  );
  protected readonly selectedGuestCount = computed(() =>
    Math.min(this.guestCount(), this.maxGuestCount()),
  );
  protected readonly selectedTotalPrice = computed(() => {
    return (
      registrationOptionSelectedTotalPrice(
        this.registrationOption(),
        this.selectedGuestCount(),
      ) + this.selectedAddonTotalPrice()
    );
  });
  protected readonly paymentDueDuringRegistration = computed(
    () =>
      this.registrationOption().registrationMode !== 'application' &&
      this.selectedTotalPrice() > 0,
  );
  private currentTime = toSignal(interval(1000).pipe(map(() => new Date())), {
    initialValue: new Date(),
  });
  protected registrationOpen = computed(() => {
    return registrationOptionAvailability(
      this.registrationOption(),
      this.currentTime(),
    );
  });
  protected readonly registrationOptionWriteActionDisabled =
    registrationOptionWriteActionDisabled;
  private readonly registrationQuestionAnswers = signal<Record<string, string>>(
    {},
  );
  protected readonly registrationQuestionAnswersMissingRequired = computed(() =>
    registrationQuestionsMissingRequired(
      this.registrationOption(),
      this.registrationQuestionAnswers(),
    ),
  );
  protected readonly selectedSpotCount = computed(
    () => this.selectedGuestCount() + 1,
  );
  protected readonly taxRateInfo = computed(() => {
    const option = this.registrationOption();
    return {
      displayName: option.taxRateDisplayName ?? null,
      percentage: option.taxRatePercentage ?? null,
      stripeTaxRateId: option.stripeTaxRateId ?? null,
    };
  });
  protected readonly waitlistAvailable = computed(() => {
    return registrationOptionCanJoinWaitlist(this.registrationOption());
  });

  private queryClient = inject(QueryClient);

  addonIncludedQuantity(addOn: EventRegistrationAddonView): number {
    return (
      addOn.registrationOptions.find(
        (option) =>
          option.registrationOptionId === this.registrationOption().id,
      )?.includedQuantity ?? 0
    );
  }

  addonMaxQuantity(addOn: EventRegistrationAddonView): number {
    return registrationAddonMaxSelectableQuantity(
      addOn,
      this.registrationOption().id,
    );
  }

  addonQuantity(addOnId: string): number {
    return this.addonSelections()[addOnId] ?? 0;
  }

  addonTaxRate(addOn: {
    taxRateDisplayName?: null | string;
    taxRatePercentage?: null | string;
  }) {
    return addOn.taxRateDisplayName && addOn.taxRatePercentage
      ? {
          displayName: addOn.taxRateDisplayName,
          percentage: addOn.taxRatePercentage,
        }
      : undefined;
  }

  joinWaitlist(registrationOption: { eventId: string; id: string }) {
    if (
      registrationOptionWriteActionDisabled({
        missingRequiredAnswers:
          this.registrationQuestionAnswersMissingRequired(),
        mutationPending: this.mutationPending(),
      })
    ) {
      return;
    }

    this.waitlistMutation.mutate(
      {
        answers: registrationQuestionAnswerPayload(
          this.registrationOption(),
          this.registrationQuestionAnswers(),
        ),
        eventId: registrationOption.eventId,
        registrationOptionId: registrationOption.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.rpc.events.getRegistrationStatus.queryKey({
              eventId: registrationOption.eventId,
            }),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.rpc.events.findOne.queryKey({
              id: registrationOption.eventId,
            }),
          });
        },
      },
    );
  }

  register(registrationOption: { eventId: string; id: string }) {
    if (
      registrationOptionWriteActionDisabled({
        missingRequiredAnswers:
          this.registrationQuestionAnswersMissingRequired(),
        mutationPending: this.mutationPending(),
      })
    ) {
      return;
    }

    this.registrationMutation.mutate(
      {
        addOns: registrationAddonPurchasePayload(
          this.addOns(),
          this.addonSelections(),
          registrationOption.id,
        ),
        answers: registrationQuestionAnswerPayload(
          this.registrationOption(),
          this.registrationQuestionAnswers(),
        ),
        eventId: registrationOption.eventId,
        guestCount: this.selectedGuestCount(),
        registrationOptionId: registrationOption.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.rpc.events.getRegistrationStatus.queryKey({
              eventId: registrationOption.eventId,
            }),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.rpc.events.findOne.queryKey({
              id: registrationOption.eventId,
            }),
          });
        },
      },
    );
  }

  registrationQuestionAnswer(questionId: string): string {
    return this.registrationQuestionAnswers()[questionId] ?? '';
  }

  updateAddonQuantity(addOn: EventRegistrationAddonView, event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const parsed = Number.parseInt(input.value, 10);
    const nextQuantity = Math.max(
      0,
      Math.min(Number.isNaN(parsed) ? 0 : parsed, this.addonMaxQuantity(addOn)),
    );
    this.addonSelections.update((selections) => ({
      ...selections,
      [addOn.id]: nextQuantity,
    }));
  }

  updateGuestCount(event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const nextGuestCount = Number.parseInt(input.value, 10);
    this.guestCount.set(
      Math.max(
        0,
        Math.min(
          Number.isNaN(nextGuestCount) ? 0 : nextGuestCount,
          this.maxGuestCount(),
        ),
      ),
    );
  }

  updateRegistrationQuestionAnswer(questionId: string, event: Event) {
    const input = event.target;
    if (
      !(input instanceof HTMLInputElement) &&
      !(input instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    this.registrationQuestionAnswers.update((answers) => ({
      ...answers,
      [questionId]: input.value,
    }));
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Unknown error');
  }
}
