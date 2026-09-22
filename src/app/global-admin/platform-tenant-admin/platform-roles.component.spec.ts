import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MatInputHarness } from '@angular/material/input/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { PlatformRoleRecord } from '@shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notification.service';
import {
  PlatformRolesComponent,
  PlatformRolesOperations,
} from './platform-roles.component';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

describe('platform role permission editing', () => {
  const storedRole = PlatformRoleRecord.make({
    defaultOrganizerRole: false,
    defaultUserRole: false,
    description: null,
    displayInHub: false,
    id: 'role-admin',
    name: 'Administrator',
    permissions: ['admin:*', 'users:*'],
    sortOrder: 0,
  });
  const taxRole = PlatformRoleRecord.make({
    ...storedRole,
    id: 'role-tax',
    name: 'Tax manager',
    permissions: ['admin:manageTaxes'],
  });
  const creatorRole = PlatformRoleRecord.make({
    ...storedRole,
    id: 'role-creator',
    name: 'Event creator',
    permissions: ['events:create'],
  });
  const createRole = vi.fn();
  const updateRole = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    createRole.mockReset().mockResolvedValue(storedRole);
    updateRole.mockReset().mockResolvedValue(storedRole);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformRolesComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformRolesComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformRolesOperations,
          useValue: {
            create: () => ({ mutationFn: createRole }),
            delete: () => ({ mutationFn: vi.fn() }),
            list: () => ({
              queryFn: async () => [storedRole, taxRole, creatorRole],
              queryKey: ['platform-roles', 'tenant-1'],
            }),
            rolesFilter: () => ({ queryKey: ['platform-roles'] }),
            update: () => ({ mutationFn: updateRole }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  const render = async (roleName: string) => {
    const fixture = TestBed.createComponent(PlatformRolesComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(roleName);
    });
    const root: HTMLElement = fixture.nativeElement;
    const roleButton = [...root.querySelectorAll('button[mat-list-item]')].find(
      (button) => button.textContent?.includes(roleName),
    );
    if (!(roleButton instanceof HTMLButtonElement))
      throw new Error('Expected the role edit action');
    roleButton.click();
    await fixture.whenStable();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const permissions = await loader.getHarness(MatSelectHarness);
    const reason = await loader.getHarness(
      MatInputHarness.with({ selector: 'textarea' }),
    );
    await reason.setValue('Correct organization capabilities');
    const save = await loader.getHarness(
      MatButtonHarness.with({ text: 'Save role' }),
    );
    return { loader, permissions, save };
  };

  it('shows effective wildcard grants and retains them when adding an unrelated permission', async () => {
    const { permissions, save } = await render('Administrator');
    expect(await permissions.getValueText()).toContain('Manage roles');
    expect(await permissions.getValueText()).toContain(
      'Assign all member roles (organization admin)',
    );
    await permissions.clickOptions({ text: 'See draft events' });
    await permissions.close();
    await save.click();
    await vi.waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: ['admin:*', 'users:*', 'events:seeDrafts'],
          roleId: storedRole.id,
          targetTenantId: 'tenant-1',
        }),
        expect.anything(),
      ),
    );
  });

  it('expands only the wildcard whose visible capability is explicitly revoked', async () => {
    const { permissions, save } = await render('Administrator');
    await permissions.open();
    const [taxPermission] = await permissions.getOptions({
      text: 'Manage tax rates',
    });
    expect(await taxPermission.isSelected()).toBe(true);
    await taxPermission.click();
    await permissions.close();
    await save.click();
    await vi.waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: ['users:*', 'admin:manageRoles', 'admin:changeSettings'],
        }),
        expect.anything(),
      ),
    );
  });

  it('preserves legacy tax authority while another permission is selected', async () => {
    const { permissions, save } = await render('Tax manager');
    expect(await permissions.getValueText()).toContain('Manage tax rates');
    await permissions.clickOptions({ text: 'See draft events' });
    await permissions.close();
    await save.click();
    await vi.waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: ['admin:manageTaxes', 'events:seeDrafts'],
          roleId: taxRole.id,
        }),
        expect.anything(),
      ),
    );
  });

  it('revokes the legacy grant when its visible tax permission is deselected', async () => {
    const { permissions, save } = await render('Tax manager');
    await permissions.open();
    const [taxPermission] = await permissions.getOptions({
      text: 'Manage tax rates',
    });
    expect(await taxPermission.isSelected()).toBe(true);
    await taxPermission.click();
    await permissions.close();
    await save.click();
    await vi.waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: [] }),
        expect.anything(),
      ),
    );
  });
  it('locks included permissions until their parent permission is removed', async () => {
    const { permissions, save } = await render('Event creator');
    await permissions.open();
    const [viewTemplates] = await permissions.getOptions({
      text: 'View templates',
    });
    const [createEvents] = await permissions.getOptions({
      text: 'Create events',
    });
    expect(await viewTemplates.isSelected()).toBe(true);
    expect(await viewTemplates.isDisabled()).toBe(true);
    await viewTemplates.click();
    expect(await viewTemplates.isSelected()).toBe(true);
    await createEvents.click();
    expect(await viewTemplates.isDisabled()).toBe(false);
    await viewTemplates.click();
    expect(await viewTemplates.isSelected()).toBe(false);
    await permissions.close();
    await save.click();
    await vi.waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: [], roleId: creatorRole.id }),
        expect.anything(),
      ),
    );
  });

  it('shows and locks permissions implied by a newly selected parent', async () => {
    const { permissions, save } = await render('Tax manager');
    await permissions.clickOptions({ text: 'Create events' });
    const [viewTemplates] = await permissions.getOptions({
      text: 'View templates',
    });
    expect(await viewTemplates.isSelected()).toBe(true);
    expect(await viewTemplates.isDisabled()).toBe(true);
    await permissions.close();
    await save.click();
    await vi.waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: expect.arrayContaining([
            'events:create',
            'templates:view',
          ]),
          roleId: taxRole.id,
        }),
        expect.anything(),
      ),
    );
  });
});
