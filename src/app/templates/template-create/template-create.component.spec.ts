import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { TemplateGraphEditorComponent } from '../../shared/components/forms/template-graph-editor/template-graph-editor.component';
import { TemplateRegistrationOptionEditorComponent } from '../../shared/components/forms/template-graph-editor/template-registration-option-editor.component';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';
import { TemplateCreateComponent } from './template-create.component';

type RoleQueryOptions = RpcClient['roles']['findMany']['queryOptions'];
type RpcClient = ReturnType<typeof AppRpc.injectClient>;

const roleCatalog: readonly RoleLookupRecord[] = [
  {
    defaultOrganizerRole: false,
    defaultUserRole: false,
    id: 'ordinary',
    name: 'Ordinary',
  },
  {
    defaultOrganizerRole: true,
    defaultUserRole: false,
    id: 'organizer',
    name: 'Organizer',
  },
  {
    defaultOrganizerRole: false,
    defaultUserRole: true,
    id: 'participant',
    name: 'Participant',
  },
  {
    defaultOrganizerRole: true,
    defaultUserRole: true,
    id: 'both',
    name: 'Both',
  },
];
const rolesKey = [['roles', 'findMany'], { input: {}, type: 'query' }] as const;
const findRoles = vi.fn<() => Promise<readonly RoleLookupRecord[]>>();
const roleQueryOptions = vi.fn(
  (input: Parameters<RoleQueryOptions>[0]): ReturnType<RoleQueryOptions> => ({
    queryFn: findRoles,
    queryKey: [['roles', 'findMany'], { input, type: 'query' }],
  }),
);

const tenant = new ClientTenantConfig({
  cancellationDeadlineHoursBeforeStart: 24,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'tenant.example.test',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 3,
  name: 'Tenant',
  paymentsConfigured: true,
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: false,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 24,
});

const graphEditor = (fixture: ComponentFixture<TemplateCreateComponent>) => {
  const element = fixture.debugElement.query(
    By.directive(TemplateGraphEditorComponent),
  );
  if (!element)
    throw new Error('Expected the template graph editor to render.');
  return element.injector.get(TemplateGraphEditorComponent);
};

