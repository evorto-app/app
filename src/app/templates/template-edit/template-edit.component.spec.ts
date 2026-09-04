import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';
import { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
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
import { TemplateEditComponent } from './template-edit.component';

type RoleQueryOptions = RpcClient['roles']['findMany']['queryOptions'];
type RpcClient = ReturnType<typeof AppRpc.injectClient>;
type TemplateQueryOptions = RpcClient['templates']['findOne']['queryOptions'];

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
const savedOption = (
  id: string,
  organizingRegistration: boolean,
  roleIds: readonly string[],
): TemplateGraphRecord['registrationOptions'][number] => ({
  cancellationDeadlineHoursBeforeStart: null,
  closeRegistrationOffset: 1,
  description: null,
  esnCardDiscountedPrice: null,
  id,
  isPaid: false,
  openRegistrationOffset: 168,
  organizingRegistration,
  price: 0,
  refundFeesOnCancellation: null,
  registeredDescription: null,
  registrationMode: 'fcfs',
  roleIds,
  roles: roleIds.map((roleId) => ({ id: roleId, name: roleId })),
  spots: 20,
  stripeTaxRateId: null,
  title: id,
  transferDeadlineHoursBeforeStart: null,
});
const savedTemplate: TemplateGraphRecord = {
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Saved template</p>',
  icon: { iconColor: 2, iconName: 'calendar:fas' },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [],
  registrationOptions: [
    savedOption('saved-organizer-option', true, ['ordinary']),
    savedOption('saved-participant-option', false, ['organizer']),
  ],
  simpleModeEnabled: false,
  title: 'Saved template',
  unlisted: false,
};
const findTemplate = vi.fn<() => Promise<TemplateGraphRecord>>();
const templateQueryOptions = vi.fn(
  (
    input: Parameters<TemplateQueryOptions>[0],
  ): ReturnType<TemplateQueryOptions> => ({
    queryFn: findTemplate,
    queryKey: [['templates', 'findOne'], { input, type: 'query' }],
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

const graphEditor = (fixture: ComponentFixture<TemplateEditComponent>) => {
  const element = fixture.debugElement.query(
    By.directive(TemplateGraphEditorComponent),
  );
  if (!element)
    throw new Error('Expected the template graph editor to render.');
  return element.injector.get(TemplateGraphEditorComponent);
};
const addRegistrationOption = (
  fixture: ComponentFixture<TemplateEditComponent>,
) => {
  const root: HTMLElement = fixture.nativeElement;
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes('Add registration option'),
  );
  if (!button)
    throw new Error('Expected the Add registration option button to render.');
  button.click();
  fixture.detectChanges();
};

describe('TemplateEditComponent role catalog defaults', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findRoles.mockReset().mockResolvedValue(roleCatalog);
    findTemplate.mockReset().mockResolvedValue(savedTemplate);
    roleQueryOptions.mockClear();
    templateQueryOptions.mockClear();
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
      imports: [TemplateEditComponent],
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
              findOne: { queryOptions: templateQueryOptions },
              update: {
                mutationOptions: (): ReturnType<
                  RpcClient['templates']['update']['mutationOptions']
                > => ({
                  mutationFn: async () => {
                    throw new Error('Updating is outside this defaults test.');
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

  it('preserves saved option roles and seeds new participants only from catalog flags', async () => {
    const fixture = TestBed.createComponent(TemplateEditComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(graphEditor(fixture).defaultParticipantRoleIds()).toEqual([
        'participant',
        'both',
      ]);
    });
    const editor = graphEditor(fixture);
    expect(editor.graphForm()().value().registrationOptions).toEqual([
      expect.objectContaining({
        id: 'saved-organizer-option',
        organizingRegistration: true,
        roleIds: ['ordinary'],
      }),
      expect.objectContaining({
        id: 'saved-participant-option',
        organizingRegistration: false,
        roleIds: ['organizer'],
      }),
    ]);

    addRegistrationOption(fixture);
    expect(editor.graphForm()().value().registrationOptions).toEqual([
      expect.objectContaining({
        id: 'saved-organizer-option',
        roleIds: ['ordinary'],
      }),
      expect.objectContaining({
        id: 'saved-participant-option',
        roleIds: ['organizer'],
      }),
      expect.objectContaining({
        id: '',
        organizingRegistration: false,
        roleIds: ['participant', 'both'],
      }),
    ]);

    queryClient.setQueryData<readonly RoleLookupRecord[]>(
      rolesKey,
      roleCatalog.map((role) => ({
        ...role,
        defaultUserRole: role.id === 'ordinary',
      })),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(editor.defaultParticipantRoleIds()).toEqual(['ordinary']);
    });
    addRegistrationOption(fixture);
    expect(
      editor
        .graphForm()()
        .value()
        .registrationOptions.map((option) => option.roleIds),
    ).toEqual([
      ['ordinary'],
      ['organizer'],
      ['participant', 'both'],
      ['ordinary'],
    ]);
    expect(roleQueryOptions).toHaveBeenCalledExactlyOnceWith({});
    expect(findRoles).toHaveBeenCalledOnce();
    expect(templateQueryOptions).toHaveBeenCalledExactlyOnceWith({
      id: 'template-1',
    });
    expect(findTemplate).toHaveBeenCalledOnce();
  });
});
