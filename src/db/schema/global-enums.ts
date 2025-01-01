import { pgEnum } from 'drizzle-orm/pg-core';

export const registrationModes = pgEnum('registration_modes', [
  'fcfs',
  'random',
  'application',
]);

export const discountTypes = pgEnum('discount_types', ['esnCard']);
