import type { WritableRegistrationMode } from '@shared/registration-modes';
import type {
  EventGraphAddonInput,
  EventGraphEditRecord,
  EventGraphQuestionInput,
  EventGraphRegistrationOptionInput,
} from '@shared/rpc-contracts/app-rpcs/events.rpcs';
import type { IconValue } from '@shared/types/icon';
import type { DateTime } from 'luxon';

import type { SupportedTenantTimezone } from '../../../types/custom/tenant';
import type { EventLocationType } from '../../../types/location';

import { tenantNow, toTenantDateTime } from '../../core/tenant-runtime';
import {
  resetAddOnPayment,
  resetRegistrationPayment,
} from '../../shared/components/forms/payment-configuration';

export interface EventGraphAddonFormModel {
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
  registrationOptions: EventGraphAddonMappingFormModel[];
  stripeTaxRateId: null | string;
  title: string;
  totalAvailableQuantity: number;
}

export interface EventGraphAddonMappingFormModel {
  includedQuantity: number;
  optionalPurchaseQuantity: number;
  registrationOptionKey: string;
}

export type EventGraphFormLoadResult =
  { error: string } | { model: EventGraphFormModel };

export interface EventGraphFormModel {
  addOns: EventGraphAddonFormModel[];
  description: string;
  end: DateTime;
  icon: IconValue | null;
  location: EventLocationType | null;
  questions: EventGraphQuestionFormModel[];
  registrationOptions: EventGraphRegistrationOptionFormModel[];
  simpleModeEnabled: boolean;
  start: DateTime;
  title: string;
}

export type EventGraphPayloadResult =
  { error: string } | { payload: EventGraphUpdatePayload };

export interface EventGraphQuestionFormModel {
  description: string;
  id: string;
  key: string;
  registrationOptionKey: string;
  required: boolean;
  sortOrder: number;
  title: string;
}

export interface EventGraphRegistrationOptionFormModel {
  cancellationDeadlineHoursBeforeStart: null | number;
  closeRegistrationTime: DateTime;
  description: string;
  esnCardDiscountedPrice: '' | number;
  id: string;
  isPaid: boolean;
  key: string;
  openRegistrationTime: DateTime;
  organizingRegistration: boolean;
  price: number;
  refundFeesOnCancellation: boolean | null;
  registeredDescription: string;
  registrationMode: WritableRegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
  transferDeadlineHoursBeforeStart: null | number;
}

export interface EventGraphUpdatePayload {
  addOns: EventGraphAddonInput[];
  description: string;
  end: string;
  icon: IconValue;
  location: EventLocationType | null;
  questions: EventGraphQuestionInput[];
  registrationOptions: EventGraphRegistrationOptionInput[];
  simpleModeEnabled: boolean;
  start: string;
  title: string;
}

export const resetEventGraphPayments = (
  model: EventGraphFormModel,
): EventGraphFormModel => {
  const addOns = model.addOns.map((addOn) => resetAddOnPayment(addOn, null));
  const registrationOptions = model.registrationOptions.map((option) =>
    resetRegistrationPayment(option, null, ''),
  );
  const unchanged =
    addOns.every((addOn, index) => addOn === model.addOns[index]) &&
    registrationOptions.every(
      (option, index) => option === model.registrationOptions[index],
    );

  return unchanged ? model : { ...model, addOns, registrationOptions };
};

export const legacyRandomEventEditMessage =
  'This event uses legacy random allocation. It remains readable, but its registration configuration cannot be edited until it is explicitly migrated.';

const createGraphKey = (): string => globalThis.crypto.randomUUID();

export const simpleEventGraphIssue = (
  registrationOptions: readonly Pick<
    EventGraphRegistrationOptionFormModel,
    'organizingRegistration'
  >[],
): null | string => {
  const organizingCount = registrationOptions.filter(
    (option) => option.organizingRegistration,
  ).length;
  const participantCount = registrationOptions.length - organizingCount;
  if (
    registrationOptions.length === 2 &&
    organizingCount === 1 &&
    participantCount === 1
  ) {
    return null;
  }
  return 'Simple mode requires exactly one organizing and one non-organizing registration option. Reduce the advanced list without deleting referenced data, then try again.';
};

