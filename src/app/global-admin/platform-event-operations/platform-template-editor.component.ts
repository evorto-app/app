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

import type { EventLocationType } from '../../../types/location';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';

export type PlatformTemplateFormLoadResult =
  { error: string } | { model: PlatformTemplateFormModel };
export interface PlatformTemplateFormModel {
  addOns: PlatformTemplateAddonFormModel[];
  categoryId: string;
  description: string;
  iconColor: number;
  iconName: string;
  location: PlatformTemplateLocationFormModel;
  planningTips: string;
  questions: PlatformTemplateQuestionFormModel[];
  reason: string;
  registrationOptions: PlatformTemplateRegistrationFormModel[];
  simpleModeEnabled: boolean;
  title: string;
  unlisted: boolean;
}
type NullableNumberField = '' | number;
type PlatformLocationType = 'coordinate' | 'google' | 'none' | 'online';

interface PlatformTemplateAddonFormModel {
  allowMultiple: boolean;
  allowPurchaseBeforeEvent: boolean;
  allowPurchaseDuringEvent: boolean;
  allowPurchaseDuringRegistration: boolean;
  description: string;
  id: string;
  isPaid: boolean;
  key: string;
  maxQuantityPerUser: number;
  price: number;
  registrationOptions: PlatformTemplateAddonMappingFormModel[];
  stripeTaxRateId: string;
  title: string;
  totalAvailableQuantity: number;
}

interface PlatformTemplateAddonMappingFormModel {
  includedQuantity: number;
  optionalPurchaseQuantity: number;
  registrationOptionKey: string;
}

interface PlatformTemplateLocationFormModel {
  address: string;
  latitude: NullableNumberField;
  longitude: NullableNumberField;
  meetingInstructions: string;
  meetingProvider: 'googleMeet' | 'other' | 'teams' | 'zoom';
  meetingUrl: string;
  name: string;
  placeId: string;
  type: PlatformLocationType;
}

interface PlatformTemplateQuestionFormModel {
  description: string;
  id: string;
  key: string;
  registrationOptionKey: string;
  required: boolean;
  sortOrder: number;
  title: string;
}

interface PlatformTemplateRegistrationFormModel {
  cancellationDeadlineHoursBeforeStart: NullableNumberField;
  closeRegistrationOffset: number;
  description: string;
  esnCardDiscountedPrice: NullableNumberField;
  id: string;
  isPaid: boolean;
  key: string;
  openRegistrationOffset: number;
  organizingRegistration: boolean;
  price: number;
  refundFeesOnCancellation: RefundFeesChoice;
  registeredDescription: string;
  registrationMode: RegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: string;
  title: string;
  transferDeadlineHoursBeforeStart: NullableNumberField;
}

type PlatformTemplateWritePayload = Omit<
  PlatformTemplatesCreateInput,
  'reason' | 'targetTenantId'
>;

type RefundFeesChoice = 'default' | 'doNotRefund' | 'refund';

type RegistrationMode = 'application' | 'fcfs';
type TemplateRegistrationRecord =
  TemplateGraphRecord['registrationOptions'][number];
type WritableTemplateRegistrationRecord = Omit<
  TemplateRegistrationRecord,
  'registrationMode'
> & {
  registrationMode: RegistrationMode;
};

const createGraphKey = (): string => globalThis.crypto.randomUUID();

const emptyLocation = (): PlatformTemplateLocationFormModel => ({
  address: '',
  latitude: '',
  longitude: '',
  meetingInstructions: '',
  meetingProvider: 'other',
  meetingUrl: '',
  name: '',
  placeId: '',
  type: 'none',
});

const emptyRegistration = (
  title: string,
  spots: number,
  organizingRegistration: boolean,
  key = createGraphKey(),
): PlatformTemplateRegistrationFormModel => ({
  cancellationDeadlineHoursBeforeStart: '',
  closeRegistrationOffset: 1,
  description: '',
  esnCardDiscountedPrice: '',
  id: '',
  isPaid: false,
  key,
  openRegistrationOffset: 168,
  organizingRegistration,
  price: 0,
  refundFeesOnCancellation: 'default',
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots,
  stripeTaxRateId: '',
  title,
  transferDeadlineHoursBeforeStart: '',
});

