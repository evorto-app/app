import type { ComponentFixture } from '@angular/core/testing';
import type { GlobalAdminTenantRecord } from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  platformTenantSettingsSnapshot,
  tenantSettingsConflict,
} from '@shared/tenant-settings-snapshot';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TenantEditComponent } from './tenant-edit.component';

describe('platform tenant stale-edit recovery', () => {
  const loadTenant = vi.fn<() => Promise<GlobalAdminTenantRecord>>();
  const save = vi.fn();
  const showError = vi.fn();
  let initialTenant: GlobalAdminTenantRecord;
  let queryClient: QueryClient;
  let fixture: ComponentFixture<TenantEditComponent> | undefined;

  beforeEach(async () => {
    loadTenant.mockReset();
    save.mockReset();
    showError.mockReset();
    initialTenant = {
      currency: 'EUR',
      domain: 'tenant.example.test',
      id: 'tenant-1',
      name: 'Original name',
      stripeAccountId: null,
      stripeConnected: false,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    };
    loadTenant.mockResolvedValue(initialTenant);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    await TestBed.configureTestingModule({
      imports: [TenantEditComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            globalAdmin: {
              tenants: {
                findOne: {
                  queryOptions: ({ id }: { id: string }) => ({
                    queryFn: loadTenant,
                    queryKey: ['tenant', id],
                  }),
                },
                update: {
                  mutationOptions: () => ({ mutationFn: save }),
                },
              },
            },
            queryFilter: (path: readonly string[]) => ({
              queryKey: [path[1] === 'tenants.findOne' ? 'tenant' : 'tenants'],
            }),
          },
        },
        {
          provide: NotificationService,
          useValue: { showError, showSuccess: vi.fn() },
        },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    fixture?.destroy();
    queryClient.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const render = async () => {
    const rendered = TestBed.createComponent(TenantEditComponent);
    fixture = rendered;
    rendered.componentRef.setInput('tenantId', 'tenant-1');
    rendered.detectChanges();
    await vi.waitFor(() => {
      rendered.detectChanges();
      expect(rendered.nativeElement.querySelector('form')).not.toBeNull();
    });
    return rendered;
  };

  it('sends the original snapshot after refetch, keeps rejected edits, and requires explicit reload before another save', async () => {
    const rendered = await render();
    const name: HTMLInputElement | null =
      rendered.nativeElement.querySelector('input');
    const reason: HTMLTextAreaElement | null =
      rendered.nativeElement.querySelector('textarea');
    const form: HTMLFormElement | null =
      rendered.nativeElement.querySelector('form');
    if (!name || !reason || !form)
      throw new Error('Tenant edit form not rendered');
    name.value = 'Unsaved name';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    reason.value = 'Correct organization name';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    const latest = { ...initialTenant, name: 'Changed elsewhere' };
    loadTenant.mockResolvedValue(latest);
    await queryClient.invalidateQueries({ queryKey: ['tenant', 'tenant-1'] });
    await rendered.whenStable();
    rendered.detectChanges();
    expect(name.value).toBe('Unsaved name');

    save.mockRejectedValueOnce(tenantSettingsConflict());
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(showError).toHaveBeenCalledExactlyOnceWith(
        tenantSettingsConflict().message,
      ),
    );
    rendered.detectChanges();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      expectedSettings: platformTenantSettingsSnapshot(initialTenant),
      id: initialTenant.id,
      reason: 'Correct organization name',
      tenant: { name: 'Unsaved name' },
    });
    expect(name.value).toBe('Unsaved name');
    expect(reason.value).toBe('Correct organization name');
    const saveButton: HTMLButtonElement | null = form.querySelector(
      'button[type="submit"]',
    );
    expect(saveButton?.disabled).toBe(true);
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await rendered.whenStable();
    expect(save).toHaveBeenCalledOnce();

    const location = TestBed.inject(DOCUMENT).defaultView?.location;
    if (!location) throw new Error('Browser document location unavailable');
    const reload = vi.spyOn(location, 'reload').mockImplementation(vi.fn());
    const reloadButton: HTMLButtonElement | null = form.querySelector(
      ':scope [role="alert"] button',
    );
    if (!reloadButton) throw new Error('Conflict reload action not rendered');
    expect(
      form
        .querySelector('[role="alert"]')
        ?.textContent?.replaceAll(/\s+/g, ' '),
    ).toContain('Copy any edits you want to keep before reloading.');
    reloadButton.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(saveButton?.disabled).toBe(true);
    rendered.destroy();

    const reloaded = await render();
    const freshName: HTMLInputElement | null =
      reloaded.nativeElement.querySelector('input');
    const freshReason: HTMLTextAreaElement | null =
      reloaded.nativeElement.querySelector('textarea');
    const freshForm: HTMLFormElement | null =
      reloaded.nativeElement.querySelector('form');
    if (!freshName || !freshReason || !freshForm)
      throw new Error('Reloaded edit form not rendered');
    expect(freshName.value).toBe('Changed elsewhere');
    freshReason.value = 'Confirm current organization name';
    freshReason.dispatchEvent(new Event('input', { bubbles: true }));
    save.mockResolvedValueOnce(latest);
    freshForm.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      expectedSettings: platformTenantSettingsSnapshot(latest),
      tenant: { name: 'Changed elsewhere' },
    });
    await reloaded.whenStable();
  });

  it('does not block another tenant when the previous tenant save reports a late conflict', async () => {
    const updateResponse = new Subject<GlobalAdminTenantRecord>();
    save.mockReturnValueOnce(firstValueFrom(updateResponse));
    const rendered = await render();
    const reason: HTMLTextAreaElement | null =
      rendered.nativeElement.querySelector('textarea');
    const originalForm: HTMLFormElement | null =
      rendered.nativeElement.querySelector('form');
    if (!reason || !originalForm)
      throw new Error('Tenant edit form not rendered');
    reason.value = 'Update the first organization';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    originalForm.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());

    const nextTenant = {
      ...initialTenant,
      domain: 'second.example.test',
      id: 'tenant-2',
      name: 'Second organization',
    };
    loadTenant.mockResolvedValue(nextTenant);
    rendered.componentRef.setInput('tenantId', nextTenant.id);
    rendered.detectChanges();
    await vi.waitFor(() => {
      rendered.detectChanges();
      const name: HTMLInputElement | null =
        rendered.nativeElement.querySelector('input');
      expect(name?.value).toBe('Second organization');
    });
    const nextReason: HTMLTextAreaElement | null =
      rendered.nativeElement.querySelector('textarea');
    const nextForm: HTMLFormElement | null =
      rendered.nativeElement.querySelector('form');
    if (!nextReason || !nextForm)
      throw new Error('Second tenant form not rendered');
    nextReason.value = 'Update the second organization';
    nextReason.dispatchEvent(new Event('input', { bubbles: true }));

    updateResponse.error(tenantSettingsConflict());
    await rendered.whenStable();
    rendered.detectChanges();
    expect(showError).toHaveBeenCalledExactlyOnceWith(
      tenantSettingsConflict().message,
    );
    expect(nextForm.querySelector('[role="alert"]')).toBeNull();
    const saveButton: HTMLButtonElement | null = nextForm.querySelector(
      'button[type="submit"]',
    );
    if (!saveButton) throw new Error('Second tenant save action not rendered');
    expect(saveButton.disabled).toBe(false);

    save.mockResolvedValueOnce(nextTenant);
    nextForm.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      expectedSettings: platformTenantSettingsSnapshot(nextTenant),
      id: nextTenant.id,
      tenant: { name: nextTenant.name },
    });
    await rendered.whenStable();
  });
});
