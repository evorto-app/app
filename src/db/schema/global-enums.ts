import { pgEnum } from 'drizzle-orm/pg-core';

export const registrationModes = pgEnum('registration_mode', [
  'fcfs',
  'random',
  'application',
]);

export const paymentStatus = pgEnum('payment_status', [
  'PENDING',
  'PAID',
  'REFUNDED',
]);

export const registrationStatus = pgEnum('registration_status', [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'WAITLIST',
]);

export const discountTypes = pgEnum('discount_type', ['esnCard']);
