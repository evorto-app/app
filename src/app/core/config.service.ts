import { isPlatformServer } from '@angular/common';
import {
  DOCUMENT,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  RendererFactory2,
  REQUEST_CONTEXT,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { EffectRpcQueryClient } from '@heddendorp/effect-angular-query';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { Permission } from '../../shared/permissions/permissions';
import { AppRpcs } from '../../shared/rpc-contracts/app-rpcs';
import { Context } from '../../types/custom/context';
import { Tenant } from '../../types/custom/tenant';
import { EffectRpcClient } from './effect-rpc-client';

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

  public get publicConfig() {
    return this._publicConfig;
  }

  public get tenant(): Tenant {
    return this._tenant;
  }

  private _missingContext = false;
  private _permissions!: Permission[];

  private _publicConfig: {
    googleMapsApiKey: null | string;
    sentryDsn: null | string;
  } = {
    // eslint-disable-next-line unicorn/no-null
    googleMapsApiKey: null,
    // eslint-disable-next-line unicorn/no-null
    sentryDsn: null,
  };
  private _tenant!: Tenant;

  private readonly rpcQueryClient = inject(EffectRpcQueryClient);
  private readonly rpcHelpers = this.rpcQueryClient.helpersFor(AppRpcs);

  private currentTenantQuery = injectQuery(() =>
    this.rpcHelpers.config.tenant.queryOptions(),
  );

  private document = inject(DOCUMENT);
  private readonly meta = inject(Meta);

  private readonly platformId = inject(PLATFORM_ID);

  // eslint-disable-next-line unicorn/no-null
  private renderer = inject(RendererFactory2).createRenderer(null, null);
  private readonly requestContext = inject(REQUEST_CONTEXT) as Context | null;

  private readonly rpcClient = inject(EffectRpcClient);
  private readonly title = inject(Title);

  constructor() {
    effect(() => {
      const currentTenant = this.currentTenantQuery.data();
      if (currentTenant) {
        if (this.tenant) {
          this.renderer.removeClass(
            this.document.documentElement,
            `theme-${this.tenant.theme}`,
          );
        }
        this._tenant = currentTenant;
        this.renderer.addClass(
          this.document.documentElement,
          `theme-${this.tenant.theme}`,
        );
      }
    });
  }

  public async initialize() {
    if (this.requestContext === null && isPlatformServer(this.platformId)) {
      this._missingContext = true;
      consola.warn('Missing context on server. Skipping config loading.');
      return;
    }
    const [tenant, permissions, pub] = await Promise.all([
      this.rpcClient.getTenant(),
      this.rpcClient.getPermissions(),
      this.rpcClient.getPublicConfig(),
    ]);

    this.title.setTitle(tenant.name);

    this._tenant = tenant;
    this._permissions = [...permissions];

    this._publicConfig = pub;
  }

  public updateDescription(description: string): void {
    this.meta.updateTag({ content: description, name: 'description' });
  }

  public updateTitle(title: string): void {
    this.title.setTitle(`${title} | ${this.tenant.name}`);
  }
}
