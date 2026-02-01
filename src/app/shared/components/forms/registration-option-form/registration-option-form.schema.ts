import { hidden, min, required, schema } from '@angular/forms/signals';
import { DateTime } from 'luxon';

export interface RegistrationOptionFormModel {
  closeRegistrationTime: DateTime;
  description: string;
  isPaid: boolean;
  openRegistrationTime: DateTime;
  organizingRegistration: boolean;
  price: number;
  registeredDescription: string;
  registrationMode: 'application' | 'fcfs' | 'random';
  spots: number;
  stripeTaxRateId: null | string;
  title: string;
}

export const createRegistrationOptionFormModel = (
  overrides: Partial<RegistrationOptionFormModel> = {},
): RegistrationOptionFormModel => ({
  closeRegistrationTime: DateTime.now(),
  description: '',
  isPaid: false,
  openRegistrationTime: DateTime.now(),
  organizingRegistration: false,
  price: 0,
  registeredDescription: '',
  registrationMode: 'fcfs',
  spots: 1,
  stripeTaxRateId: null,
  title: '',
  ...overrides,
});

export const registrationOptionFormSchema =
  schema<RegistrationOptionFormModel>((form) => {
    hidden(form.price, ({ valueOf }) => !valueOf(form.isPaid));
    hidden(form.stripeTaxRateId, ({ valueOf }) => !valueOf(form.isPaid));
    min(form.spots, 1);
    required(form.stripeTaxRateId);
  });
