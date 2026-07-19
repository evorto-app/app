import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  type MatSelectChange,
  MatSelectModule,
} from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { type PlatformEventDetailRecord } from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  majorCurrencyInputToMinorUnits,
  minorUnitsToMajorCurrencyInput,
} from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';
import { EventStatusComponent } from '../../shared/components/event-status/event-status.component';
import {
  resetAddOnPayment,
  resetRegistrationPayment,
} from '../../shared/components/forms/payment-configuration';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import {
  platformEventInstantRangeHasValidOrder,
  platformEventInstantToDisplayDateTime,
  platformEventInstantToLocalDateTime,
  platformEventLocalDateTimeRangeHasValidOrder,
  platformEventLocalDateTimeToInstant,
} from './platform-event-date-time';

export interface PlatformEventAddonEdit {
  allowMultiple: boolean;
  allowPurchaseBeforeEvent: boolean;
  allowPurchaseDuringEvent: boolean;
  allowPurchaseDuringRegistration: boolean;
  description: null | string;
  id?: string;
  isPaid: boolean;
  maxQuantityPerUser: number;
  price: number;
  registrationOptions: {
    includedQuantity: number;
    optionalPurchaseQuantity: number;
    registrationOptionId: string;
  }[];
  stripeTaxRateId: null | string;
  title: string;
  totalAvailableQuantity: number;
}

export interface PlatformEventGraphEditModel {
  addOns: PlatformEventAddonEdit[];
  questions: PlatformEventQuestionEdit[];
  registrationOptions: PlatformEventRegistrationOptionEdit[];
}

export const platformEventIntegerIssue = (
  value: number,
  minimum: 0 | 1,
): null | string => {
  if (Number.isInteger(value) && value >= minimum) return null;
  return minimum === 0
    ? 'Enter a whole number of zero or more.'
    : 'Enter a whole number of at least one.';
};

export const platformEventPaidRegistrationPriceIssue = (
  isPaid: boolean,
  price: number,
): null | string =>
  !isPaid || (Number.isInteger(price) && price >= 1)
    ? null
    : 'Paid registrations must cost at least 0.01.';

export const platformEventPaidAddOnPriceIssue = (
  isPaid: boolean,
  price: number,
): null | string =>
  !isPaid || (Number.isInteger(price) && price >= 1)
    ? null
    : 'Paid add-ons must cost at least 0.01.';

export const platformEventPaidTaxRateIssue = (
  isPaid: boolean,
  stripeTaxRateId: null | string,
  availableTaxRateIds: ReadonlySet<string>,
): null | string => {
  if (!isPaid) return null;
  if (!stripeTaxRateId) {
    return 'Select an inclusive tax rate for this paid item.';
  }
  return availableTaxRateIds.has(stripeTaxRateId)
    ? null
    : 'This tax rate is no longer available. Choose another inclusive tax rate.';
};

type PlatformEventTitledItem = 'add-on' | 'question' | 'registration option';

export const platformEventTitleIssue = (
  title: string,
  item: PlatformEventTitledItem,
): null | string => (title.trim() ? null : `Enter a ${item} title.`);

export const platformEventQuestionOptionIssue = (
  registrationOptionId: string,
  registrationOptionIds: ReadonlySet<string>,
): null | string =>
  registrationOptionIds.has(registrationOptionId)
    ? null
    : 'Select a registration option for this question.';

export const platformEventSimpleModeIssue = (
  simpleModeEnabled: boolean,
  options: readonly { organizingRegistration: boolean }[],
): null | string =>
  !simpleModeEnabled ||
  (options.length === 2 &&
    options.filter((option) => option.organizingRegistration).length === 1)
    ? null
    : 'Simple events need one organizer registration and one participant registration.';

export const platformEventAddOnAvailabilityIssue = (
  addOn: Pick<
    PlatformEventAddonEdit,
    | 'allowPurchaseBeforeEvent'
    | 'allowPurchaseDuringEvent'
    | 'allowPurchaseDuringRegistration'
  >,
): null | string =>
  addOn.allowPurchaseBeforeEvent ||
  addOn.allowPurchaseDuringEvent ||
  addOn.allowPurchaseDuringRegistration
    ? null
    : 'Choose when this add-on is available.';

export const platformEventAddOnStockIssue = (
  addOn: Pick<
    PlatformEventAddonEdit,
    'maxQuantityPerUser' | 'totalAvailableQuantity'
  >,
): null | string =>
  addOn.maxQuantityPerUser > addOn.totalAvailableQuantity
    ? 'Maximum per attendee cannot exceed available stock.'
    : null;

