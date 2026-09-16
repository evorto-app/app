import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import {
  includesPermission,
  type Permission,
} from '@shared/permissions/permissions';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../config.service';
import { PermissionsService } from '../permissions.service';
import {
  mobileMoreNavigationAvailable,
  mobileMoreNavigationLabel,
  mobileMoreNavigationSheetConfig,
  NavigationComponent,
  NavigationOperations,
} from './navigation.component';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

@Component({ template: '' })
class TestRouteComponent {}

describe('mobileMoreNavigationAvailable', () => {
  const unavailable = {
    hasFinancePermission: false,
    hasInternalPermission: false,
    hasPlatformAuthority: false,
    hasTenantAdminPermission: false,
  } as const;

  it.each([
    ['platform administration', { hasPlatformAuthority: true }],
    ['tenant administration', { hasTenantAdminPermission: true }],
    ['finance', { hasFinancePermission: true }],
    ['Members Hub', { hasInternalPermission: true }],
  ] as const)('keeps mobile %s reachable', (_, availableDestination) => {
    expect(
      mobileMoreNavigationAvailable({
        ...unavailable,
        ...availableDestination,
      }),
    ).toBe(true);
  });

  it('hides an empty menu', () => {
    expect(mobileMoreNavigationAvailable(unavailable)).toBe(false);
  });
});

describe('mobile more navigation template', () => {
  const template = readSource(
    'src/app/core/navigation/navigation.component.html',
  );

  it('uses named navigation landmarks and current-page semantics', () => {
    expect(template).toContain('aria-label="Main navigation"');
    expect(template).toContain('aria-label="More navigation"');
    expect(template).toContain('ariaCurrentWhenActive="page"');
  });

  it('uses the combined destination decision for the mobile sheet trigger', () => {
    const moreButton = template.slice(
      template.indexOf('@if (mobileMoreNavigationAvailable())'),
      template.indexOf('@if (scannerAccessQuery.data())'),
    );

    expect(moreButton).toContain('<span class="body-medium text-center">More');
    expect(moreButton).not.toContain('*appIfAnyPermission');
  });

  it('uses a vertical Material navigation list that remains usable at narrow widths', () => {
    const sheet = template.slice(template.indexOf('<ng-template'));

    expect(sheet).toContain('class="grid w-full gap-1 p-3"');
    expect(sheet).toContain('min-h-12 items-center');
    expect(sheet).not.toContain('flex-row justify-around');
    expect(sheet).not.toContain('routerLink="/scan"');
  });

  it('lets every compact destination share a 320px navigation bar without overflow', () => {
    const mainNavigation = template.slice(0, template.indexOf('<ng-template'));

    expect(mainNavigation).toContain('flex-row gap-0');
    expect(mainNavigation).not.toContain('justify-around gap-2');
    expect(
      mainNavigation.match(/min-w-0 flex-1/gu)?.length,
    ).toBeGreaterThanOrEqual(6);
    expect(mainNavigation).toContain('w-16 max-w-full');
  });

  it('gives the bottom-sheet dialog an accessible name', () => {
    expect(mobileMoreNavigationLabel).toBe('More navigation');
    expect(mobileMoreNavigationSheetConfig).toEqual({
      ariaLabel: 'More navigation',
    });
  });
});

describe('NavigationComponent accessibility', () => {
  const platformAuthoritySignal = signal<null | {
    readonly actorEmail: string;
    readonly actorId: string;
    readonly kind: 'platformAdministrator';
  }>(null);
  const grantedPermissions = signal<readonly Permission[]>([]);
  let queryClient: QueryClient;

  beforeEach(async () => {
    platformAuthoritySignal.set({
      actorEmail: 'platform@example.test',
      actorId: 'platform-test',
      kind: 'platformAdministrator',
    });
    grantedPermissions.set([]);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [NavigationComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([{ component: TestRouteComponent, path: 'events' }]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: { platformAuthoritySignal },
        },
        {
          provide: NavigationOperations,
          useValue: {
            authenticationQueryOptions: () => ({
              queryFn: async () => true,
              queryKey: ['navigation-authentication'],
            }),
            scannerAccessQueryOptions: () => ({
              queryFn: async () => false,
              queryKey: ['navigation-scanner-access'],
            }),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermissionSync: (permission: Permission) =>
              includesPermission(permission, grantedPermissions()),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatBottomSheet).dismiss();
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders a named main navigation landmark and marks the current route', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/events');
    const fixture = TestBed.createComponent(NavigationComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    const navigation = root.querySelector<HTMLElement>(
      'nav[aria-label="Main navigation"]',
    );
    const eventsLink =
      navigation?.querySelector<HTMLAnchorElement>('a[href="/events"]');

    expect(navigation).not.toBeNull();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(eventsLink?.getAttribute('aria-current')).toBe('page');
    });
  });

  it('opens a named vertical navigation sheet for a platform-only principal', async () => {
    const fixture = TestBed.createComponent(NavigationComponent);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    const moreButton = [...root.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('More'),
    );
    moreButton?.click();
    fixture.detectChanges();

    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    await vi.waitFor(() => {
      const dialog = overlay.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-label')).toBe('More navigation');
      expect(
        dialog?.querySelector('nav[aria-label="More navigation"]'),
      ).not.toBeNull();
      expect(
        dialog?.querySelector('a[href="/global-admin"]')?.textContent,
      ).toContain('Platform admin');
    });
  });

  it.each([
    ['finance', 'finance:approveReceipts', '/finance', 'Finances'],
    ['Members Hub', 'internal:viewInternalPages', '/internal', 'Members Hub'],
  ] as const)(
    'keeps %s reachable in the rendered mobile sheet without admin permission',
    async (_, permission, expectedHref, expectedLabel) => {
      platformAuthoritySignal.set(null);
      grantedPermissions.set([permission]);
      const fixture = TestBed.createComponent(NavigationComponent);
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;

      const moreButton = [...root.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('More'),
      );
      expect(moreButton).toBeDefined();
      moreButton?.click();
      fixture.detectChanges();

      const overlay = TestBed.inject(OverlayContainer).getContainerElement();
      await vi.waitFor(() => {
        expect(
          overlay.querySelector(`a[href="${CSS.escape(expectedHref)}"]`)
            ?.textContent,
        ).toContain(expectedLabel);
      });
    },
  );
});
