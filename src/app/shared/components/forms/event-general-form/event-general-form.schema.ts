import type { IconValue } from '@shared/types/icon';

import {
  apply,
  applyEach,
  disabled,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';
import { DateTime } from 'luxon';

import {
  DEFAULT_TENANT_TIMEZONE,
  type SupportedTenantTimezone,
} from '../../../../../types/custom/tenant';
import { EventLocationType } from '../../../../../types/location';
import { tenantNow } from '../../../../core/tenant-runtime';
import { resetRegistrationPayment } from '../payment-configuration';
import {
  RegistrationOptionFormModel,
  registrationOptionFormSchema,
} from '../registration-option-form/registration-option-form.schema';

export interface EventGeneralFormModel {
  description: string;
  end: DateTime;
  icon: IconValue | null;
  location: EventLocationType | null;
  registrationOptions: RegistrationOptionFormModel[];
  start: DateTime;
  title: string;
}

export const createEventGeneralFormModel = (
  overrides: Partial<EventGeneralFormModel> = {},
  timezone: SupportedTenantTimezone = DEFAULT_TENANT_TIMEZONE,
): EventGeneralFormModel => {
  const defaultStart = tenantNow(timezone).plus({ weeks: 1 });
  return {
    description: '',
    end: defaultStart,
    icon: null,
    location: null,
    registrationOptions: [],
    start: defaultStart,
    title: '',
    ...overrides,
  };
};

export const eventGeneralFormSchema = schema<EventGeneralFormModel>((form) => {
  validate(form.description, ({ value }) => {
    return hasTemporaryRichTextImageSources(value())
      ? {
          kind: 'richTextPendingUpload',
          message: 'Wait for image uploads to finish before saving.',
        }
      : undefined;
  });
  applyEach(form.registrationOptions, registrationOptionFormSchema);
});

export const eventGeneralFormSchemaWithPaymentAvailability = (
  paymentAllowed: () => boolean,
) =>
  schema<EventGeneralFormModel>((form) => {
    apply(form, eventGeneralFormSchema);
    applyEach(form.registrationOptions, (option) => {
      disabled(option.isPaid, () => !paymentAllowed());
      disabled(option.price, () => !paymentAllowed());
      disabled(option.esnCardDiscountedPrice, () => !paymentAllowed());
      disabled(option.stripeTaxRateId, () => !paymentAllowed());
    });
  });

export const resetEventGeneralFormPayments = <
  Model extends EventGeneralFormModel,
>(
  model: Model,
): Model => {
  const registrationOptions = model.registrationOptions.map((option) =>
    resetRegistrationPayment(option, null, ''),
  );
  const unchanged = registrationOptions.every(
    (option, index) => option === model.registrationOptions[index],
  );

  return unchanged ? model : { ...model, registrationOptions };
};
