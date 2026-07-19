import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { DateTime } from 'luxon';

import {
  createEventGeneralFormModel,
  EventGeneralFormModel,
} from '../../shared/components/forms/event-general-form/event-general-form.schema';
import { createRegistrationOptionFormModel } from '../../shared/components/forms/registration-option-form/registration-option-form.schema';

export const defaultTemplateEventDurationHours = 2;

export const createEventFormModelFromTemplate = (
  template: TemplateFindOneRecord,
  startDateTime: DateTime,
): EventGeneralFormModel =>
  createEventGeneralFormModel({
    description: template.description,
    end: startDateTime.plus({ hours: defaultTemplateEventDurationHours }),
    icon: template.icon,
    location: template.location ?? null,
    registrationOptions: template.registrationOptions.map((option) =>
      createRegistrationOptionFormModel({
        cancellationDeadlineHoursBeforeStart:
          option.cancellationDeadlineHoursBeforeStart,
        closeRegistrationTime: startDateTime.minus({
          hours: option.closeRegistrationOffset,
        }),
        description: option.description ?? '',
        esnCardDiscountedPrice: option.esnCardDiscountedPrice ?? '',
        id: option.id,
        isPaid: option.isPaid,
        openRegistrationTime: startDateTime.minus({
          hours: option.openRegistrationOffset,
        }),
        organizingRegistration: option.organizingRegistration,
        price: option.price,
        refundFeesOnCancellation: option.refundFeesOnCancellation,
        registeredDescription: option.registeredDescription ?? '',
        registrationMode: option.registrationMode,
        roleIds: [...(option.roleIds ?? [])],
        spots: option.spots,
        stripeTaxRateId: option.stripeTaxRateId ?? null,
        title: option.title,
        transferDeadlineHoursBeforeStart:
          option.transferDeadlineHoursBeforeStart,
      }),
    ),
    start: startDateTime,
    title: template.title,
  });
