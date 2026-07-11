import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { EventEditIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { resolveTenantRuntimeTimezone } from '../../core/tenant-runtime';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { persistedAdvancedToSimpleModeIssue } from '../../shared/components/forms/registration-mode-transition';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventAddonEditor } from './event-addon-editor';
import {
  advancedEventGraphWarnings,
  createEmptyEventGraphFormModel,
  createEventGraphAddon,
  createEventGraphQuestion,
  createEventGraphRegistrationOption,
  type EventGraphFormModel,
  eventGraphFormToPayload,
  eventGraphRecordToFormModel,
  simpleEventGraphIssue,
} from './event-graph-form.model';
import { eventGraphFormSchema } from './event-graph-form.schema';
import {
  EventRegistrationModeDialog,
  type EventRegistrationModeDialogData,
} from './event-registration-mode-dialog';
import { EventRegistrationOptionEditor } from './event-registration-option-editor';

export const eventEditSubmitDisabled = ({
  formInvalid,
  formSubmitting,
  graphReadOnly,
  mutationPending,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  graphReadOnly: boolean;
  mutationPending: boolean;
}): boolean =>
  formInvalid || formSubmitting || graphReadOnly || mutationPending;

export const eventOptionRemovalBlockReason = (
  model: Pick<EventGraphFormModel, 'addOns' | 'questions'>,
  optionKey: string,
): null | string => {
  if (
    model.questions.some(
      (question) => question.registrationOptionKey === optionKey,
    )
  ) {
    return 'Move or remove the questions attached to this option first.';
  }
  if (
    model.addOns.some((addOn) =>
      addOn.registrationOptions.some(
        (mapping) => mapping.registrationOptionKey === optionKey,
      ),
    )
  ) {
    return 'Remove this option from its add-on mappings first.';
  }
  return null;
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventAddonEditor,
    EventRegistrationOptionEditor,
    EditorComponent,
    FontAwesomeModule,
    FormField,
    IconSelectorFieldComponent,
    IfAnyPermissionDirective,
    LocationSelectorField,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    MatTimepickerModule,
    RouterLink,
  ],
  selector: 'app-event-edit',
  templateUrl: './event-edit.html',
})
export class EventEdit {
  readonly eventId = input.required<string>();

  private readonly config = inject(ConfigService);
  private readonly tenantTimezone = resolveTenantRuntimeTimezone(
    this.config.tenantSignal()?.timezone,
  );
  protected readonly eventModel = signal<EventGraphFormModel>(
    createEmptyEventGraphFormModel(this.tenantTimezone),
  );
  protected readonly advancedWarnings = computed(() =>
    this.eventModel().simpleModeEnabled
      ? []
      : advancedEventGraphWarnings(this.eventModel().registrationOptions),
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );

