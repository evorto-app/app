import type { IconRecord } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import type {
  PlatformTemplatesCreateInput,
  PlatformTemplatesUpdateInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import type {
  PlatformRoleRecord,
  PlatformStripeTaxRateRecord,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';
import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import type { IconValue } from '@shared/types/icon';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  apply,
  applyEach,
  disabled,
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faPlus, faTrashCan } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import type { EventLocationType } from '../../../types/location';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { CurrencyAmountInputComponent } from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { persistedAdvancedToSimpleModeIssue } from '../../shared/components/forms/registration-mode-transition';
import {
  templateGraphAddonFormSchema,
  templateGraphQuestionFormSchema,
} from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form.schema';
import {
  isSimpleCompatibleRegistrationOptions,
  templateGraphFormToPayload,
  templateGraphLocationFormModelToValue,
  templateGraphLocationValueToFormModel,
  templateGraphRecordToFormModel,
} from '../../shared/components/forms/template-graph-editor/template-graph-form.mapper';
import {
  createTemplateGraphAddonFormModel,
  createTemplateGraphFormModel,
  createTemplateGraphQuestionFormModel,
  createTemplateGraphRegistrationOptionFormModel,
  resetTemplateGraphPayments,
  type TemplateGraphFormModel,
} from '../../shared/components/forms/template-graph-editor/template-graph-form.model';
import { templateGraphRegistrationOptionFormSchema } from '../../shared/components/forms/template-graph-editor/template-graph-registration-option-form.schema';
import {
  type TemplateConfigurationMode,
  type TemplateModeConfirmationData,
  TemplateModeConfirmationDialogComponent,
} from '../../shared/components/forms/template-graph-editor/template-mode-confirmation-dialog.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';

export type PlatformTemplateFormLoadResult =
  { error: string } | { model: PlatformTemplateFormModel };

export interface PlatformTemplateFormModel extends TemplateGraphFormModel {
  reason: string;
}

export const createPlatformTemplateFormModel =
  (): PlatformTemplateFormModel => ({
    ...createTemplateGraphFormModel(),
    reason: '',
  });

export const createPlatformTemplateAddonFormModel =
  createTemplateGraphAddonFormModel;
export const createPlatformTemplateQuestionFormModel =
  createTemplateGraphQuestionFormModel;
export const platformTemplateFormToPayload = templateGraphFormToPayload;

export const platformTemplateIconChoiceToValue = (
  choice: Pick<IconRecord, 'commonName' | 'sourceColor'>,
): IconValue => ({
  iconColor: choice.sourceColor ?? 0,
  iconName: choice.commonName,
});

export const platformTemplateModeTransitionIssue = (
  targetMode: TemplateConfigurationMode,
  persistedTemplate: TemplateGraphRecord | undefined,
  currentOptions: readonly {
    id: string;
    organizingRegistration: boolean;
  }[],
): null | string => {
  if (targetMode === 'advanced') return null;
  if (!isSimpleCompatibleRegistrationOptions(currentOptions)) {
    return 'Simple configuration requires exactly one organizing and one non-organizing option. Reclassify or remove options first; nothing was deleted.';
  }
  return persistedAdvancedToSimpleModeIssue(persistedTemplate, currentOptions);
};

export const platformTemplateEditorDataReady = ({
  optionsResolved,
  rolesResolved,
  templateRequired,
  templateResolved,
}: {
  optionsResolved: boolean;
  rolesResolved: boolean;
  templateRequired: boolean;
  templateResolved: boolean;
}): boolean =>
  optionsResolved && rolesResolved && (!templateRequired || templateResolved);

export const platformTemplateRecordToFormModel = (
  template: Parameters<typeof templateGraphRecordToFormModel>[0],
): PlatformTemplateFormLoadResult => {
  const result = templateGraphRecordToFormModel(template);
  return 'error' in result
    ? result
    : { model: { ...result.model, reason: '' } };
};

const emptyRegistration = createTemplateGraphRegistrationOptionFormModel;

@Injectable({ providedIn: 'root' })
export class PlatformTemplateEditorOperations {
  private readonly rpc = AppRpc.injectClient();

  create() {
    return this.rpc.platform.templates.create.mutationOptions();
  }

  findOne(targetTenantId: string, templateId: string) {
    return this.rpc.platform.templates.findOne.queryOptions({
      targetTenantId,
      templateId,
    });
  }

  formOptions(targetTenantId: string) {
    return this.rpc.platform.templates.formOptions.queryOptions({
      targetTenantId,
    });
  }

  roles(targetTenantId: string) {
    return this.rpc.platform.roles.list.queryOptions({ targetTenantId });
  }

  taxRates(targetTenantId: string) {
    return this.rpc.platform.taxRates.listStripe.queryOptions({
      targetTenantId,
    });
  }

  templateFilter() {
    return this.rpc.queryFilter(['platform', 'templates']);
  }

  tenant(targetTenantId: string) {
    return this.rpc.globalAdmin.tenants.findOne.queryOptions({
      id: targetTenantId,
    });
  }

  update() {
    return this.rpc.platform.templates.update.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyAmountInputComponent,
    EditorComponent,
    FontAwesomeModule,
    FormField,
    IconComponent,
    LocationSelectorField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    PlatformTenantPageHeaderComponent,
    RouterLink,
  ],
  selector: 'app-platform-template-editor',
  templateUrl: './platform-template-editor.component.html',
})
export class PlatformTemplateEditorComponent {
  readonly templateId = input<string>();
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformTemplateEditorOperations);
  protected readonly taxRatesQuery = injectQuery(() =>
    this.operations.taxRates(this.tenantId()),
  );
  protected readonly availableTaxRates = computed(() =>
    this.taxRatesQuery.isSuccess()
      ? this.taxRatesQuery
          .data()
          .filter((rate) => rate.active && rate.imported && rate.inclusive)
      : [],
  );
  protected readonly createMutation = injectMutation(() =>
    this.operations.create(),
  );
  protected readonly optionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  protected readonly rolesQuery = injectQuery(() =>
    this.operations.roles(this.tenantId()),
  );
  protected readonly templateQuery = injectQuery(() => ({
    ...this.operations.findOne(this.tenantId(), this.templateId() ?? '__new__'),
    enabled: Boolean(this.templateId()),
  }));
  protected readonly editorDataReady = computed(() =>
    platformTemplateEditorDataReady({
      optionsResolved:
        this.optionsQuery.isSuccess() && !this.optionsQuery.isFetching(),
      rolesResolved:
        this.rolesQuery.isSuccess() && !this.rolesQuery.isFetching(),
      templateRequired: Boolean(this.templateId()),
      templateResolved:
        this.templateQuery.isSuccess() && !this.templateQuery.isFetching(),
    }),
  );
  protected readonly editorDataRetrying = computed(
    () =>
      this.optionsQuery.isFetching() ||
      this.rolesQuery.isFetching() ||
      (Boolean(this.templateId()) && this.templateQuery.isFetching()),
  );
  protected readonly editorLoadError = signal('');
  protected readonly esnCardEnabled = computed(
    () =>
      this.optionsQuery.isSuccess() && this.optionsQuery.data().esnCardEnabled,
  );
  protected readonly faPlus = faPlus;
  protected readonly faTrashCan = faTrashCan;
  private readonly templateModel = signal(createPlatformTemplateFormModel());
  private readonly savedTemplateSnapshot = signal(
    JSON.stringify(this.templateModel()),
  );
  protected readonly hasUnsavedChanges = computed(
    () => this.savedTemplateSnapshot() !== JSON.stringify(this.templateModel()),
  );
  protected readonly modeBlockMessage = signal('');
  protected readonly selectedIcon = computed<IconValue>(() => ({
    iconColor: this.templateModel().iconColor,
    iconName: this.templateModel().iconName,
  }));
  protected readonly selectedIconLabel = computed(() => {
    const selectedName = this.templateModel().iconName;
    return this.optionsQuery.isSuccess()
      ? (this.optionsQuery
          .data()
          .iconChoices.find((choice) => choice.commonName === selectedName)
          ?.friendlyName ??
          (this.templateId()
            ? 'Previously selected icon (no longer available)'
            : 'Default icon'))
      : '';
  });
  protected readonly selectedLocation = computed(() =>
    templateGraphLocationFormModelToValue(this.templateModel().location),
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
  protected readonly targetTenantCurrency = computed(() =>
    this.targetTenantQuery.isSuccess()
      ? (this.targetTenantQuery.data()?.currency ?? '')
      : '',
  );
  protected readonly templateForm = form(this.templateModel, (template) => {
    required(template.categoryId, { message: 'Select a category.' });
    required(template.title, { message: 'Enter a template title.' });
    validate(template.title, ({ value }) =>
      value().trim()
        ? undefined
        : { kind: 'required', message: 'Enter a template title.' },
    );
    required(template.description, {
      message: 'Enter a template description.',
    });
    required(template.iconName, { message: 'Enter an icon name.' });
    required(template.iconColor, { message: 'Enter an icon color index.' });
    required(template.location.name, {
      message: 'Enter a location name.',
      when: ({ valueOf }) => valueOf(template.location.type) !== 'none',
    });
    required(template.location.latitude, {
      message: 'Enter a latitude.',
      when: ({ valueOf }) => {
        const type = valueOf(template.location.type);
        return type === 'coordinate' || type === 'google';
      },
    });
    required(template.location.longitude, {
      message: 'Enter a longitude.',
      when: ({ valueOf }) => {
        const type = valueOf(template.location.type);
        return type === 'coordinate' || type === 'google';
      },
    });
    required(template.location.placeId, {
      message: 'Enter a Google place ID.',
      when: ({ valueOf }) => valueOf(template.location.type) === 'google',
    });
    required(template.location.meetingUrl, {
      message: 'Enter a meeting URL.',
      when: ({ valueOf }) => valueOf(template.location.type) === 'online',
    });

    applyEach(template.registrationOptions, (registration) => {
      apply(registration, templateGraphRegistrationOptionFormSchema);
      disabled(registration.isPaid, () => !this.stripeConnected());
      disabled(registration.price, () => !this.stripeConnected());
      disabled(
        registration.esnCardDiscountedPrice,
        () => !this.stripeConnected(),
      );
      disabled(registration.stripeTaxRateId, () => !this.stripeConnected());
    });

    applyEach(template.addOns, (addOn) => {
      apply(addOn, templateGraphAddonFormSchema);
      disabled(addOn.isPaid, () => !this.stripeConnected());
      disabled(addOn.price, () => !this.stripeConnected());
      disabled(addOn.stripeTaxRateId, () => !this.stripeConnected());
    });

    applyEach(template.questions, templateGraphQuestionFormSchema);

    validate(template.simpleModeEnabled, ({ value, valueOf }) =>
      !value() ||
      isSimpleCompatibleRegistrationOptions(
        valueOf(template.registrationOptions),
      )
        ? undefined
        : {
            kind: 'simpleModeShape',
            message:
              'Simple configuration requires exactly one organizing and one non-organizing option.',
          },
    );

    required(template.reason, { message: 'Enter an operational reason.' });
    maxLength(template.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });
  protected readonly updateMutation = injectMutation(() =>
    this.operations.update(),
  );
  private readonly dialog = inject(MatDialog);
  private readonly initializedNewTemplateTenantId = signal<null | string>(null);
  private readonly initializedTemplateId = signal<null | string>(null);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const tenantId = this.tenantId();
      const templateId = this.templateId();
      if (!templateId) {
        if (
          this.initializedNewTemplateTenantId() === tenantId ||
          !this.optionsQuery.isSuccess() ||
          !this.rolesQuery.isSuccess()
        ) {
          return;
        }
        const categories = this.optionsQuery.data().categories;
        const [defaultIcon] = this.optionsQuery.data().iconChoices;
        const defaultIconValue = defaultIcon
          ? platformTemplateIconChoiceToValue(defaultIcon)
          : undefined;
        const roles = this.rolesQuery.data();
        untracked(() => {
          const model = createPlatformTemplateFormModel();
          this.templateModel.set({
            ...model,
            categoryId: categories[0]?.id ?? '',
            iconColor: defaultIconValue?.iconColor ?? model.iconColor,
            iconName: defaultIconValue?.iconName ?? model.iconName,
            registrationOptions: model.registrationOptions.map((option) => ({
              ...option,
              roleIds: roles
                .filter((role) =>
                  option.organizingRegistration
                    ? role.defaultOrganizerRole
                    : role.defaultUserRole,
                )
                .map((role) => role.id),
            })),
          });
          this.rememberCurrentTemplate();
          this.templateForm().reset();
          this.initializedNewTemplateTenantId.set(tenantId);
        });
        return;
      }

      if (
        !this.templateQuery.isSuccess() ||
        this.initializedTemplateId() === templateId
      ) {
        return;
      }
      const result = platformTemplateRecordToFormModel(
        this.templateQuery.data(),
      );
      untracked(() => {
        if ('error' in result) {
          this.editorLoadError.set(result.error);
        } else {
          this.editorLoadError.set('');
          this.templateModel.set(
            this.stripeDisconnected()
              ? resetTemplateGraphPayments(result.model)
              : result.model,
          );
          this.rememberCurrentTemplate();
          this.templateForm().reset();
        }
        this.initializedTemplateId.set(templateId);
      });
    });
    effect(() => {
      if (!this.stripeDisconnected()) return;
      const model = this.templateModel();
      const resetModel = resetTemplateGraphPayments(model);
      if (resetModel === model) return;
      untracked(() => this.templateModel.set(resetModel));
    });
  }

  canDeactivate(): boolean {
    if (!this.hasUnsavedChanges()) return true;
    return (
      typeof globalThis.confirm === 'function' &&
      globalThis.confirm(
        'You have unsaved template changes. Leave this page and discard them?',
      )
    );
  }

  protected addAddOn(): void {
    const registrationOptionKey = this.defaultRegistrationOptionKey();
    if (!registrationOptionKey) return;
    this.templateModel.update((model) => ({
      ...model,
      addOns: [
        ...model.addOns,
        createPlatformTemplateAddonFormModel(registrationOptionKey),
      ],
    }));
  }

  protected addAddOnMapping(addOnIndex: number): void {
    this.templateModel.update((model) => {
      const addOn = model.addOns[addOnIndex];
      if (!addOn) return model;
      const mappedKeys = new Set(
        addOn.registrationOptions.map(
          (mapping) => mapping.registrationOptionKey,
        ),
      );
      const registrationOptionKey = model.registrationOptions.find(
        (option) => !mappedKeys.has(option.key),
      )?.key;
      if (!registrationOptionKey) return model;
      return {
        ...model,
        addOns: model.addOns.map((current, index) =>
          index === addOnIndex
            ? {
                ...current,
                registrationOptions: [
                  ...current.registrationOptions,
                  {
                    includedQuantity: 1,
                    optionalPurchaseQuantity: 0,
                    registrationOptionKey,
                  },
                ],
              }
            : current,
        ),
      };
    });
  }

  protected addQuestion(): void {
    const registrationOptionKey = this.defaultRegistrationOptionKey();
    if (!registrationOptionKey) return;
    this.templateModel.update((model) => ({
      ...model,
      questions: [
        ...model.questions,
        {
          ...createPlatformTemplateQuestionFormModel(registrationOptionKey),
          sortOrder: model.questions.length,
        },
      ],
    }));
  }

  protected addRegistrationOption(): void {
    if (this.isSimpleMode()) return;
    this.templateModel.update((model) => ({
      ...model,
      registrationOptions: [
        ...model.registrationOptions,
        emptyRegistration('Registration option', 20, false),
      ],
    }));
  }

  protected categoryIsAvailable(categoryId: string): boolean {
    return (
      this.optionsQuery.isSuccess() &&
      this.optionsQuery
        .data()
        .categories.some((category) => category.id === categoryId)
    );
  }

  protected iconChoiceValue(choice: IconRecord): IconValue {
    return platformTemplateIconChoiceToValue(choice);
  }

  protected iconIsAvailable(iconName: string): boolean {
    return (
      this.optionsQuery.isSuccess() &&
      this.optionsQuery
        .data()
        .iconChoices.some((choice) => choice.commonName === iconName)
    );
  }

  protected isSimpleMode(): boolean {
    return this.templateModel().simpleModeEnabled;
  }

  protected missingRoleIds(roleIds: readonly string[]): readonly string[] {
    if (!this.rolesQuery.isSuccess()) return roleIds;
    const available = new Set(this.rolesQuery.data().map((role) => role.id));
    return roleIds.filter((roleId) => !available.has(roleId));
  }

  protected mutationPending(): boolean {
    return this.createMutation.isPending() || this.updateMutation.isPending();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected protectUnsavedChangesBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  protected registrationOptionLabel(key: string): string {
    const option = this.templateModel().registrationOptions.find(
      (registration) => registration.key === key,
    );
    return option?.title.trim() || key;
  }

  protected registrationReferenceCount(key: string): number {
    const model = this.templateModel();
    return (
      model.questions.filter(
        (question) => question.registrationOptionKey === key,
      ).length +
      model.addOns.reduce(
        (count, addOn) =>
          count +
          addOn.registrationOptions.filter(
            (mapping) => mapping.registrationOptionKey === key,
          ).length,
        0,
      )
    );
  }

  protected removeAddOn(index: number): void {
    this.templateModel.update((model) => ({
      ...model,
      addOns: model.addOns.filter((_addOn, addOnIndex) => addOnIndex !== index),
    }));
  }

  protected removeAddOnMapping(addOnIndex: number, mappingIndex: number): void {
    this.templateModel.update((model) => ({
      ...model,
      addOns: model.addOns.map((addOn, index) =>
        index === addOnIndex
          ? {
              ...addOn,
              registrationOptions: addOn.registrationOptions.filter(
                (_mapping, currentMappingIndex) =>
                  currentMappingIndex !== mappingIndex,
              ),
            }
          : addOn,
      ),
    }));
  }

  protected removeQuestion(index: number): void {
    this.templateModel.update((model) => ({
      ...model,
      questions: model.questions.filter(
        (_question, questionIndex) => questionIndex !== index,
      ),
    }));
  }

  protected removeRegistrationOption(index: number): void {
    if (this.isSimpleMode()) return;
    const option = this.templateModel().registrationOptions[index];
    if (!option || this.registrationReferenceCount(option.key) > 0) return;
    this.templateModel.update((model) => ({
      ...model,
      registrationOptions: model.registrationOptions.filter(
        (_registration, registrationIndex) => registrationIndex !== index,
      ),
    }));
  }

  protected async requestMode(
    targetMode: TemplateConfigurationMode,
  ): Promise<void> {
    const currentMode: TemplateConfigurationMode = this.isSimpleMode()
      ? 'simple'
      : 'advanced';
    if (currentMode === targetMode) return;

    const issue = platformTemplateModeTransitionIssue(
      targetMode,
      this.templateQuery.isSuccess() ? this.templateQuery.data() : undefined,
      this.templateModel().registrationOptions,
    );
    if (issue) {
      this.modeBlockMessage.set(issue);
      return;
    }

    this.modeBlockMessage.set('');
    const result = await firstValueFrom(
      this.dialog
        .open<
          TemplateModeConfirmationDialogComponent,
          TemplateModeConfirmationData,
          TemplateConfigurationMode | undefined
        >(TemplateModeConfirmationDialogComponent, {
          data: { targetMode },
          maxWidth: '34rem',
        })
        .afterClosed(),
    );
    if (result !== targetMode) return;
    this.templateModel.update((model) => ({
      ...model,
      simpleModeEnabled: targetMode === 'simple',
    }));
  }

  protected retryEditorData(): void {
    if (this.optionsQuery.isError()) void this.optionsQuery.refetch();
    if (this.rolesQuery.isError()) void this.rolesQuery.refetch();
    if (this.templateId() && this.templateQuery.isError()) {
      void this.templateQuery.refetch();
    }
  }

  protected roleLabel(role: PlatformRoleRecord): string {
    return role.name;
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (
      this.mutationPending() ||
      this.editorLoadError() ||
      !this.editorDataReady()
    ) {
      return;
    }

    void submit(this.templateForm, async () => {
      if (!this.editorDataReady()) return;
      const value = this.stripeDisconnected()
        ? resetTemplateGraphPayments(this.templateModel())
        : this.templateModel();
      const payload = platformTemplateFormToPayload(
        value,
        this.esnCardEnabled(),
      );

      try {
        const templateId = this.templateId();
        const saved = templateId
          ? await this.updateMutation.mutateAsync({
              ...payload,
              reason: value.reason.trim(),
              targetTenantId: this.tenantId(),
              templateId,
            } satisfies PlatformTemplatesUpdateInput)
          : await this.createMutation.mutateAsync({
              ...payload,
              reason: value.reason.trim(),
              targetTenantId: this.tenantId(),
            } satisfies PlatformTemplatesCreateInput);
        await this.queryClient.invalidateQueries(
          this.operations.templateFilter(),
        );
        this.notifications.showSuccess(
          templateId ? 'Template updated' : 'Template created',
        );
        this.rememberCurrentTemplate();
        await this.router.navigate([
          '/global-admin/tenants',
          this.tenantId(),
          'templates',
          saved.id,
        ]);
      } catch {
        this.notifications.showError(
          'The template could not be saved. Review the details and try again.',
        );
      }
    });
  }

  protected selectIcon(iconName: string): void {
    if (!this.optionsQuery.isSuccess()) return;
    const choice = this.optionsQuery
      .data()
      .iconChoices.find((candidate) => candidate.commonName === iconName);
    if (!choice) return;
    const icon = platformTemplateIconChoiceToValue(choice);
    this.templateModel.update((model) => ({
      ...model,
      iconColor: icon.iconColor,
      iconName: icon.iconName,
    }));
  }

  protected setLocation(location: EventLocationType | null): void {
    this.templateModel.update((model) => ({
      ...model,
      location: templateGraphLocationValueToFormModel(location),
    }));
  }

  protected taxRateIsAvailable(taxRateId: string): boolean {
    return this.availableTaxRates().some((rate) => rate.id === taxRateId);
  }

  protected taxRateLabel(rate: PlatformStripeTaxRateRecord): string {
    const name = rate.displayName?.trim() || 'Unnamed tax rate';
    return rate.percentage === null ? name : `${name} · ${rate.percentage}%`;
  }

  private defaultRegistrationOptionKey(): string {
    const options = this.templateModel().registrationOptions;
    return (
      options.find((option) => !option.organizingRegistration)?.key ??
      options[0]?.key ??
      ''
    );
  }

  private rememberCurrentTemplate(): void {
    this.savedTemplateSnapshot.set(JSON.stringify(this.templateModel()));
  }
}