describe('TemplateCreateComponent role catalog defaults', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findRoles.mockReset().mockResolvedValue(roleCatalog);
    roleQueryOptions.mockClear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    TestBed.overrideComponent(TemplateGeneralFormComponent, {
      set: {
        template:
          '<input aria-label="Template title" [formField]="generalForm().title" />',
      },
    });
    TestBed.overrideComponent(TemplateRegistrationOptionEditorComponent, {
      set: { template: '' },
    });
    await TestBed.configureTestingModule({
      imports: [TemplateCreateComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: ConfigService,
          useValue: {
            tenantSignal: signal<ClientTenantConfig | null>(tenant),
          } satisfies Pick<ConfigService, 'tenantSignal'>,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            discounts: {
              getTenantProviders: {
                queryOptions: (): ReturnType<
                  RpcClient['discounts']['getTenantProviders']['queryOptions']
                > => ({
                  queryFn: async () => [],
                  queryKey: [
                    ['discounts', 'getTenantProviders'],
                    { type: 'query' },
                  ],
                }),
              },
            },
            roles: { findMany: { queryOptions: roleQueryOptions } },
            taxRates: {
              listActive: {
                queryOptions: (): ReturnType<
                  RpcClient['taxRates']['listActive']['queryOptions']
                > => ({
                  queryFn: async () => [],
                  queryKey: [['taxRates', 'listActive'], { type: 'query' }],
                }),
              },
            },
            templateCategories: {
              findMany: {
                queryOptions: (): ReturnType<
                  RpcClient['templateCategories']['findMany']['queryOptions']
                > => ({
                  queryFn: async () => [],
                  queryKey: [
                    ['templateCategories', 'findMany'],
                    { type: 'query' },
                  ],
                }),
              },
            },
            templates: {
              create: {
                mutationOptions: (): ReturnType<
                  RpcClient['templates']['create']['mutationOptions']
                > => ({
                  mutationFn: async () => {
                    throw new Error('Creation is outside this defaults test.');
                  },
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    queryClient.clear();
  });

  it('seeds organizer and participant options from their flags after one catalog query', async () => {
    const fixture = TestBed.createComponent(TemplateCreateComponent);
    fixture.componentRef.setInput('categoryId', 'category-1');
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(TemplateGraphEditorComponent)),
    ).toBeNull();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        graphEditor(fixture).graphForm()().value().registrationOptions,
      ).toEqual([
        expect.objectContaining({
          organizingRegistration: true,
          roleIds: ['organizer', 'both'],
        }),
        expect.objectContaining({
          organizingRegistration: false,
          roleIds: ['participant', 'both'],
        }),
      ]);
    });
    const editor = graphEditor(fixture);
    expect(editor.defaultParticipantRoleIds()).toEqual(['participant', 'both']);
    expect(editor.graphForm().categoryId().value()).toBe('category-1');
    expect(roleQueryOptions).toHaveBeenCalledExactlyOnceWith({});
    expect(findRoles).toHaveBeenCalledOnce();
  });

  it('shows a catalog error and seeds defaults after clicking retry', async () => {
    const rolesResponse = new Subject<readonly RoleLookupRecord[]>();
    findRoles
      .mockRejectedValueOnce(new Error('Role catalog unavailable'))
      .mockReturnValueOnce(firstValueFrom(rolesResponse));
    const fixture = TestBed.createComponent(TemplateCreateComponent);
    fixture.componentRef.setInput('categoryId', 'category-1');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    try {
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(
          'Roles could not be loaded',
        );
        expect(root.textContent).not.toContain('Preparing template defaults');
      });
      expect(
        fixture.debugElement.query(By.directive(TemplateGraphEditorComponent)),
      ).toBeNull();
      const retry = root.querySelector<HTMLButtonElement>(
        '[data-testid="retry-template-roles"]',
      );
      if (!retry) throw new Error('Expected role catalog retry button');
      retry.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(findRoles).toHaveBeenCalledTimes(2);
        expect(root.querySelector('[role="status"]')?.textContent).toContain(
          'Loading roles',
        );
        expect(
          root.querySelector('[data-testid="retry-template-roles"]'),
        ).toBeNull();
      });
      rolesResponse.next(roleCatalog);
      rolesResponse.complete();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          graphEditor(fixture)
            .graphForm()()
            .value()
            .registrationOptions.map((option) => option.roleIds),
        ).toEqual([
          ['organizer', 'both'],
          ['participant', 'both'],
        ]);
        expect(
          root.querySelector('[data-testid="retry-template-roles"]'),
        ).toBeNull();
      });
      expect(graphEditor(fixture).graphForm().categoryId().value()).toBe(
        'category-1',
      );
      expect(findRoles).toHaveBeenCalledTimes(2);
    } finally {
      rolesResponse.next(roleCatalog);
      rolesResponse.complete();
    }
  });

  it('keeps the edited draft mounted through a failed refresh and a real retry', async () => {
    const fixture = TestBed.createComponent(TemplateCreateComponent);
    fixture.componentRef.setInput('categoryId', 'category-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(graphEditor(fixture).defaultParticipantRoleIds()).toEqual([
        'participant',
        'both',
      ]);
    });
    const editor = graphEditor(fixture);
    const form = editor.graphForm();
    const title = fixture.nativeElement.querySelector(
      'input[aria-label="Template title"]',
    );
    if (!(title instanceof HTMLInputElement))
      throw new Error('Expected template title input');
    title.value = 'My edited title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    form.description().value.set('<p>My draft description</p>');
    form.icon().value.set({ iconColor: 2, iconName: 'calendar:fas' });
    form.categoryId().value.set('chosen-category');
    form
      .registrationOptions()
      .value.update((options) =>
        options.map((option) => ({ ...option, roleIds: ['ordinary'] })),
      );
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const save = root.querySelector<HTMLButtonElement>(
      '[data-testid="save-template-graph"]',
    );
    if (!save) throw new Error('Expected save template button');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(save.disabled).toBe(false);
    });
    const draft = structuredClone(form().value());
    findRoles.mockRejectedValueOnce(new Error('Refresh failed'));
    await queryClient.invalidateQueries({ queryKey: rolesKey });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        'Roles could not be loaded',
      );
      expect(save.disabled).toBe(true);
    });
    expect(graphEditor(fixture)).toBe(editor);
    expect(structuredClone(form().value())).toEqual(draft);
    findRoles.mockResolvedValue(
      roleCatalog.map((role) => ({
        ...role,
        defaultOrganizerRole: role.id === 'organizer',
        defaultUserRole: role.id === 'organizer',
      })),
    );
    fixture.componentRef.setInput('categoryId', 'another-category');
    const retry = root.querySelector<HTMLButtonElement>(
      '[data-testid="retry-template-roles"]',
    );
    if (!retry) throw new Error('Expected role catalog retry button');
    retry.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findRoles).toHaveBeenCalledTimes(3);
      expect(save.disabled).toBe(false);
      expect(editor.defaultParticipantRoleIds()).toEqual(['organizer']);
      expect(
        root.querySelector('[data-testid="retry-template-roles"]'),
      ).toBeNull();
    });
    expect(graphEditor(fixture)).toBe(editor);
    expect(structuredClone(form().value())).toEqual(draft);
    expect(form.categoryId().value()).toBe('chosen-category');
  });

  it('initializes once and retains edited roles and category when the catalog changes', async () => {
    const fixture = TestBed.createComponent(TemplateCreateComponent);
    fixture.componentRef.setInput('categoryId', 'category-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(graphEditor(fixture).defaultParticipantRoleIds()).toEqual([
        'participant',
        'both',
      ]);
    });
    const editor = graphEditor(fixture);
    editor
      .graphForm()
      .registrationOptions()
      .value.update((options) =>
        options.map((option) => ({ ...option, roleIds: ['ordinary'] })),
      );
    editor.graphForm().categoryId().value.set('chosen-category');
    fixture.componentRef.setInput('categoryId', 'another-category');
    queryClient.setQueryData<readonly RoleLookupRecord[]>(
      rolesKey,
      roleCatalog.map((role) => ({
        ...role,
        defaultOrganizerRole: role.id === 'organizer',
        defaultUserRole: role.id === 'organizer',
      })),
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(editor.defaultParticipantRoleIds()).toEqual(['organizer']);
    });
    expect(
      editor
        .graphForm()()
        .value()
        .registrationOptions.map((option) => option.roleIds),
    ).toEqual([['ordinary'], ['ordinary']]);
    expect(editor.graphForm().categoryId().value()).toBe('chosen-category');
    expect(roleQueryOptions).toHaveBeenCalledExactlyOnceWith({});
    expect(findRoles).toHaveBeenCalledOnce();
  });
});
