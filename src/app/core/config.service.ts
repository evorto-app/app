import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

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
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  private trpcClient = injectTrpcClient();

  public async initialize() {
    const [tenant, permissions] = await Promise.all([
      this.trpcClient.config.tenant.query(),
      this.trpcClient.config.permissions.query(),
    ]);

    this.title.setTitle(tenant.name);

    this._tenant = tenant;
    this._permissions = [...permissions];
  }

  public updateDescription(description: string): void {
    this.meta.updateTag({ content: description, name: 'description' });
  }

  public updateTitle(title: string): void {
    this.title.setTitle(`${title} | ${this.tenant.name}`);
  }
}
