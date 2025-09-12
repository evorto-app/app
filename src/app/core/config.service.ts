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
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { Permission } from '../../shared/permissions/permissions';
import { Context } from '../../types/custom/context';
import { Tenant } from '../../types/custom/tenant';
import { injectTRPC } from './trpc-client';
import { injectTRPCClient } from './trpc-client';

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

  public get publicConfig() {
    return this._publicConfig;
  }

  private _missingContext = false;
  private _permissions!: Permission[];

  private _tenant!: Tenant;
  private _publicConfig: { sentryDsn: string | null; googleMapsApiKey: string | null } = {
    googleMapsApiKey: null,
    sentryDsn: null,
  };

  private trpc = injectTRPC();

  private currentTenantQuery = injectQuery(() =>
    this.trpc.config.tenant.queryOptions(),
  );

  private document = inject(DOCUMENT);
  private readonly meta = inject(Meta);

  private readonly platformId = inject(PLATFORM_ID);

  // eslint-disable-next-line unicorn/no-null
  private renderer = inject(RendererFactory2).createRenderer(null, null);
  private readonly requestContext = inject(REQUEST_CONTEXT) as Context | null;

  private readonly title = inject(Title);
  private trpcClient = injectTRPCClient();

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
      this.trpcClient.config.tenant.query(),
      this.trpcClient.config.permissions.query(),
      this.trpcClient.config.public.query(),
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