export const platformEventAddOnMappingIssue = (
  addOn: Pick<
    PlatformEventAddonEdit,
    'maxQuantityPerUser' | 'totalAvailableQuantity'
  >,
  includedQuantity: number,
  optionalPurchaseQuantity: number,
): null | string => {
  const total = includedQuantity + optionalPurchaseQuantity;
  if (total === 0) return 'Include or offer at least one unit.';
  if (total > addOn.totalAvailableQuantity) {
    return 'Included and optional quantities cannot exceed available stock.';
  }
  return optionalPurchaseQuantity > addOn.maxQuantityPerUser
    ? 'Optional quantity cannot exceed the maximum per attendee.'
    : null;
};

export const platformEventDiscountedPriceIssue = (
  isPaid: boolean,
  price: number,
  discountedPrice: null | number,
  esnCardEnabled: boolean,
): null | string => {
  if (discountedPrice === null) return null;
  if (!esnCardEnabled) {
    return 'Remove the ESNcard price because ESNcard discounts are disabled for this organization.';
  }
  if (!isPaid)
    return 'ESNcard prices are only available for paid registrations.';
  if (!Number.isInteger(discountedPrice) || discountedPrice < 0) {
    return 'Discounted price must be a whole number of zero or more.';
  }
  return discountedPrice > price
    ? 'Discounted price cannot exceed the base price.'
    : null;
};

export const platformEventGraphHasIssues = (
  graph: PlatformEventGraphEditModel,
  options: {
    esnCardEnabled: boolean;
    taxRateIds: ReadonlySet<string>;
  },
): boolean => {
  const registrationOptionIds = new Set(
    graph.registrationOptions.map((option) => option.id),
  );
  return (
    graph.registrationOptions.some(
      (option) =>
        platformEventTitleIssue(option.title, 'registration option') !== null ||
        platformEventPaidRegistrationPriceIssue(option.isPaid, option.price) !==
          null ||
        platformEventPaidTaxRateIssue(
          option.isPaid,
          option.stripeTaxRateId,
          options.taxRateIds,
        ) !== null ||
        platformEventDiscountedPriceIssue(
          option.isPaid,
          option.price,
          option.esnCardDiscountedPrice,
          options.esnCardEnabled,
        ) !== null ||
        platformEventIntegerIssue(option.spots, 0) !== null ||
        (option.cancellationDeadlineHoursBeforeStart !== null &&
          platformEventIntegerIssue(
            option.cancellationDeadlineHoursBeforeStart,
            0,
          ) !== null) ||
        (option.transferDeadlineHoursBeforeStart !== null &&
          platformEventIntegerIssue(
            option.transferDeadlineHoursBeforeStart,
            0,
          ) !== null),
    ) ||
    graph.addOns.some(
      (addOn) =>
        platformEventTitleIssue(addOn.title, 'add-on') !== null ||
        platformEventPaidAddOnPriceIssue(addOn.isPaid, addOn.price) !== null ||
        platformEventPaidTaxRateIssue(
          addOn.isPaid,
          addOn.stripeTaxRateId,
          options.taxRateIds,
        ) !== null ||
        platformEventAddOnAvailabilityIssue(addOn) !== null ||
        platformEventAddOnStockIssue(addOn) !== null ||
        platformEventIntegerIssue(addOn.totalAvailableQuantity, 0) !== null ||
        platformEventIntegerIssue(addOn.maxQuantityPerUser, 1) !== null ||
        addOn.registrationOptions.some(
          (mapping) =>
            platformEventIntegerIssue(mapping.includedQuantity, 0) !== null ||
            platformEventIntegerIssue(mapping.optionalPurchaseQuantity, 0) !==
              null ||
            platformEventAddOnMappingIssue(
              addOn,
              mapping.includedQuantity,
              mapping.optionalPurchaseQuantity,
            ) !== null,
        ),
    ) ||
    graph.questions.some(
      (question) =>
        platformEventTitleIssue(question.title, 'question') !== null ||
        platformEventQuestionOptionIssue(
          question.registrationOptionId,
          registrationOptionIds,
        ) !== null ||
        platformEventIntegerIssue(question.sortOrder, 0) !== null,
    )
  );
};

interface PlatformEventEditFormModel {
  description: string;
  end: string;
  reason: string;
  start: string;
  title: string;
}

interface PlatformEventQuestionEdit {
  description: null | string;
  id?: string;
  registrationOptionId: string;
  required: boolean;
  sortOrder: number;
  title: string;
}

type PlatformEventRegistrationOption =
  PlatformEventDetailRecord['registrationOptions'][number];

export const platformEventEditorIsReadOnly = (
  status: PlatformEventDetailRecord['status'],
): boolean => status !== 'DRAFT';

export const platformEventRegistrationWindowHasValidOrder = (
  option: Pick<
    PlatformEventRegistrationOption,
    'closeRegistrationTime' | 'openRegistrationTime'
  >,
): boolean =>
  platformEventInstantRangeHasValidOrder(
    option.openRegistrationTime,
    option.closeRegistrationTime,
    true,
  );

type PlatformEventRegistrationWindowField =
  'closeRegistrationTime' | 'openRegistrationTime';

export const unsupportedPlatformEventRegistrationOptions = <
  Option extends Pick<PlatformEventRegistrationOption, 'registrationMode'>,
