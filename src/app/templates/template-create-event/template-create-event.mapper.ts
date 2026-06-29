import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { DateTime } from 'luxon';

import {
  createEventGeneralFormModel,
  EventGeneralFormModel,
} from '../../shared/components/forms/event-general-form/event-general-form.schema';
import { createRegistrationOptionFormModel } from '../../shared/components/forms/registration-option-form/registration-option-form.schema';

export const createEventFormModelFromTemplate = (
  template: TemplateFindOneRecord,
  startDateTime: DateTime,
): EventGeneralFormModel =>
  createEventGeneralFormModel({
    description: template.description,
    end: startDateTime,
    icon: template.icon,
    location: template.location ?? null,
    registrationOptions: template.registrationOptions.map((option) =>
      createRegistrationOptionFormModel({
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
        registeredDescription: option.registeredDescription ?? '',
        registrationMode: 'fcfs',
        roleIds: [...(option.roleIds ?? [])],
        spots: option.spots,
        stripeTaxRateId: option.stripeTaxRateId ?? null,
        title: option.title,
      }),
    ),
    start: startDateTime,
    title: template.title,
  });
