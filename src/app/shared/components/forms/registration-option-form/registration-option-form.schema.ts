import { hidden, min, required, schema } from '@angular/forms/signals';

export interface RegistrationOptionFormModel {
  closeRegistrationTime: Date;
  description: string;
  isPaid: boolean;
  openRegistrationTime: Date;
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
  closeRegistrationTime: new Date(),
  description: '',
  isPaid: false,
  openRegistrationTime: new Date(),
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