export const advancedEventGraphWarnings = (
  registrationOptions: readonly Pick<
    EventGraphRegistrationOptionFormModel,
    'organizingRegistration'
  >[],
): string[] => {
  const warnings: string[] = [];
  if (registrationOptions.every((option) => !option.organizingRegistration)) {
    warnings.push('No organizing registration option is configured.');
  }
  if (registrationOptions.every((option) => option.organizingRegistration)) {
    warnings.push('No non-organizing registration option is configured.');
  }
  return warnings;
};

const writableRegistrationOption = (
  option: EventGraphEditRecord['registrationOptions'][number],
): option is EventGraphEditRecord['registrationOptions'][number] & {
  registrationMode: WritableRegistrationMode;
} =>
  option.registrationMode === 'application' ||
  option.registrationMode === 'fcfs';

export const eventGraphRecordToFormModel = (
  event: EventGraphEditRecord,
  timezone: SupportedTenantTimezone,
): EventGraphFormLoadResult => {
  if (!event.registrationOptions.every(writableRegistrationOption)) {
    return { error: legacyRandomEventEditMessage };
  }

  const optionIds = new Set(
    event.registrationOptions.map((option) => option.id),
  );
  const hasInvalidReference =
    event.questions.some(
      (question) => !optionIds.has(question.registrationOptionId),
    ) ||
    event.addOns.some((addOn) =>
      addOn.registrationOptions.some(
        (mapping) => !optionIds.has(mapping.registrationOptionId),
      ),
    );
  if (hasInvalidReference) {
    return {
      error:
        'This event contains a question or add-on mapping that points outside its registration options. The graph is read-only until that reference is repaired.',
    };
  }

  if (event.simpleModeEnabled) {
    const issue = simpleEventGraphIssue(event.registrationOptions);
    if (issue) {
      return {
        error: `This event is marked as simple, but its option graph is incompatible. ${issue}`,
      };
    }
  }

  return {
    model: {
      addOns: event.addOns.map((addOn) => ({
        allowMultiple: addOn.allowMultiple,
        allowPurchaseBeforeEvent: addOn.allowPurchaseBeforeEvent,
        allowPurchaseDuringEvent: addOn.allowPurchaseDuringEvent,
        allowPurchaseDuringRegistration: addOn.allowPurchaseDuringRegistration,
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
        stripeTaxRateId: addOn.stripeTaxRateId,
        title: addOn.title,
        totalAvailableQuantity: addOn.totalAvailableQuantity,
      })),
      description: event.description,
      end: toTenantDateTime(new Date(event.end), timezone),
      icon: event.icon,
      location: event.location,
      questions: event.questions.map((question) => ({
        description: question.description ?? '',
        id: question.id,
        key: question.id,
        registrationOptionKey: question.registrationOptionId,
        required: question.required,
        sortOrder: question.sortOrder,
        title: question.title,
      })),
      registrationOptions: event.registrationOptions.map((option) => ({
        cancellationDeadlineHoursBeforeStart:
          option.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime: toTenantDateTime(
          new Date(option.closeRegistrationTime),
          timezone,
        ),
        description: option.description ?? '',
        esnCardDiscountedPrice: option.esnCardDiscountedPrice ?? '',
        id: option.id,
        isPaid: option.isPaid,
        key: option.id,
        openRegistrationTime: toTenantDateTime(
          new Date(option.openRegistrationTime),
          timezone,
        ),
        organizingRegistration: option.organizingRegistration,
        price: option.price,
        refundFeesOnCancellation: option.refundFeesOnCancellation,
        registeredDescription: option.registeredDescription ?? '',
        registrationMode: option.registrationMode,
        roleIds: [...option.roleIds],
        spots: option.spots,
        stripeTaxRateId: option.stripeTaxRateId,
        title: option.title,
        transferDeadlineHoursBeforeStart:
          option.transferDeadlineHoursBeforeStart,
      })),
      simpleModeEnabled: event.simpleModeEnabled,
      start: toTenantDateTime(new Date(event.start), timezone),
      title: event.title,
    },
  };
};