>(
  options: readonly Option[],
): readonly Option[] =>
  options.filter((option) => option.registrationMode === 'random');

export const writablePlatformEventRegistrationOptions = <
  Option extends Pick<PlatformEventRegistrationOption, 'registrationMode'>,
>(
  options: readonly Option[],
):
  | readonly (Option & { registrationMode: 'application' | 'fcfs' })[]
  | undefined => {
  const supported = options.filter(
    (option): option is Option & { registrationMode: 'application' | 'fcfs' } =>
      option.registrationMode === 'application' ||
      option.registrationMode === 'fcfs',
  );
  return supported.length === options.length ? supported : undefined;
};

export interface PlatformEventRegistrationOptionEdit extends Omit<
  PlatformEventRegistrationOption,
  'roleIds'
> {
  roleIds: string[];
}

export const resetPlatformEventGraphPayments = <
  Model extends PlatformEventGraphEditModel,
>(
  model: Model,
): Model => {
  const addOns = model.addOns.map((addOn) => resetAddOnPayment(addOn, null));
  const registrationOptions = model.registrationOptions.map((option) =>
    resetRegistrationPayment(option, null, null),
  );
  const unchanged =
    addOns.every((addOn, index) => addOn === model.addOns[index]) &&
    registrationOptions.every(
      (option, index) => option === model.registrationOptions[index],
    );

  return unchanged ? model : { ...model, addOns, registrationOptions };
};

const textInputValue = (event: Event): string | undefined =>
  event.target instanceof HTMLInputElement ||
  event.target instanceof HTMLTextAreaElement
    ? event.target.value
    : undefined;

const numberInputValue = (event: Event): null | number | undefined => {
  const value = textInputValue(event);
  if (value === undefined) return undefined;
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const requiredNumberInputValue = (event: Event): number | undefined => {
  const value = numberInputValue(event);
  return value === null ? NaN : value;
};

@Injectable({ providedIn: 'root' })
export class PlatformEventDetailOperations {
  private readonly rpc = AppRpc.injectClient();

  eventFilter() {
    return this.rpc.queryFilter(['platform', 'events']);
  }

  findOne(targetTenantId: string, eventId: string) {
    return this.rpc.platform.events.findOne.queryOptions({
      eventId,
      targetTenantId,
    });
  }

  formOptions(targetTenantId: string) {
    return this.rpc.platform.events.formOptions.queryOptions({
      targetTenantId,
    });
  }

  review() {
    return this.rpc.platform.events.review.mutationOptions();
  }

  submitForReview() {
    return this.rpc.platform.events.submitForReview.mutationOptions();
  }

  tenant(targetTenantId: string) {
    return this.rpc.globalAdmin.tenants.findOne.queryOptions({
      id: targetTenantId,
    });
  }

  update() {
    return this.rpc.platform.events.update.mutationOptions();
  }

  updateListing() {
    return this.rpc.platform.events.updateListing.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    EventStatusComponent,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    PlatformTenantPageHeaderComponent,
    RouterLink,
  ],
  selector: 'app-platform-event-detail',
  templateUrl: './platform-event-detail.component.html',
})
export class PlatformEventDetailComponent {
  readonly eventId = input.required<string>();
  readonly tenantId = input.required<string>();