  protected readonly esnEnabled = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return false;
    return this.discountProvidersQuery
      .data()
      .some(
        (provider) =>
          provider.type === 'esnCard' && provider.status === 'enabled',
      );
  });
  protected readonly eventEditSubmitDisabled = eventEditSubmitDisabled;
  protected readonly eventForm = form(this.eventModel, eventGraphFormSchema);
  protected readonly eventQuery = injectQuery(() =>
    this.rpc.events.findGraphForEdit.queryOptions({ id: this.eventId() }),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly graphActionMessage = signal<null | string>(null);
  protected readonly iconUsage = computed(() =>
    EventEditIconUsage.make({ eventId: this.eventId() }),
  );
  protected readonly loadBlock = signal<null | string>(null);
  protected readonly modeControlsInteractive = signal(false);
  protected readonly optionChoices = computed(() =>
    this.eventModel().registrationOptions.map((option) => ({
      key: option.key,
      title: option.title,
    })),
  );
  protected readonly saveError = signal<null | string>(null);
  protected readonly simpleModeIssue = computed(() =>
    simpleEventGraphIssue(this.eventModel().registrationOptions),
  );
  protected readonly updateEventMutation = injectMutation(() =>
    this.rpc.events.updateGraph.mutationOptions(),
  );

  private readonly dialog = inject(MatDialog);
  private readonly initializedEventId = signal<null | string>(null);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);
  constructor() {
    afterNextRender(() => this.modeControlsInteractive.set(true));

    effect(() => {
      if (!this.eventQuery.isSuccess()) return;
      const event = this.eventQuery.data();
      if (this.initializedEventId() === event.id) return;
      const loadResult = eventGraphRecordToFormModel(
        event,
        this.tenantTimezone,
      );
      untracked(() => {
        if ('error' in loadResult) {
          this.loadBlock.set(loadResult.error);
          this.initializedEventId.set(event.id);
          return;
        }
        this.eventModel.set(loadResult.model);
        this.eventForm().reset();
        this.loadBlock.set(null);
        this.initializedEventId.set(event.id);
      });
    });
  }

  protected addAddOn(): void {
    if (this.eventModel().simpleModeEnabled) return;
    const optionKey = this.eventModel().registrationOptions[0]?.key;
    this.eventModel.update((model) => ({
      ...model,
      addOns: [...model.addOns, createEventGraphAddon(optionKey)],
    }));
  }

  protected addAddOnMapping(addOnIndex: number): void {
    this.eventModel.update((model) => {
      const addOn = model.addOns[addOnIndex];
      if (!addOn) return model;
      const mappedKeys = new Set(
        addOn.registrationOptions.map(
          (mapping) => mapping.registrationOptionKey,
        ),
      );
      const optionKey = model.registrationOptions.find(
        (option) => !mappedKeys.has(option.key),
      )?.key;
      if (!optionKey) return model;
      return {
        ...model,
        addOns: model.addOns.map((candidate, index) =>
          index === addOnIndex
            ? {
                ...candidate,
                registrationOptions: [
                  ...candidate.registrationOptions,
                  {
                    includedQuantity: 0,
                    optionalPurchaseQuantity: 1,
                    registrationOptionKey: optionKey,
                  },
                ],
              }
            : candidate,
        ),
      };
    });
  }

  protected addQuestion(): void {
    const optionKey = this.eventModel().registrationOptions[0]?.key;
    if (!optionKey) return;
    this.eventModel.update((model) => ({
      ...model,
      questions: [
        ...model.questions,
        createEventGraphQuestion(optionKey, model.questions.length),
      ],
    }));
  }

  protected addRegistrationOption(): void {
    if (this.eventModel().simpleModeEnabled) return;
    this.graphActionMessage.set(null);
    this.eventModel.update((model) => ({
      ...model,
      registrationOptions: [
        ...model.registrationOptions,
        createEventGraphRegistrationOption(model),
      ],
    }));
  }

  protected duplicateQuestion(questionIndex: number): void {
    this.eventModel.update((model) => {
      const source = model.questions[questionIndex];
      if (!source) return model;
      return {
        ...model,
        questions: [
          ...model.questions,
          {
            ...source,
            id: '',
            key: globalThis.crypto.randomUUID(),
            sortOrder: model.questions.length,
          },
        ],
      };
    });
  }

  protected queryErrorMessage(): string {
    return getErrorMessage(
      this.eventQuery.error(),
      'Failed to load the event editor.',
    );
  }

  protected removeAddOn(addOnIndex: number): void {
    this.eventModel.update((model) => ({
      ...model,
      addOns: model.addOns.filter((_, index) => index !== addOnIndex),
    }));
  }

  protected removeAddOnMapping(addOnIndex: number, mappingIndex: number): void {
    this.eventModel.update((model) => ({
      ...model,
      addOns: model.addOns.map((addOn, index) =>
        index === addOnIndex
          ? {
              ...addOn,
              registrationOptions: addOn.registrationOptions.filter(
                (_, candidate) => candidate !== mappingIndex,
              ),
            }
          : addOn,
      ),
    }));
  }

  protected removeQuestion(questionIndex: number): void {
    this.eventModel.update((model) => ({
      ...model,
      questions: model.questions.filter((_, index) => index !== questionIndex),
    }));
  }

  protected removeRegistrationOption(optionKey: string): void {
    if (this.eventModel().simpleModeEnabled) return;
    const model = this.eventModel();
    const blockReason = eventOptionRemovalBlockReason(model, optionKey);
    if (blockReason) {
      this.graphActionMessage.set(blockReason);
      return;
    }
    this.graphActionMessage.set(null);
    this.eventModel.update((current) => ({
      ...current,
      registrationOptions: current.registrationOptions.filter(
        (option) => option.key !== optionKey,
      ),
    }));
  }

  protected async requestModeChange(simpleModeEnabled: boolean): Promise<void> {
    const model = this.eventModel();
    if (
      !this.modeControlsInteractive() ||
      model.simpleModeEnabled === simpleModeEnabled ||
      this.loadBlock()
    ) {
      return;
    }
    this.graphActionMessage.set(null);
    if (simpleModeEnabled) {
      const issue = simpleEventGraphIssue(model.registrationOptions);
      if (issue) {
        this.graphActionMessage.set(issue);
        return;
      }

      const persistedTransitionIssue = this.eventQuery.isSuccess()
        ? persistedAdvancedToSimpleModeIssue(
            this.eventQuery.data(),
            model.registrationOptions,
          )
        : null;
      if (persistedTransitionIssue) {
        this.graphActionMessage.set(persistedTransitionIssue);
        return;
      }
    }

    const dialogReference = this.dialog.open<
      EventRegistrationModeDialog,
      EventRegistrationModeDialogData,
      boolean
    >(EventRegistrationModeDialog, {
      data: {
        from: model.simpleModeEnabled ? 'simple' : 'advanced',
        to: simpleModeEnabled ? 'simple' : 'advanced',
      },
      maxWidth: '36rem',
    });
    const confirmed = await firstValueFrom(dialogReference.afterClosed());
    if (!confirmed) return;
    this.eventModel.update((current) => ({
      ...current,
      simpleModeEnabled,
    }));
  }

  protected async saveEvent(event: Event): Promise<void> {
    event.preventDefault();
    this.saveError.set(null);
    if (
      eventEditSubmitDisabled({
        formInvalid: this.eventForm().invalid(),
        formSubmitting: this.eventForm().submitting(),
        graphReadOnly: this.loadBlock() !== null,
        mutationPending: this.updateEventMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.eventForm, async (formState) => {
      const payloadResult = eventGraphFormToPayload(
        formState().value(),
        this.esnEnabled(),
      );
      if ('error' in payloadResult) {
        this.saveError.set(payloadResult.error);
        return;
      }
      try {
        const result = await this.updateEventMutation.mutateAsync({
          eventId: this.eventId(),
          ...payloadResult.payload,
        });
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['events']),
        );
        await this.router.navigate(['/events', result.id]);
      } catch (error) {
        this.saveError.set(
          getErrorMessage(error, 'Failed to save the event configuration.'),
        );
      }
    });
  }
}
