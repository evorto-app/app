import { router } from '../trpc-server';
import { cancelPendingRegistrationProcedure } from './cancel-pending-registration.procedure';
import { eventListProcedure } from './event-list.procedure';
import { registerForEventProcedure } from './register-for-event.procedure';
import { registrationScannedProcedure } from './registration-scanned.procedure';

export const eventRouter = router({
  cancelPendingRegistration: cancelPendingRegistrationProcedure,
  findMany: eventListProcedure.query(async ({ ctx: { events } }) => {
    return events;
  }),
  registerForEvent: registerForEventProcedure,
  registrationScanned: registrationScannedProcedure,
});
