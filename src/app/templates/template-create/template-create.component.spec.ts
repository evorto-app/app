import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tenant } from '../../../types/custom/tenant';
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

const tenant = new Tenant({
  cancellationDeadlineHoursBeforeStart: 24,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'tenant.example.test',
  id: 'tenant-1',
  maxActiveRegistrationsPerUser: 3,
  name: 'Tenant',
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: false,
  stripeAccountId: 'acct_test',
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
      set: { template: '' },
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
            tenantSignal: signal<null | Tenant>(tenant),
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
