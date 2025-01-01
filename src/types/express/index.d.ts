import { Tenant, User } from '../custom';

export {};

declare global {
  namespace Express {
    export interface Request {
      tenant: Tenant;
      user: User;
    }
  }
}
