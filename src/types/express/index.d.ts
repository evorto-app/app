import { type Authentication } from '../custom/authentication';
import { type Tenant } from '../custom/tenant';
import { type User } from '../custom/user';

export {};

declare global {
  namespace Express {
    export interface Request {
      authentication: Authentication;
      tenant: Tenant;
      user: User;
    }
  }
}
