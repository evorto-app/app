import type {
  PlatformTemplatesCreateInput,
  PlatformTemplatesUpdateInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import type {
  PlatformRoleRecord,
  PlatformStripeTaxRateRecord,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';
import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

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
  applyEach,
  form,
  FormField,
  hidden,
  maxLength,
  min,
  minLength,
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

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { persistedAdvancedToSimpleModeIssue } from '../../shared/components/forms/registration-mode-transition';
import {
  isSimpleCompatibleRegistrationOptions,
  templateGraphFormToPayload,
  templateGraphRecordToFormModel,
} from '../../shared/components/forms/template-graph-editor/template-graph-form.mapper';
import {
  createTemplateGraphAddonFormModel,
  createTemplateGraphFormModel,
  createTemplateGraphQuestionFormModel,
  createTemplateGraphRegistrationOptionFormModel,
  type TemplateGraphFormModel,
} from '../../shared/components/forms/template-graph-editor/template-graph-form.model';
import {
  type TemplateConfigurationMode,
  type TemplateModeConfirmationData,
  TemplateModeConfirmationDialogComponent,
} from '../../shared/components/forms/template-graph-editor/template-mode-confirmation-dialog.component';
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

  update() {
    return this.rpc.platform.templates.update.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
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
  protected readonly editorLoadError = signal('');
  protected readonly optionsQuery = injectQuery(() =>
    this.operations.formOptions(this.tenantId()),
  );
  protected readonly esnCardEnabled = computed(
    () =>
      this.optionsQuery.isSuccess() && this.optionsQuery.data().esnCardEnabled,
  );
  protected readonly faPlus = faPlus;
  protected readonly faTrashCan = faTrashCan;
  protected readonly modeBlockMessage = signal('');
  protected readonly rolesQuery = injectQuery(() =>
    this.operations.roles(this.tenantId()),
  );
  private readonly templateModel = signal(createPlatformTemplateFormModel());
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
      required(registration.title, {
        message: 'Enter a registration option title.',
      });
      min(registration.closeRegistrationOffset, 0);
      min(registration.openRegistrationOffset, 0);
      min(registration.price, 0);
      min(registration.spots, 1);
      minLength(registration.roleIds, 1, {
        message: 'Select at least one tenant role.',
      });
      required(registration.stripeTaxRateId, {
        message: 'Select an imported inclusive tax rate.',
        when: ({ valueOf }) => valueOf(registration.isPaid),
      });
      hidden(
        registration.price,
        ({ valueOf }) => !valueOf(registration.isPaid),
      );
      hidden(
        registration.esnCardDiscountedPrice,
        ({ valueOf }) => !valueOf(registration.isPaid),
      );
      hidden(
        registration.stripeTaxRateId,
        ({ valueOf }) => !valueOf(registration.isPaid),
      );
      validate(
        registration.cancellationDeadlineHoursBeforeStart,
        ({ value }) => {
          const hours = value();
          return hours !== '' && hours < 0
            ? { kind: 'min', message: 'Deadline cannot be negative.' }
            : undefined;
        },
      );
      validate(registration.transferDeadlineHoursBeforeStart, ({ value }) => {
        const hours = value();
        return hours !== '' && hours < 0
          ? { kind: 'min', message: 'Deadline cannot be negative.' }
          : undefined;
      });
      validate(registration.esnCardDiscountedPrice, ({ value, valueOf }) => {
        const discountedPrice = value();
        if (discountedPrice === '') return;
        if (discountedPrice < 0) {
          return {
            kind: 'min',
            message: 'Discounted price cannot be negative.',
          };
        }
        return discountedPrice > valueOf(registration.price)
          ? {
              kind: 'max',
              message: 'Discounted price cannot exceed the base price.',
            }
          : undefined;
      });
    });

    applyEach(template.addOns, (addOn) => {
      required(addOn.title, { message: 'Enter an add-on title.' });
      min(addOn.maxQuantityPerUser, 1);
      min(addOn.price, 1, {
        message: 'Paid add-ons must cost at least one cent.',
      });
      min(addOn.totalAvailableQuantity, 1);
      required(addOn.stripeTaxRateId, {
        message: 'Select an imported inclusive tax rate.',
        when: ({ valueOf }) => valueOf(addOn.isPaid),
      });
      hidden(addOn.price, ({ valueOf }) => !valueOf(addOn.isPaid));
      hidden(addOn.stripeTaxRateId, ({ valueOf }) => !valueOf(addOn.isPaid));
      applyEach(addOn.registrationOptions, (mapping) => {
        required(mapping.registrationOptionKey, {
          message: 'Select a registration option.',
        });
        min(mapping.includedQuantity, 0);
        min(mapping.optionalPurchaseQuantity, 0);
        validate(mapping.includedQuantity, ({ value, valueOf }) =>
          value() > valueOf(addOn.totalAvailableQuantity)
            ? {
                kind: 'max',
                message: 'Included quantity cannot exceed available quantity.',
              }
            : undefined,
        );
        validate(mapping.optionalPurchaseQuantity, ({ value, valueOf }) =>
          value() > valueOf(addOn.maxQuantityPerUser)
            ? {
                kind: 'max',
                message: 'Optional quantity cannot exceed the per-user limit.',
              }
            : undefined,
        );
      });
      validate(addOn.maxQuantityPerUser, ({ value, valueOf }) =>
        value() > valueOf(addOn.totalAvailableQuantity)
          ? {
              kind: 'max',
              message: 'Maximum per user cannot exceed available quantity.',
            }
          : undefined,
      );
    });

    applyEach(template.questions, (question) => {
      required(question.title, { message: 'Enter a question.' });
      required(question.registrationOptionKey, {
        message: 'Select a registration option.',
      });
      min(question.sortOrder, 0);
    });

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
  protected readonly templateQuery = injectQuery(() => ({
    ...this.operations.findOne(this.tenantId(), this.templateId() ?? '__new__'),
    enabled: Boolean(this.templateId()),
  }));
  protected readonly updateMutation = injectMutation(() =>
    this.operations.update(),
  );
  private readonly dialog = inject(MatDialog);
  private readonly initializedNewTemplate = signal(false);
  private readonly initializedTemplateId = signal<null | string>(null);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const templateId = this.templateId();
      if (!templateId) {
        if (
          this.initializedNewTemplate() ||
          !this.optionsQuery.isSuccess() ||
          !this.rolesQuery.isSuccess()
        ) {
          return;
        }
        const categories = this.optionsQuery.data().categories;
        const roles = this.rolesQuery.data();
        untracked(() => {
          this.templateModel.update((model) => ({
            ...model,
            categoryId: categories[0]?.id ?? '',
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
          }));
          this.templateForm().reset();
          this.initializedNewTemplate.set(true);
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
          this.templateModel.set(result.model);
          this.templateForm().reset();
        }
        this.initializedTemplateId.set(templateId);
      });
    });
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

  protected roleLabel(role: PlatformRoleRecord): string {
    return role.name;
  }

  protected save(event: Event): void {
    event.preventDefault();
    if (this.mutationPending() || this.editorLoadError()) return;

    void submit(this.templateForm, async () => {
      const value = this.templateModel();
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
        await this.router.navigate([
          '/global-admin/tenants',
          this.tenantId(),
          'templates',
          saved.id,
        ]);
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to save template'),
        );
      }
    });
  }

  protected taxRateIsAvailable(taxRateId: string): boolean {
    return this.availableTaxRates().some((rate) => rate.id === taxRateId);
  }

  protected taxRateLabel(rate: PlatformStripeTaxRateRecord): string {
    const name = rate.displayName ?? rate.id;
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
}
