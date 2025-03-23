import { isPlatformServer } from '@angular/common';
import {
  inject,
  Injectable,
  PLATFORM_ID,
  REQUEST_CONTEXT,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import consola from 'consola/browser';

import { Permission } from '../../shared/permissions/permissions';
import { Context } from '../../types/custom/context';
import { Tenant } from '../../types/custom/tenant';
import { injectTrpcClient } from './trpc-client';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  public get missingContext() {
    return this._missingContext;
  }
  public get permissions(): Permission[] {
    return this._permissions;
  }
  public get tenant(): Tenant {
    return this._tenant;
  }
  private _missingContext = false;
  private _permissions!: Permission[];

  private _tenant!: Tenant;

  private readonly meta = inject(Meta);

  private readonly platformId = inject(PLATFORM_ID);

  private readonly requestContext = inject(REQUEST_CONTEXT) as Context | null;
  private readonly title = inject(Title);

  private trpcClient = injectTrpcClient();

  public async initialize() {
    if (this.requestContext === null && isPlatformServer(this.platformId)) {
      this._missingContext = true;
      consola.warn('Missing context on server. Skipping config loading.');
      return;
    }
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