export const createPlatformTemplateFormModel =
  (): PlatformTemplateFormModel => ({
    addOns: [],
    categoryId: '',
    description: '',
    iconColor: 0,
    iconName: 'calendar:fas',
    location: emptyLocation(),
    planningTips: '',
    questions: [],
    reason: '',
    registrationOptions: [
      emptyRegistration('Organizer registration', 1, true),
      emptyRegistration('Participant registration', 20, false),
    ],
    simpleModeEnabled: true,
    title: '',
    unlisted: false,
  });

export const createPlatformTemplateAddonFormModel = (
  registrationOptionKey: string,
): PlatformTemplateAddonFormModel => ({
  allowMultiple: false,
  allowPurchaseBeforeEvent: false,
  allowPurchaseDuringEvent: false,
  allowPurchaseDuringRegistration: true,
  description: '',
  id: '',
  isPaid: false,
  key: createGraphKey(),
  maxQuantityPerUser: 1,
  price: 0,
  registrationOptions: [
    {
      includedQuantity: 1,
      optionalPurchaseQuantity: 0,
      registrationOptionKey,
    },
  ],
  stripeTaxRateId: '',
  title: '',
  totalAvailableQuantity: 20,
});

export const createPlatformTemplateQuestionFormModel = (
  registrationOptionKey: string,
): PlatformTemplateQuestionFormModel => ({
  description: '',
  id: '',
  key: createGraphKey(),
  registrationOptionKey,
  required: true,
  sortOrder: 0,
  title: '',
});

const refundFeesChoice = (value: boolean | null): RefundFeesChoice => {
  if (value === null) return 'default';
  return value ? 'refund' : 'doNotRefund';
};

const recordLocationToFormModel = (
  location: EventLocationType | null,
): PlatformTemplateLocationFormModel => {
  if (!location) return emptyLocation();

  switch (location.type) {
    case 'coordinate': {
      return {
        ...emptyLocation(),
        address: location.address ?? '',
        latitude: location.coordinates.lat,
        longitude: location.coordinates.lng,
        name: location.name,
        type: 'coordinate',
      };
    }
    case 'google': {
      return {
        ...emptyLocation(),
        address: location.address ?? '',
        latitude: location.coordinates.lat,
        longitude: location.coordinates.lng,
        name: location.name,
        placeId: location.placeId,
        type: 'google',
      };
    }
    case 'online': {
      return {
        ...emptyLocation(),
        meetingInstructions: location.meetingInstructions ?? '',
        meetingProvider: location.meetingProvider,
        meetingUrl: location.meetingUrl,
        name: location.name,
        type: 'online',
      };
    }
  }
};

const registrationRecordToFormModel = (
  registration: WritableTemplateRegistrationRecord,
): PlatformTemplateRegistrationFormModel => ({
  cancellationDeadlineHoursBeforeStart:
    registration.cancellationDeadlineHoursBeforeStart ?? '',
  closeRegistrationOffset: registration.closeRegistrationOffset,
  description: registration.description ?? '',
  esnCardDiscountedPrice: registration.esnCardDiscountedPrice ?? '',
  id: registration.id,
  isPaid: registration.isPaid,
  key: registration.id,
  openRegistrationOffset: registration.openRegistrationOffset,
  organizingRegistration: registration.organizingRegistration,
  price: registration.price,
  refundFeesOnCancellation: refundFeesChoice(
    registration.refundFeesOnCancellation,
  ),
  registeredDescription: registration.registeredDescription ?? '',
  registrationMode: registration.registrationMode,
  roleIds: [...registration.roleIds],
  spots: registration.spots,
  stripeTaxRateId: registration.stripeTaxRateId ?? '',
  title: registration.title,
  transferDeadlineHoursBeforeStart:
    registration.transferDeadlineHoursBeforeStart ?? '',
});

