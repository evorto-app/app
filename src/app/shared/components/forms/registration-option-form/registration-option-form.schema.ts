import type { RegistrationMode } from '@shared/registration-modes';

import {
  hidden,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';
import { DateTime } from 'luxon';

import {
  DEFAULT_TENANT_TIMEZONE,
  type SupportedTenantTimezone,
} from '../../../../../types/custom/tenant';
import { tenantNow } from '../../../../core/tenant-runtime';

export interface RegistrationOptionFormModel {
  cancellationDeadlineHoursBeforeStart: null | number;
  closeRegistrationTime: DateTime;
  description: string;
  esnCardDiscountedPrice: '' | number;
  id: string;
  isPaid: boolean;
  openRegistrationTime: DateTime;
  organizingRegistration: boolean;
  price: number;
  refundFeesOnCancellation: boolean | null;
  registeredDescription: string;
  registrationMode: RegistrationMode;
  roleIds: string[];
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
  transferDeadlineHoursBeforeStart: null | number;
}

export const createRegistrationOptionFormModel = (
  overrides: Partial<RegistrationOptionFormModel> = {},
  timezone: SupportedTenantTimezone = DEFAULT_TENANT_TIMEZONE,
): RegistrationOptionFormModel => ({
  cancellationDeadlineHoursBeforeStart: null,
  closeRegistrationTime: tenantNow(timezone),
  description: '',
  esnCardDiscountedPrice: '',
  id: '',
  isPaid: false,
  openRegistrationTime: tenantNow(timezone),
  organizingRegistration: false,
  price: 0,
  refundFeesOnCancellation: null,
  registeredDescription: '',
  registrationMode: 'fcfs',
  roleIds: [],
  spots: 1,
  stripeTaxRateId: null,
  title: '',
  transferDeadlineHoursBeforeStart: null,
  ...overrides,
});

export const registrationOptionFormSchema = schema<RegistrationOptionFormModel>(
  (form) => {
    validate(form.description, ({ value }) => {
      return hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined;
    });
    validate(form.registeredDescription, ({ value }) => {
      return hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined;
    });
    hidden(form.price, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.esnCardDiscountedPrice, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.stripeTaxRateId, ({ valueOf }) => !valueOf(form.isPaid));
    required(form.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(form.isPaid),
    });
    min(form.price, 1, {
      message: 'Paid registrations must cost at least 0.01.',
    });
    min(form.spots, 1);
    required(form.stripeTaxRateId);
    validate(form.esnCardDiscountedPrice, ({ value, valueOf }) => {
      const discountedPrice = value();
      if (discountedPrice === '') {
        return;
      }
      if (discountedPrice < 0) {
        return {
          kind: 'min',
          message: 'Discounted price must be non-negative.',
        };
      }
      if (discountedPrice > valueOf(form.price)) {
        return {
          kind: 'max',
          message: 'Discounted price cannot exceed the base price.',
        };
      }
      return;
    });
  },
);
