// This file extends the Express Request type with custom properties for the Evorto app.
// Updated: Added isSocialMediaCrawler to support social crawler detection in middleware.

import { type Authentication } from '../custom/authentication';
import { type Tenant } from '../custom/tenant';
import { type User } from '../custom/user';

export {};

declare global {
  namespace Express {
    export interface Request {
      authentication: Authentication;
      /**
       * True if the request is from a known social media crawler (set by middleware)
       */
      isSocialMediaCrawler?: boolean;
      tenant: Tenant;
      user: User;
    }
  }
}