export const platformTemplateRecordToFormModel = (
  template: TemplateGraphRecord,
): PlatformTemplateFormLoadResult => {
  const writableRegistrationOptions = template.registrationOptions.filter(
    (option): option is WritableTemplateRegistrationRecord =>
      option.registrationMode !== 'random',
  );
  if (
    writableRegistrationOptions.length !== template.registrationOptions.length
  ) {
    return {
      error:
        'This template uses random allocation, which is deferred and unsupported for the relaunch. It remains readable but cannot be edited here.',
    };
  }

  const registrationOptionIds = new Set(
    template.registrationOptions.map((option) => option.id),
  );
  const invalidReference =
    template.addOns.some((addOn) =>
      addOn.registrationOptions.some(
        (mapping) => !registrationOptionIds.has(mapping.registrationOptionId),
      ),
    ) ||
    template.questions.some(
      (question) => !registrationOptionIds.has(question.registrationOptionId),
    );
  if (invalidReference) {
    return {
      error:
        'This template graph contains a registration-option reference that does not belong to the template.',
    };
  }

  return {
    model: {
      addOns: template.addOns.map((addOn) => {
        return {
          allowMultiple: addOn.allowMultiple,
          allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
          allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
          allowPurchaseDuringRegistration:
            addOn.allowPurchaseDuringRegistration,
          description: addOn.description ?? '',
          id: addOn.id,
          isPaid: addOn.isPaid,
          key: addOn.id,
          maxQuantityPerUser: addOn.maxQuantityPerUser,
          price: addOn.price,
          registrationOptions: addOn.registrationOptions.map((mapping) => ({
            includedQuantity: mapping.includedQuantity,
            optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
            registrationOptionKey: mapping.registrationOptionId,
          })),
          stripeTaxRateId: addOn.stripeTaxRateId ?? '',
          title: addOn.title,
          totalAvailableQuantity: addOn.totalAvailableQuantity,
        };
      }),
      categoryId: template.categoryId,
      description: template.description,
      iconColor: template.icon.iconColor,
      iconName: template.icon.iconName,
      location: recordLocationToFormModel(template.location),
      planningTips: template.planningTips ?? '',
      questions: template.questions.map((question) => ({
        description: question.description ?? '',
        id: question.id,
        key: question.id,
        registrationOptionKey: question.registrationOptionId,
        required: question.required,
        sortOrder: question.sortOrder,
        title: question.title,
      })),
      reason: '',
      registrationOptions: writableRegistrationOptions.map((option) =>
        registrationRecordToFormModel(option),
      ),
      simpleModeEnabled: template.simpleModeEnabled,
      title: template.title,
      unlisted: template.unlisted,
    },
  };
};

const nullableNumber = (value: NullableNumberField): null | number =>
  value === '' ? null : value;

const optionalText = (value: string): null | string => value.trim() || null;

const refundFeesValue = (choice: RefundFeesChoice): boolean | null => {
  if (choice === 'default') return null;
  return choice === 'refund';
};

const formLocationToPayload = (
  location: PlatformTemplateLocationFormModel,
): EventLocationType | null => {
  const address = optionalText(location.address);
  if (location.type === 'none') return null;
  if (location.type === 'online') {
    const meetingInstructions = optionalText(location.meetingInstructions);
    return {
      ...(meetingInstructions && { meetingInstructions }),
      meetingProvider: location.meetingProvider,
      meetingUrl: location.meetingUrl.trim(),
      name: location.name.trim(),
      type: 'online',
    };
  }

  const coordinates = {
    lat: location.latitude === '' ? 0 : location.latitude,
    lng: location.longitude === '' ? 0 : location.longitude,
  };
  if (location.type === 'google') {
    return {
      ...(address && { address }),
      coordinates,
      name: location.name.trim(),
      placeId: location.placeId.trim(),
      type: 'google',
    };
  }
  return {
    ...(address && { address }),
    coordinates,
    name: location.name.trim(),
    type: 'coordinate',
  };
};

