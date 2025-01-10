import { pgEnum } from 'drizzle-orm/pg-core';

export const registrationModes = pgEnum('registration_modes', [
  'fcfs',
  'random',
  'application',
]);

export const paymentStatus = pgEnum('payment_statuses', [
  'PENDING',
  'PAID',
  'REFUNDED',
]);

export const registrationStatus = pgEnum('registration_statuses', [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'WAITLIST',
]);

export const discountTypes = pgEnum('discount_types', ['esnCard']);
