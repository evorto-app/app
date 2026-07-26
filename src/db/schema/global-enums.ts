import { eventListingAudiences } from '@shared/event-listing-audience';
import { pgEnum } from 'drizzle-orm/pg-core';

export const eventListingAudience = pgEnum(
  'event_listing_audience',
  eventListingAudiences,
);

export const registrationModes = pgEnum('registration_mode', [
  'fcfs',
  'application',
]);

export const registrationStatus = pgEnum('registration_status', [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'WAITLIST',
]);

export const discountTypes = pgEnum('discount_type', ['esnCard']);
