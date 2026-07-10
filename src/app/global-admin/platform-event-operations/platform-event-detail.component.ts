import { DatePipe } from '@angular/common';
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
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';

interface PlatformEventAddonEdit {
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

interface PlatformEventEditFormModel {
  description: string;
  end: string;
  reason: string;
  start: string;
  title: string;
}

interface PlatformEventGraphEditModel {
  addOns: PlatformEventAddonEdit[];
  questions: PlatformEventQuestionEdit[];
  registrationOptions: PlatformEventRegistrationOptionEdit[];
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

interface PlatformEventRegistrationOptionEdit extends Omit<
  PlatformEventRegistrationOption,
  'roleIds'
> {
  roleIds: string[];
}

const localDateTimeValue = (value: string): string => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
    DatePipe,
    FormField,
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
  private readonly editModel = signal<PlatformEventEditFormModel>({
    description: '',
    end: '',
    reason: '',
    start: '',
    title: '',
  });
  protected readonly editForm = form(this.editModel, (event) => {
    required(event.title, { message: 'Enter an event title.' });
    required(event.description, { message: 'Enter an event description.' });
    required(event.start, { message: 'Enter a start date and time.' });
    required(event.end, { message: 'Enter an end date and time.' });
    required(event.reason, { message: 'Enter an operational reason.' });
    maxLength(event.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });
  private readonly operations = inject(PlatformEventDetailOperations);
  protected readonly eventQuery = injectQuery(() =>
    this.operations.findOne(this.tenantId(), this.eventId()),
  );
  protected readonly formOptionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  protected readonly graphModel = signal<PlatformEventGraphEditModel>({
    addOns: [],
    questions: [],
    registrationOptions: [],
  });
  protected readonly listingMutation = injectMutation(() =>
    this.operations.updateListing(),
  );
  protected readonly localDateTime = localDateTimeValue;
  protected readonly reviewFeedback = signal('');
  protected readonly reviewMutation = injectMutation(() =>
    this.operations.review(),
  );
  protected readonly submitMutation = injectMutation(() =>
    this.operations.submitForReview(),
  );
  protected readonly unsupportedRegistrationOptions = computed(() =>
    unsupportedPlatformEventRegistrationOptions(
      this.graphModel().registrationOptions,
    ),
  );
  protected readonly updateMutation = injectMutation(() =>
    this.operations.update(),
  );
  private readonly initializedEventId = signal<null | string>(null);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      if (!this.eventQuery.isSuccess()) return;
      const event = this.eventQuery.data();
      if (this.initializedEventId() === event.id) return;
      untracked(() => {
        this.editModel.set({
          description: event.description,
          end: localDateTimeValue(event.end),
          reason: '',
          start: localDateTimeValue(event.start),
          title: event.title,
        });
        this.graphModel.set({
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
        });
        this.editForm().reset();
        this.initializedEventId.set(event.id);
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
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to update event listing'),
        );
      }
    })();
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to load the target-tenant event');
  }

  protected mutationPending(): boolean {
    return (
      this.listingMutation.isPending() ||
      this.reviewMutation.isPending() ||
      this.submitMutation.isPending() ||
      this.updateMutation.isPending()
    );
  }

  protected removeAddOn(index: number): void {
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
      this.unsupportedRegistrationOptions().length > 0
    ) {
      return;
    }
    const current = this.eventQuery.data();
    if (!current) return;

    void submit(this.editForm, async () => {
      const value = this.editModel();
      const graph = this.graphModel();
      const registrationOptions = writablePlatformEventRegistrationOptions(
        graph.registrationOptions,
      );
      if (!registrationOptions) return;
      try {
        await this.updateMutation.mutateAsync({
          addOns: graph.addOns,
          description: value.description,
          end: new Date(value.end).toISOString(),
          eventId: this.eventId(),
          icon: current.icon,
          location: current.location,
          questions: graph.questions,
          reason: value.reason,
          registrationOptions,
          start: new Date(value.start).toISOString(),
          targetTenantId: this.tenantId(),
          title: value.title,
        });
        await this.refresh();
        this.notifications.showSuccess('Event updated');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to update event'),
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
    this.updateAddOn(index, (addOn) => ({ ...addOn, [field]: value }));
  }

  protected setAddOnNumber(
    index: number,
    field: 'maxQuantityPerUser' | 'price' | 'totalAvailableQuantity',
    event: Event,
  ): void {
    const value = numberInputValue(event);
    if (value === null || value === undefined) return;
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
    const quantity = numberInputValue(event);
    if (quantity === null || quantity === undefined) return;
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
    const quantity = numberInputValue(event);
    if (quantity === null || quantity === undefined) return;
    this.updateAddOn(index, (addOn) => ({
      ...addOn,
      registrationOptions: addOn.registrationOptions.map((option) =>
        option.registrationOptionId === registrationOptionId
          ? { ...option, includedQuantity: quantity }
          : option,
      ),
    }));
  }

  protected setAddOnTaxRate(index: number, event: MatSelectChange): void {
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
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      [field]: value,
    }));
  }

  protected setOptionDate(
    index: number,
    field: 'closeRegistrationTime' | 'openRegistrationTime',
    event: Event,
  ): void {
    const value = textInputValue(event);
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      [field]: date.toISOString(),
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
      | 'esnCardDiscountedPrice'
      | 'price'
      | 'spots'
      | 'transferDeadlineHoursBeforeStart',
    event: Event,
  ): void {
    const value = numberInputValue(event);
    if (value === undefined) return;
    this.updateRegistrationOption(index, (option) => {
      if (field === 'price' || field === 'spots') {
        return value === null ? option : { ...option, [field]: value };
      }
      return { ...option, [field]: value };
    });
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

  protected setOptionRoleIds(index: number, event: Event): void {
    const value = textInputValue(event);
    if (value === undefined) return;
    this.updateRegistrationOption(index, (option) => ({
      ...option,
      roleIds: [
        ...new Set(
          value
            .split(',')
            .map((roleId) => roleId.trim())
            .filter(Boolean),
        ),
      ],
    }));
  }

  protected setOptionTaxRate(index: number, event: MatSelectChange): void {
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
    this.updateRegistrationOption(index, (option) => {
      if (field === 'title') return { ...option, title: value };
      return { ...option, [field]: value || null };
    });
  }

  protected setQuestionBoolean(index: number, required: boolean): void {
    this.updateQuestion(index, (question) => ({ ...question, required }));
  }

  protected setQuestionNumber(index: number, event: Event): void {
    const sortOrder = numberInputValue(event);
    if (sortOrder === null || sortOrder === undefined) return;
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
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to submit event for review'),
        );
      }
    })();
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
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to review event'),
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
