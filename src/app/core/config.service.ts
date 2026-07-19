import { isPlatformServer } from '@angular/common';
import {
  DOCUMENT,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  RendererFactory2,
  REQUEST_CONTEXT,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { Permission } from '../../shared/permissions/permissions';
import { Context } from '../../types/custom/context';
import { PlatformAdministratorAuthority } from '../../types/custom/platform-authority';
import { Tenant } from '../../types/custom/tenant';
import { AppRpc } from './effect-rpc-angular-client';

@Injectable({
  providedIn: 'root',
})
export class ConfigService {
  public readonly permissionsSignal = signal<Permission[]>([]);
  public readonly platformAuthoritySignal =
    signal<null | PlatformAdministratorAuthority>(null);
  public readonly tenantSignal = signal<null | Tenant>(null);

  public get missingContext() {
    return this._missingContext;
  }

  public get permissions(): Permission[] {
    return this.permissionsSignal();
  }

  public get platformAuthority(): null | PlatformAdministratorAuthority {
    return this.platformAuthoritySignal();
  }

  public get publicConfig() {
    return this._publicConfig;
  }

  public get tenant(): Tenant {
    return this._tenant;
  }
  private _missingContext = false;

  private _publicConfig: {
    googleMapsApiKey: null | string;
  } = {
    googleMapsApiKey: null,
  };
  private _tenant!: Tenant;

  private readonly rpc = AppRpc.injectClient();

  private currentTenantQuery = injectQuery(() =>
    this.rpc.config.tenant.queryOptions(),
  );

  private document = inject(DOCUMENT);
  private readonly meta = inject(Meta);

  private readonly platformId = inject(PLATFORM_ID);

  private renderer = inject(RendererFactory2).createRenderer(null, null);
  private readonly requestContext = inject(REQUEST_CONTEXT) as Context | null;

  private readonly title = inject(Title);

  constructor() {
    effect(() => {
      const currentTenant = this.currentTenantQuery.data();
      if (currentTenant) {
        const previousTenant = this.tenantSignal();
        if (previousTenant) {
          this.renderer.removeClass(
            this.document.documentElement,
            `theme-${previousTenant.theme}`,
          );
        }
        this.applyTenantConfig(currentTenant);
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

    if (this.requestContext !== null && isPlatformServer(this.platformId)) {
      this.applyTenantConfig(this.requestContext.tenant);
      this.permissionsSignal.set([...this.requestContext.permissions]);
      this.platformAuthoritySignal.set(
        this.requestContext.platformAuthority ?? null,
      );
      this._publicConfig = await this.rpc.config.public.call();
      return;
    }

    const [tenant, permissions, platformAuthority, pub] = await Promise.all([
      this.rpc.config.tenant.call(),
      this.rpc.config.permissions.call(),
      this.rpc.config.platformAuthority.call(),
      this.rpc.config.public.call(),
    ]);

    this.applyTenantConfig(tenant);
    this.permissionsSignal.set([...permissions]);
    this.platformAuthoritySignal.set(platformAuthority);

    this._publicConfig = pub;
  }

  public updateDescription(description: string): void {
    this.meta.updateTag({ content: description, name: 'description' });
  }

  public updateTitle(title: string): void {
    this.title.setTitle(`${title} | ${this.tenant.name}`);
  }

  private applyTenantConfig(tenant: Tenant): void {
    this._tenant = tenant;
    this.tenantSignal.set(tenant);
    this.title.setTitle(tenant.seoTitle ?? tenant.name);
    this.updateFavicon(tenant.faviconUrl ?? 'favicon.ico');
    if (tenant.seoDescription) {
      this.updateDescription(tenant.seoDescription);
    } else {
      this.meta.removeTag("name='description'");
    }
  }

  private updateFavicon(href: string): void {
    const existingIcon =
      this.document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const icon = existingIcon ?? this.renderer.createElement('link');

    this.renderer.setAttribute(icon, 'rel', 'icon');
    this.renderer.setAttribute(icon, 'href', href);
    if (!existingIcon) {
      this.renderer.appendChild(this.document.head, icon);
    }
  }
}