  protected readonly actionReason = signal('');
  protected readonly addOnAvailabilityIssue =
    platformEventAddOnAvailabilityIssue;
  protected readonly addOnMappingIssue = platformEventAddOnMappingIssue;
  protected readonly addOnStockIssue = platformEventAddOnStockIssue;
  protected readonly currencyAmountErrors = signal<ReadonlyMap<string, string>>(
    new Map(),
  );
  private readonly operations = inject(PlatformEventDetailOperations);
  protected readonly formOptionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  private readonly editModel = signal<PlatformEventEditFormModel>({
    description: '',
    end: '',
    reason: '',
    start: '',
    title: '',
  });
  protected readonly editForm = form(this.editModel, (event) => {
    validate(event.title, ({ value }) =>
      value().trim()
        ? undefined
        : { kind: 'required', message: 'Enter an event title.' },
    );
    validate(event.description, ({ value }) =>
      value().trim()
        ? undefined
        : { kind: 'required', message: 'Enter an event description.' },
    );
    required(event.start, { message: 'Enter a start date and time.' });
    required(event.end, { message: 'Enter an end date and time.' });
    validate(event.end, ({ value, valueOf }) => {
      if (!this.formOptionsQuery.isSuccess()) return;
      return platformEventLocalDateTimeRangeHasValidOrder(
        valueOf(event.start),
        value(),
        this.formOptionsQuery.data().timezone,
      ) === false
        ? {
            kind: 'dateOrder',
            message: 'The event must end after it starts.',
          }
        : undefined;
    });
    validate(event.reason, ({ value }) =>
      value().trim()
        ? undefined
        : { kind: 'required', message: 'Enter an operational reason.' },
    );
    maxLength(event.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });
  protected readonly eventEditorIsReadOnly = platformEventEditorIsReadOnly;
  protected readonly eventQuery = injectQuery(() =>
    this.operations.findOne(this.tenantId(), this.eventId()),
  );
  protected readonly formOptionsReady = computed(
    () =>
      this.formOptionsQuery.isSuccess() && !this.formOptionsQuery.isFetching(),
  );
  protected readonly graphModel = signal<PlatformEventGraphEditModel>({
    addOns: [],
    questions: [],
    registrationOptions: [],
  });
  private readonly availableTaxRateIds = computed(
    () =>
      new Set(
        this.formOptionsQuery
          .data()
          ?.taxRates.map((rate) => rate.stripeTaxRateId),
      ),
  );
  protected readonly graphHasIssues = computed(
    () =>
      this.formOptionsReady() &&
      platformEventGraphHasIssues(this.graphModel(), {
        esnCardEnabled: this.formOptionsQuery.data()?.esnCardEnabled === true,
        taxRateIds: this.availableTaxRateIds(),
      }),
  );
  protected readonly hasInvalidRegistrationWindowOrder = computed(() =>
    this.graphModel().registrationOptions.some(
      (option) => !platformEventRegistrationWindowHasValidOrder(option),
    ),
  );
  protected readonly integerIssue = platformEventIntegerIssue;
  protected readonly invalidRegistrationWindowFields = signal<
    ReadonlySet<string>
  >(new Set());
  protected readonly listingMutation = injectMutation(() =>
    this.operations.updateListing(),
  );
  protected readonly minorUnitsToMajorCurrencyInput =
    minorUnitsToMajorCurrencyInput;
  protected readonly registrationOptionIds = computed(
    () =>
      new Set(this.graphModel().registrationOptions.map((option) => option.id)),
  );
  protected readonly reviewFeedback = signal('');
  protected readonly reviewMutation = injectMutation(() =>
    this.operations.review(),
  );
  protected readonly simpleModeIssue = computed(() =>
    platformEventSimpleModeIssue(
      this.eventQuery.data()?.simpleModeEnabled ?? false,
      this.graphModel().registrationOptions,
    ),
  );
  protected readonly targetTenantQuery = injectQuery(() =>
    this.operations.tenant(this.tenantId()),
  );
  protected readonly stripeConnected = computed(
    () =>
      this.targetTenantQuery.isSuccess() &&
      this.targetTenantQuery.data()?.stripeConnected === true,
  );
  protected readonly stripeDisconnected = computed(
    () =>
      this.targetTenantQuery.isSuccess() &&
      this.targetTenantQuery.data()?.stripeConnected === false,
  );
  protected readonly submitMutation = injectMutation(() =>
    this.operations.submitForReview(),
  );
  protected readonly targetTenantCurrency = computed(() =>
    this.targetTenantQuery.isSuccess()
      ? (this.targetTenantQuery.data()?.currency ?? '')
      : '',
  );
  protected readonly titleIssue = platformEventTitleIssue;
  protected readonly unsupportedRegistrationOptions = computed(() =>
    unsupportedPlatformEventRegistrationOptions(
      this.graphModel().registrationOptions,
    ),
  );
  protected readonly updateMutation = injectMutation(() =>
    this.operations.update(),
  );
  private readonly initializedEventKey = signal<null | string>(null);
  private readonly notifications = inject(NotificationService);

  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      if (!this.eventQuery.isSuccess() || !this.formOptionsReady()) {
        return;
      }
      const event = this.eventQuery.data();
      const formOptions = this.formOptionsQuery.data();
      if (!formOptions) return;
      const eventKey = `${this.tenantId()}:${event.id}`;
      if (this.initializedEventKey() === eventKey) return;
      const timezone = formOptions.timezone;
      untracked(() => {
        this.actionReason.set('');
        this.reviewFeedback.set('');
        this.editModel.set({
          description: event.description,
          end: platformEventInstantToLocalDateTime(event.end, timezone),
          reason: '',
          start: platformEventInstantToLocalDateTime(event.start, timezone),
          title: event.title,
        });
        const graph: PlatformEventGraphEditModel = {
          addOns: event.addOns.map((addOn) => ({
            ...addOn,
            registrationOptions: addOn.registrationOptions.map((option) => ({
              ...option,
            })),
          })),
          questions: event.questions.map((question) => ({ ...question })),
          registrationOptions: event.registrationOptions.map((option) => ({
            ...option,
            roleIds: [...option.roleIds],
          })),
        };
        this.graphModel.set(
          this.stripeDisconnected()
            ? resetPlatformEventGraphPayments(graph)
            : graph,
        );
        this.invalidRegistrationWindowFields.set(new Set());
        this.currencyAmountErrors.set(new Map());
        this.editForm().reset();
        this.initializedEventKey.set(eventKey);
      });
    });
    effect(() => {
      if (!this.stripeDisconnected()) return;
      const graph = this.graphModel();
      const resetGraph = resetPlatformEventGraphPayments(graph);
      if (resetGraph === graph) return;
      untracked(() => {
        this.graphModel.set(resetGraph);
        this.currencyAmountErrors.set(new Map());
      });
    });
  }

  protected addAddOn(): void {
    this.graphModel.update((graph) => ({
      ...graph,
      addOns: [
        ...graph.addOns,
        {
          allowMultiple: false,
          allowPurchaseBeforeEvent: false,
          allowPurchaseDuringEvent: false,
          allowPurchaseDuringRegistration: true,
          description: null,
          isPaid: false,
          maxQuantityPerUser: 1,
          price: 0,
          registrationOptions: [],
          stripeTaxRateId: null,
          title: 'New add-on',
          totalAvailableQuantity: 1,
        },
      ],
    }));
  }

  protected addonOptionalPurchaseQuantity(
    addOn: PlatformEventAddonEdit,
    registrationOptionId: string,
  ): number {
    return (
      addOn.registrationOptions.find(
        (option) => option.registrationOptionId === registrationOptionId,
      )?.optionalPurchaseQuantity ?? 0
    );
  }

  protected addOnPriceError(index: number): null | string {
    const parseError = this.currencyAmountErrors().get(`addOn:${index}:price`);
    if (parseError) return parseError;
    const addOn = this.graphModel().addOns[index];
    return addOn
      ? platformEventPaidAddOnPriceIssue(addOn.isPaid, addOn.price)
      : null;
  }

  protected addonQuantity(
    addOn: PlatformEventAddonEdit,
    registrationOptionId: string,
  ): null | number {
    return (
      addOn.registrationOptions.find(
        (option) => option.registrationOptionId === registrationOptionId,
      )?.includedQuantity ?? null
    );
  }

  protected addQuestion(): void {
    const registrationOptionId = this.graphModel().registrationOptions[0]?.id;
    if (!registrationOptionId) return;
    this.graphModel.update((graph) => ({
      ...graph,
      questions: [
        ...graph.questions,
        {
          description: null,
          registrationOptionId,
          required: false,
          sortOrder: graph.questions.length,
          title: 'New question',
        },
      ],
    }));
  }

  protected approve(): void {
    this.review(true);
  }

  protected changeListing(unlisted: boolean): void {
    const reason = this.actionReason().trim();
    if (!reason || this.mutationPending()) return;
    void (async () => {
      try {
        await this.listingMutation.mutateAsync({
          eventId: this.eventId(),
          reason,
          targetTenantId: this.tenantId(),
          unlisted,
        });
        await this.refresh();
        this.actionReason.set('');
        this.notifications.showSuccess('Event listing updated');
      } catch {
        this.notifications.showError(
          'The event listing could not be updated. Try again.',
        );
      }
    })();
  }

  protected displayDateTime(value: string): string {
    return this.formOptionsQuery.isSuccess()
      ? platformEventInstantToDisplayDateTime(
          value,
          this.formOptionsQuery.data().timezone,
        )
      : '';
  }

  protected localDateTime(value: string): string {
    return this.formOptionsQuery.isSuccess()
      ? platformEventInstantToLocalDateTime(
          value,
          this.formOptionsQuery.data().timezone,
        )
      : '';
  }

  protected mutationPending(): boolean {
    return (
      this.listingMutation.isPending() ||
      this.reviewMutation.isPending() ||
      this.submitMutation.isPending() ||
      this.updateMutation.isPending()
    );
  }

  protected optionPriceError(
    index: number,
    field: 'esnCardDiscountedPrice' | 'price',
  ): null | string {
    const parseError = this.currencyAmountErrors().get(
      `option:${index}:${field}`,
    );
    if (parseError) return parseError;
    const option = this.graphModel().registrationOptions[index];
    if (!option) return null;
    return field === 'esnCardDiscountedPrice'
      ? platformEventDiscountedPriceIssue(
          option.isPaid,
          option.price,
          option.esnCardDiscountedPrice,
          this.formOptionsQuery.data()?.esnCardEnabled ?? true,
        )
      : platformEventPaidRegistrationPriceIssue(option.isPaid, option.price);
  }

  protected paidTaxRateIssue(
    isPaid: boolean,
    stripeTaxRateId: null | string,
  ): null | string {
    return this.formOptionsReady()
      ? platformEventPaidTaxRateIssue(
          isPaid,
          stripeTaxRateId,
          this.availableTaxRateIds(),
        )
      : null;
  }

  protected questionOptionIssue(registrationOptionId: string): null | string {
    return platformEventQuestionOptionIssue(
      registrationOptionId,
      this.registrationOptionIds(),
    );
  }

  protected registrationWindowFieldInvalid(
    index: number,
    field: PlatformEventRegistrationWindowField,
  ): boolean {
    return this.invalidRegistrationWindowFields().has(`${index}:${field}`);
  }

  protected registrationWindowOrderInvalid(
    option: PlatformEventRegistrationOptionEdit,
  ): boolean {
    return !platformEventRegistrationWindowHasValidOrder(option);
  }

  protected removeAddOn(index: number): void {
    this.clearCurrencyAmountErrors('addOn:');
    this.graphModel.update((graph) => ({
      ...graph,
      addOns: graph.addOns.filter((_, candidate) => candidate !== index),
    }));
  }

  protected removeQuestion(index: number): void {
    this.graphModel.update((graph) => ({
      ...graph,
      questions: graph.questions.filter((_, candidate) => candidate !== index),
    }));
  }

  protected returnToDraft(): void {
    this.review(false);
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (
      this.mutationPending() ||
      !this.eventQuery.isSuccess() ||
      !this.formOptionsReady() ||
      this.currencyAmountErrors().size > 0 ||
      this.graphHasIssues() ||
      this.invalidRegistrationWindowFields().size > 0 ||
      this.hasInvalidRegistrationWindowOrder() ||
      this.simpleModeIssue() !== null ||
      this.unsupportedRegistrationOptions().length > 0
    ) {
      return;
    }
    const current = this.eventQuery.data();
    if (!current || platformEventEditorIsReadOnly(current.status)) return;
    void submit(this.editForm, async () => {
      if (!this.formOptionsReady()) return;
      const formOptions = this.formOptionsQuery.data();
      if (!formOptions) return;
      const timezone = formOptions.timezone;
      const value = this.editModel();
      const end = platformEventLocalDateTimeToInstant(value.end, timezone);
      const start = platformEventLocalDateTimeToInstant(value.start, timezone);
      if (!end || !start) {
        this.notifications.showError(
          "Enter valid event times in the organization's time zone, including daylight-saving transitions.",
        );
        return;
      }
      const graph = this.stripeDisconnected()
        ? resetPlatformEventGraphPayments(this.graphModel())
        : this.graphModel();
      const registrationOptions = writablePlatformEventRegistrationOptions(
        graph.registrationOptions,
      );
      if (!registrationOptions) return;
      try {
        await this.updateMutation.mutateAsync({
          addOns: graph.addOns,
          description: value.description,
          end,
          eventId: this.eventId(),
          icon: current.icon,
          location: current.location,
          questions: graph.questions,
          reason: value.reason,
          registrationOptions,
          start,
          targetTenantId: this.tenantId(),
          title: value.title,
        });
        await this.refresh();
        this.notifications.showSuccess('Event updated');
      } catch {
        this.notifications.showError(
          'The event could not be updated. Review the details and try again.',
        );
      }
    });
  }

  protected setActionReason(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.actionReason.set(event.target.value);
    }
  }

  protected setAddOnBoolean(
    index: number,
    field:
      | 'allowMultiple'
      | 'allowPurchaseBeforeEvent'
      | 'allowPurchaseDuringEvent'
      | 'allowPurchaseDuringRegistration'
      | 'isPaid',
    value: boolean,
  ): void {
    if (field === 'isPaid') {
      if (value && !this.stripeConnected()) return;
      if (!value) this.clearCurrencyAmountErrors(`addOn:${index}:`);
      this.updateAddOn(index, (addOn) =>
        value ? { ...addOn, isPaid: true } : resetAddOnPayment(addOn, null),
      );
      return;
    }
    this.updateAddOn(index, (addOn) => ({ ...addOn, [field]: value }));
  }

  protected setAddOnNumber(
    index: number,
    field: 'maxQuantityPerUser' | 'totalAvailableQuantity',
    event: Event,
  ): void {
    const value = requiredNumberInputValue(event);
    if (value === undefined) return;
    this.updateAddOn(index, (addOn) => ({ ...addOn, [field]: value }));
  }

  protected setAddOnOptionEnabled(
    index: number,
    registrationOptionId: string,
    enabled: boolean,
  ): void {
    this.updateAddOn(index, (addOn) => ({
      ...addOn,
      registrationOptions: enabled
        ? [
            ...addOn.registrationOptions,
            {
              includedQuantity: 1,
              optionalPurchaseQuantity: 0,
              registrationOptionId,
            },
          ]
        : addOn.registrationOptions.filter(
            (option) => option.registrationOptionId !== registrationOptionId,
          ),
    }));
  }

  protected setAddOnOptionOptionalQuantity(
    index: number,
    registrationOptionId: string,
    event: Event,
  ): void {
    const quantity = requiredNumberInputValue(event);
    if (quantity === undefined) return;
    this.updateAddOn(index, (addOn) => ({
      ...addOn,
      registrationOptions: addOn.registrationOptions.map((option) =>
        option.registrationOptionId === registrationOptionId
          ? { ...option, optionalPurchaseQuantity: quantity }
          : option,
      ),
    }));
  }

  protected setAddOnOptionQuantity(
    index: number,
    registrationOptionId: string,
    event: Event,
  ): void {
    const quantity = requiredNumberInputValue(event);
    if (quantity === undefined) return;
    this.updateAddOn(index, (addOn) => ({
      ...addOn,
      registrationOptions: addOn.registrationOptions.map((option) =>
        option.registrationOptionId === registrationOptionId
          ? { ...option, includedQuantity: quantity }
          : option,
      ),
    }));
  }

  protected setAddOnPrice(index: number, event: Event): void {
    if (!this.stripeConnected()) return;
    const value = this.currencyAmountInputValue(
      `addOn:${index}:price`,
      event,
      false,
    );
    if (typeof value !== 'number') return;
    this.updateAddOn(index, (addOn) => ({ ...addOn, price: value }));
  }

  protected setAddOnTaxRate(index: number, event: MatSelectChange): void {
    if (!this.stripeConnected()) return;
    const value: unknown = event.value;
    this.updateAddOn(index, (addOn) => ({
      ...addOn,
      stripeTaxRateId: typeof value === 'string' && value ? value : null,
    }));
  }

  protected setAddOnText(
    index: number,
    field: 'description' | 'stripeTaxRateId' | 'title',
    event: Event,
  ): void {
    const value = textInputValue(event);
    if (value === undefined) return;
    if (field === 'stripeTaxRateId' && !this.stripeConnected()) return;
    this.updateAddOn(index, (addOn) => {
      if (field === 'description') {
        return { ...addOn, description: value || null };
      }
      if (field === 'stripeTaxRateId') {
        return { ...addOn, stripeTaxRateId: value || null };
      }
      return { ...addOn, title: value };
    });
  }

  protected setOptionBoolean(
    index: number,
    field: 'isPaid' | 'organizingRegistration',
    value: boolean,
  ): void {
    if (field === 'isPaid') {
      if (value && !this.stripeConnected()) return;
      if (!value) this.clearCurrencyAmountErrors(`option:${index}:`);
      this.updateRegistrationOption(index, (option) =>
        value
          ? { ...option, isPaid: true }
          : resetRegistrationPayment(option, null, null),
      );
      return;
    }
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      organizingRegistration: value,
    }));
  }

  protected setOptionDate(
    index: number,
    field: PlatformEventRegistrationWindowField,
    event: Event,
  ): void {
    const value = textInputValue(event);
    const fieldKey = `${index}:${field}`;
    const formOptions = this.formOptionsQuery.data();
    const instant =
      value && this.formOptionsReady() && formOptions
        ? platformEventLocalDateTimeToInstant(value, formOptions.timezone)
        : null;
    if (!instant) {
      this.invalidRegistrationWindowFields.update(
        (fields) => new Set([...fields, fieldKey]),
      );
      return;
    }
    this.invalidRegistrationWindowFields.update((fields) => {
      if (!fields.has(fieldKey)) return fields;
      const next = new Set(fields);
      next.delete(fieldKey);
      return next;
    });
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      [field]: instant,
    }));
  }

  protected setOptionMode(index: number, event: MatSelectChange): void {
    const value: unknown = event.value;
    if (value !== 'application' && value !== 'fcfs') {
      return;
    }
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      registrationMode: value,
    }));
  }

  protected setOptionNumber(
    index: number,
    field:
      | 'cancellationDeadlineHoursBeforeStart'
      | 'spots'
      | 'transferDeadlineHoursBeforeStart',
    event: Event,
  ): void {
    if (field === 'spots') {
      const value = requiredNumberInputValue(event);
      if (value === undefined) return;
      this.updateRegistrationOption(index, (option) => ({
        ...option,
        spots: value,
      }));
      return;
    }

    const value = numberInputValue(event);
    if (value === undefined) return;
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      [field]: value,
    }));
  }

  protected setOptionPrice(
    index: number,
    field: 'esnCardDiscountedPrice' | 'price',
    event: Event,
  ): void {
    if (!this.stripeConnected()) return;
    const value = this.currencyAmountInputValue(
      `option:${index}:${field}`,
      event,
      field === 'esnCardDiscountedPrice',
    );
    if (value === undefined) return;
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      [field]: value === '' ? null : value,
    }));
  }

  protected setOptionRefundPolicy(index: number, event: MatSelectChange): void {
    const value: unknown = event.value;
    const refundFeesOnCancellation =
      value === 'include' ? true : value === 'exclude' ? false : null;
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      refundFeesOnCancellation,
    }));
  }

  protected setOptionRole(
    index: number,
    roleId: string,
    enabled: boolean,
  ): void {
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      roleIds: enabled
        ? [...new Set([...option.roleIds, roleId])]
        : option.roleIds.filter((candidate) => candidate !== roleId),
    }));
  }

  protected setOptionTaxRate(index: number, event: MatSelectChange): void {
    if (!this.stripeConnected()) return;
    const value: unknown = event.value;
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      stripeTaxRateId: typeof value === 'string' && value ? value : null,
    }));
  }

  protected setOptionText(
    index: number,
    field:
      'description' | 'registeredDescription' | 'stripeTaxRateId' | 'title',
    event: Event,
  ): void {
    const value = textInputValue(event);
    if (value === undefined) return;
    if (field === 'stripeTaxRateId' && !this.stripeConnected()) return;
    this.updateRegistrationOption(index, (option) => {
      if (field === 'title') return { ...option, title: value };
      return { ...option, [field]: value || null };
    });
  }

  protected setQuestionBoolean(index: number, required: boolean): void {
    this.updateQuestion(index, (question) => ({ ...question, required }));
  }

  protected setQuestionNumber(index: number, event: Event): void {
    const sortOrder = requiredNumberInputValue(event);
    if (sortOrder === undefined) return;
    this.updateQuestion(index, (question) => ({ ...question, sortOrder }));
  }

  protected setQuestionOption(index: number, event: MatSelectChange): void {
    const registrationOptionId: unknown = event.value;
    if (typeof registrationOptionId !== 'string' || !registrationOptionId) {
      return;
    }
    this.updateQuestion(index, (question) => ({
      ...question,
      registrationOptionId,
    }));
  }

  protected setQuestionText(
    index: number,
    field: 'description' | 'title',
    event: Event,
  ): void {
    const value = textInputValue(event);
    if (value === undefined) return;
    this.updateQuestion(index, (question) =>
      field === 'title'
        ? { ...question, title: value }
        : { ...question, description: value || null },
    );
  }

  protected setReviewFeedback(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) {
      this.reviewFeedback.set(event.target.value);
    }
  }

  protected submitForReview(): void {
    const reason = this.actionReason().trim();
    if (!reason || this.mutationPending()) return;
    void (async () => {
      try {
        await this.submitMutation.mutateAsync({
          eventId: this.eventId(),
          reason,
          targetTenantId: this.tenantId(),
        });
        await this.refresh();
        this.actionReason.set('');
        this.notifications.showSuccess('Event submitted for review');
      } catch {
        this.notifications.showError(
          'The event could not be submitted for review. Try again.',
        );
      }
    })();
  }

  private clearCurrencyAmountErrors(prefix: string): void {
    this.currencyAmountErrors.update((current) => {
      const next = new Map(
        [...current].filter(([key]) => !key.startsWith(prefix)),
      );
      return next.size === current.size ? current : next;
    });
  }

  private currencyAmountInputValue(
    key: string,
    event: Event,
    allowEmpty: boolean,
  ): '' | number | undefined {
    const rawValue = textInputValue(event);
    if (rawValue === undefined) return undefined;
    const result = majorCurrencyInputToMinorUnits(rawValue, allowEmpty);
    if ('error' in result) {
      this.currencyAmountErrors.update((current) => {
        const next = new Map(current);
        next.set(key, result.error.message);
        return next;
      });
      return undefined;
    }

    this.currencyAmountErrors.update((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    return result.value;
  }

  private async refresh(): Promise<void> {
    await this.queryClient.invalidateQueries(this.operations.eventFilter());
    await this.eventQuery.refetch();
  }

  private review(approved: boolean): void {
    const reason = this.actionReason().trim();
    const comment = this.reviewFeedback().trim();
    if (!reason || (!approved && !comment) || this.mutationPending()) return;
    void (async () => {
      try {
        await this.reviewMutation.mutateAsync({
          approved,
          comment: comment || undefined,
          eventId: this.eventId(),
          reason,
          targetTenantId: this.tenantId(),
        });
        await this.refresh();
        this.actionReason.set('');
        this.reviewFeedback.set('');
        this.notifications.showSuccess(
          approved ? 'Event approved' : 'Event returned to draft',
        );
      } catch {
        this.notifications.showError(
          'The event review could not be saved. Try again.',
        );
      }
    })();
  }

  private updateAddOn(
    index: number,
    update: (addOn: PlatformEventAddonEdit) => PlatformEventAddonEdit,
  ): void {
    this.graphModel.update((graph) => ({
      ...graph,
      addOns: graph.addOns.map((addOn, candidate) =>
        candidate === index ? update(addOn) : addOn,
      ),
    }));
  }

  private updateQuestion(
    index: number,
    update: (question: PlatformEventQuestionEdit) => PlatformEventQuestionEdit,
  ): void {
    this.graphModel.update((graph) => ({
      ...graph,
      questions: graph.questions.map((question, candidate) =>
        candidate === index ? update(question) : question,
      ),
    }));
  }

  private updateRegistrationOption(
    index: number,
    update: (
      option: PlatformEventRegistrationOptionEdit,
    ) => PlatformEventRegistrationOptionEdit,
  ): void {
    this.graphModel.update((graph) => ({
      ...graph,
      registrationOptions: graph.registrationOptions.map((option, candidate) =>
        candidate === index ? update(option) : option,
      ),
    }));
  }
}
