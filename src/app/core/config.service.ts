import { Injectable } from '@angular/core';

import { Permission } from '../../shared/permissions/permissions';
import { Tenant } from '../../types/custom/tenant';
import { injectTrpcClient } from './trpc-client';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  public get permissions(): Permission[] {
    return this._permissions;
  }

  public get tenant(): Tenant {
    return this._tenant;
  }

  private _permissions!: Permission[];
  private _tenant!: Tenant;

  private trpcClient = injectTrpcClient();

  public async initialize() {
    const [tenant, permissions] = await Promise.all([
      this.trpcClient.config.tenant.query(),
      this.trpcClient.config.permissions.query(),
    ]);

    this._tenant = tenant;
    this._permissions = [...permissions];
  }
}