export const createEventGraphRegistrationOption = (
  model: Pick<EventGraphFormModel, 'start'>,
): EventGraphRegistrationOptionFormModel => {
  const closeRegistrationTime = model.start.minus({ hours: 1 });
  return {
    cancellationDeadlineHoursBeforeStart: null,
    closeRegistrationTime,
    description: '',
    esnCardDiscountedPrice: '',
    id: '',
    isPaid: false,
    key: createGraphKey(),
    openRegistrationTime: closeRegistrationTime.minus({ weeks: 4 }),
    organizingRegistration: false,
    price: 0,
    refundFeesOnCancellation: null,
    registeredDescription: '',
    registrationMode: 'fcfs',
    roleIds: [],
    spots: 1,
    stripeTaxRateId: null,
    title: 'New registration option',
    transferDeadlineHoursBeforeStart: null,
  };
};

export const createEventGraphQuestion = (
  registrationOptionKey: string,
  sortOrder: number,
): EventGraphQuestionFormModel => ({
  description: '',
  id: '',
  key: createGraphKey(),
  registrationOptionKey,
  required: false,
  sortOrder,
  title: 'New question',
});

export const createEventGraphAddon = (
  registrationOptionKey?: string,
): EventGraphAddonFormModel => ({
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
  registrationOptions: registrationOptionKey
    ? [
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionKey,
        },
      ]
    : [],
  stripeTaxRateId: null,
  title: 'New add-on',
  totalAvailableQuantity: 20,
});

export const createEmptyEventGraphFormModel = (
  timezone: SupportedTenantTimezone,
): EventGraphFormModel => {
  const start = tenantNow(timezone).plus({ weeks: 1 });
  return {
    addOns: [],
    description: '',
    end: start,
    icon: null,
    location: null,
    questions: [],
    registrationOptions: [],
    simpleModeEnabled: false,
    start,
    title: '',
  };
};

const optionalText = (value: string): null | string => value.trim() || null;

export const eventGraphFormToPayload = (
  model: EventGraphFormModel,
  esnCardEnabled: boolean,
): EventGraphPayloadResult => {
  if (!model.icon) {
    return { error: 'Choose an event icon before saving.' };
  }
  const simpleIssue = model.simpleModeEnabled
    ? simpleEventGraphIssue(model.registrationOptions)
    : null;
  if (simpleIssue) return { error: simpleIssue };

  return {
    payload: {
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
      description: model.description,
      end: model.end.toJSDate().toISOString(),
      icon: model.icon,
      location: model.location,
      questions: model.questions.map((question) => ({
        description: optionalText(question.description),
        ...(question.id && { id: question.id }),
        key: question.key,
        registrationOptionKey: question.registrationOptionKey,
        required: question.required,
        sortOrder: question.sortOrder,
        title: question.title.trim(),
      })),
      registrationOptions: model.registrationOptions.map((option) => ({
        cancellationDeadlineHoursBeforeStart:
          option.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime: option.closeRegistrationTime
          .toJSDate()
          .toISOString(),
        description: optionalText(option.description),
        esnCardDiscountedPrice:
          option.isPaid &&
          esnCardEnabled &&
          option.esnCardDiscountedPrice !== ''
            ? option.esnCardDiscountedPrice
            : null,
        ...(option.id && { id: option.id }),
        isPaid: option.isPaid,
        key: option.key,
        openRegistrationTime: option.openRegistrationTime
          .toJSDate()
          .toISOString(),
        organizingRegistration: option.organizingRegistration,
        price: option.isPaid ? option.price : 0,
        refundFeesOnCancellation: option.refundFeesOnCancellation,
        registeredDescription: optionalText(option.registeredDescription),
        registrationMode: option.registrationMode,
        roleIds: [...option.roleIds],
        spots: option.spots,
        stripeTaxRateId:
          option.isPaid && option.stripeTaxRateId
            ? option.stripeTaxRateId
            : null,
        title: option.title.trim(),
        transferDeadlineHoursBeforeStart:
          option.transferDeadlineHoursBeforeStart,
      })),
      simpleModeEnabled: model.simpleModeEnabled,
      start: model.start.toJSDate().toISOString(),
      title: model.title.trim(),
    },
  };
};
