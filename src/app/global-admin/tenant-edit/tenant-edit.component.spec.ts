import type { ComponentFixture } from '@angular/core/testing';
import type {
  GlobalAdminTenantRecord,
  GlobalAdminTenantUpdateInput,
} from '@shared/rpc-contracts/app-rpcs/global-admin.rpcs';

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
  const save =
    vi.fn<
      (input: GlobalAdminTenantUpdateInput) => Promise<GlobalAdminTenantRecord>
    >();
  const releases: (() => void)[] = [];
  const showError = vi.fn();
  let initialTenant: GlobalAdminTenantRecord;
  let queryClient: QueryClient;
  let fixture: ComponentFixture<TenantEditComponent> | undefined;

  beforeEach(async () => {
    releases.length = 0;
    loadTenant.mockReset();
    save.mockReset();
    showError.mockReset();
    initialTenant = {
      currency: 'EUR',
      domain: 'tenant.example.test',
      id: 'tenant-1',
      name: 'Original name',
      paymentsConfigured: false,
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

  afterEach(async () => {
    for (const release of releases) release();
    fixture?.destroy();
    await queryClient.cancelQueries();
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

  const hold = <Value>(value: Value) => {
    const response = new Subject<Value>();
    const promise = firstValueFrom(response);
    const resolve = () => {
      response.next(value);
      response.complete();
    };
    releases.push(resolve);
    return { promise, resolve };
  };

  const editForm = (rendered: ComponentFixture<TenantEditComponent>) => {
    const name: HTMLInputElement | null =
      rendered.nativeElement.querySelector('input');
    const reason: HTMLTextAreaElement | null =
      rendered.nativeElement.querySelector('textarea');
    const form: HTMLFormElement | null =
      rendered.nativeElement.querySelector('form');
    const button = form?.querySelector('button[type="submit"]');
    if (!name || !reason || !form || !(button instanceof HTMLButtonElement))
      throw new Error('Tenant edit form not rendered');
    return { button, form, name, reason };
  };

  const enter = (
    input: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const submitForm = (form: HTMLFormElement) => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  };

  it('shows and preserves a saved time zone outside the standard choices', async () => {
    initialTenant = { ...initialTenant, timezone: 'America/New_York' };
    loadTenant.mockResolvedValue(initialTenant);
    save.mockResolvedValue(initialTenant);
    const rendered = await render();
    const root: unknown = rendered.nativeElement;
    if (!(root instanceof HTMLElement)) throw new Error('Expected tenant form');
    const field = [...root.querySelectorAll('mat-form-field')].find(
      (element) =>
        element.querySelector('mat-label')?.textContent?.trim() === 'Time zone',
    );
    await vi.waitFor(() => {
      rendered.detectChanges();
      expect(field?.querySelector('mat-select')?.textContent).toContain(
        'New York time',
      );
    });
    const { form, reason } = editForm(rendered);
    enter(reason, 'Verify existing settings');
    submitForm(form);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      expectedSettings: platformTenantSettingsSnapshot(initialTenant),
      tenant: { timezone: 'America/New_York' },
    });
    await rendered.whenStable();
  });

  it('keeps Save disabled through both refreshes and navigation, then advances the next save snapshot', async () => {
    const saved = { ...initialTenant, name: 'Saved organization' };
    const mutation = hold(saved);
    const listRefresh = hold(undefined);
    const detailRefresh = hold(undefined);
    const navigation = hold(false);
    save.mockReturnValueOnce(mutation.promise);
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockReturnValueOnce(listRefresh.promise)
      .mockReturnValueOnce(detailRefresh.promise)
      .mockResolvedValue();
    const navigate = vi.mocked(TestBed.inject(Router).navigate);
    navigate.mockReturnValueOnce(navigation.promise).mockResolvedValue(false);
    const rendered = await render();
    const { button, form, name, reason } = editForm(rendered);
    enter(name, saved.name);
    enter(reason, 'Correct organization name');
    submitForm(form);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    const assertSaveStillPending = () => {
      rendered.detectChanges();
      expect(button.disabled).toBe(true);
      submitForm(form);
      expect(save).toHaveBeenCalledOnce();
    };
    assertSaveStillPending();

    mutation.resolve();
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenNthCalledWith(1, { queryKey: ['tenants'] });
    assertSaveStillPending();
    expect(navigate).not.toHaveBeenCalled();

    listRefresh.resolve();
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenNthCalledWith(2, { queryKey: ['tenant'] });
    assertSaveStillPending();
    expect(navigate).not.toHaveBeenCalled();

    detailRefresh.resolve();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(navigate).toHaveBeenCalledWith([
      '/global-admin/tenants',
      initialTenant.id,
    ]);
    assertSaveStillPending();

    navigation.resolve();
    await vi.waitFor(() => {
      rendered.detectChanges();
      expect(button.disabled).toBe(false);
    });
    enter(name, 'Second saved name');
    enter(reason, 'Save another correction');
    save.mockResolvedValueOnce({ ...saved, name: 'Second saved name' });
    submitForm(form);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      expectedSettings: platformTenantSettingsSnapshot(saved),
      id: initialTenant.id,
      reason: 'Save another correction',
      tenant: { name: 'Second saved name' },
    });
    await vi.waitFor(() => {
      rendered.detectChanges();
      expect(button.disabled).toBe(false);
    });
    expect(showError).not.toHaveBeenCalled();
  });

  it.each(['mutation', 'refresh'] as const)(
    'preserves edits made during %s and uses the saved snapshot for the next save',
    async (stage) => {
      const saved = { ...initialTenant, name: 'Submitted name' };
      const mutation = hold(saved);
      const refresh = hold(undefined);
      save.mockReturnValueOnce(mutation.promise);
      const invalidate = vi
        .spyOn(queryClient, 'invalidateQueries')
        .mockReturnValueOnce(refresh.promise)
        .mockResolvedValue();
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockResolvedValue(false);
      const rendered = await render();
      const { button, form, name, reason } = editForm(rendered);
      enter(name, saved.name);
      enter(reason, 'Save submitted name');
      submitForm(form);
      await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
      if (stage === 'refresh') {
        mutation.resolve();
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
      }
      enter(name, 'Newer unsaved name');
      enter(reason, 'Keep my newer explanation');
      mutation.resolve();
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
      refresh.resolve();
      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(button.disabled).toBe(false);
      });
      expect(name.value).toBe('Newer unsaved name');
      expect(reason.value).toBe('Keep my newer explanation');
      expect(navigate).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(['tenant', initialTenant.id])).toEqual(
        saved,
      );

      save.mockResolvedValueOnce({ ...saved, name: 'Newer unsaved name' });
      submitForm(form);
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1]?.[0]).toMatchObject({
        expectedSettings: platformTenantSettingsSnapshot(saved),
        reason: 'Keep my newer explanation',
        tenant: { name: 'Newer unsaved name' },
      });
      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(button.disabled).toBe(false);
      });
      expect(form.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it.each(['mutation', 'refresh'] as const)(
    'does not replace or navigate another tenant when the first save finishes during %s',
    async (stage) => {
      const saved = { ...initialTenant, name: 'Saved first organization' };
      const mutation = hold(saved);
      const refresh = hold(undefined);
      save.mockReturnValueOnce(mutation.promise);
      const invalidate = vi
        .spyOn(queryClient, 'invalidateQueries')
        .mockReturnValueOnce(refresh.promise)
        .mockResolvedValue();
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      navigate.mockResolvedValue(false);
      const rendered = await render();
      const first = editForm(rendered);
      enter(first.name, saved.name);
      enter(first.reason, 'Save first organization');
      submitForm(first.form);
      await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
      if (stage === 'refresh') {
        mutation.resolve();
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
      }

      const nextTenant = {
        ...initialTenant,
        domain: 'second.example.test',
        id: 'tenant-2',
        name: 'Second organization',
      };
      loadTenant.mockResolvedValue(nextTenant);
      rendered.componentRef.setInput('tenantId', nextTenant.id);
      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(editForm(rendered).name.value).toBe(nextTenant.name);
      });
      const second = editForm(rendered);
      enter(second.name, 'Second organization draft');
      enter(second.reason, 'Save second organization draft');
      mutation.resolve();
      await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
      refresh.resolve();
      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(second.button.disabled).toBe(false);
      });
      expect(second.name.value).toBe('Second organization draft');
      expect(second.reason.value).toBe('Save second organization draft');
      expect(second.form.querySelector('[role="alert"]')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(queryClient.getQueryData(['tenant', initialTenant.id])).toEqual(
        saved,
      );

      save.mockResolvedValueOnce({
        ...nextTenant,
        name: 'Second organization draft',
      });
      submitForm(second.form);
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      expect(save.mock.calls[1]?.[0]).toMatchObject({
        expectedSettings: platformTenantSettingsSnapshot(nextTenant),
        id: nextTenant.id,
        tenant: { name: 'Second organization draft' },
      });
      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(second.button.disabled).toBe(false);
      });
      expect(navigate).toHaveBeenCalledExactlyOnceWith([
        '/global-admin/tenants',
        nextTenant.id,
      ]);
    },
  );

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