const registrationFormToPayload = (
  registration: PlatformTemplateRegistrationFormModel,
  esnCardEnabled: boolean,
): PlatformTemplateWritePayload['registrationOptions'][number] => ({
  cancellationDeadlineHoursBeforeStart: nullableNumber(
    registration.cancellationDeadlineHoursBeforeStart,
  ),
  closeRegistrationOffset: registration.closeRegistrationOffset,
  description: optionalText(registration.description),
  esnCardDiscountedPrice:
    registration.isPaid &&
    esnCardEnabled &&
    registration.esnCardDiscountedPrice !== ''
      ? registration.esnCardDiscountedPrice
      : null,
  ...(registration.id && { id: registration.id }),
  isPaid: registration.isPaid,
  key: registration.key,
  openRegistrationOffset: registration.openRegistrationOffset,
  organizingRegistration: registration.organizingRegistration,
  price: registration.isPaid ? registration.price : 0,
  refundFeesOnCancellation: refundFeesValue(
    registration.refundFeesOnCancellation,
  ),
  registeredDescription: optionalText(registration.registeredDescription),
  registrationMode: registration.registrationMode,
  roleIds: [...registration.roleIds],
  spots: registration.spots,
  stripeTaxRateId:
    registration.isPaid && registration.stripeTaxRateId
      ? registration.stripeTaxRateId
      : null,
  title: registration.title.trim(),
  transferDeadlineHoursBeforeStart: nullableNumber(
    registration.transferDeadlineHoursBeforeStart,
  ),
});

export const platformTemplateFormToPayload = (
  model: PlatformTemplateFormModel,
  esnCardEnabled: boolean,
): PlatformTemplateWritePayload => ({
  addOns: model.addOns.map((addOn) => ({
    allowMultiple: addOn.allowMultiple,
    allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
    allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
    allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
    description: optionalText(addOn.description),
    ...(addOn.id && { id: addOn.id }),
    isPaid: addOn.isPaid,
    key: addOn.key,
    maxQuantityPerUser: addOn.maxQuantityPerUser,
    price: addOn.isPaid ? addOn.price : 0,
    registrationOptions: addOn.registrationOptions.map((mapping) => ({
      includedQuantity: mapping.includedQuantity,
      optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
      registrationOptionKey: mapping.registrationOptionKey,
    })),
    stripeTaxRateId:
      addOn.isPaid && addOn.stripeTaxRateId ? addOn.stripeTaxRateId : null,
    title: addOn.title.trim(),
    totalAvailableQuantity: addOn.totalAvailableQuantity,
  })),
  categoryId: model.categoryId,
  description: model.description,
  icon: {
    iconColor: model.iconColor,
    iconName: model.iconName.trim(),
  },
  location: formLocationToPayload(model.location),
  planningTips: optionalText(model.planningTips),
  questions: model.questions.map((question) => ({
    description: optionalText(question.description),
    ...(question.id && { id: question.id }),
    key: question.key,
    registrationOptionKey: question.registrationOptionKey,
    required: question.required,
    sortOrder: question.sortOrder,
    title: question.title.trim(),
  })),
  registrationOptions: model.registrationOptions.map((registration) =>
    registrationFormToPayload(registration, esnCardEnabled),
  ),
  simpleModeEnabled: model.simpleModeEnabled,
  title: model.title.trim(),
  unlisted: model.unlisted,
});

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
      min(addOn.price, 0);
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
    const option = this.templateModel().registrationOptions[index];
    if (!option || this.registrationReferenceCount(option.key) > 0) return;
    this.templateModel.update((model) => ({
      ...model,
      registrationOptions: model.registrationOptions.filter(
        (_registration, registrationIndex) => registrationIndex !== index,
      ),
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
