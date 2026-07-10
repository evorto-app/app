import { platformEventHandlers } from './platform-events.handlers';
import { platformRegistrationHandlers } from './platform-registrations.handlers';
import { platformTemplateHandlers } from './platform-templates.handlers';

export const platformHandlers = {
  ...platformEventHandlers,
  ...platformRegistrationHandlers,
  ...platformTemplateHandlers,
};
