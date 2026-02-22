import type { AppRpcHandlers } from '../shared/handler-types';

import { eventLifecycleHandlers } from './events-lifecycle.handlers';
import { eventQueryHandlers } from './events-query.handlers';
import { eventRegistrationHandlers } from './events-registration.handlers';
import { eventReviewHandlers } from './events-review.handlers';

export const eventHandlers = {
  ...eventQueryHandlers,
  ...eventRegistrationHandlers,
  ...eventLifecycleHandlers,
  ...eventReviewHandlers,
} satisfies Partial<AppRpcHandlers>;
