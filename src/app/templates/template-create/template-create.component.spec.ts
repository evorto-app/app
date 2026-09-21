import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { createRpcQueryFilter } from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import { RoleLookupNotFoundError } from '@shared/rpc-contracts/app-rpcs/roles.errors';
import { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';
import { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import {
  OrdinaryTemplateGraphFormModel,
  ordinaryTemplateGraphFormToPayload,
} from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form';
import { TemplateGraphEditorComponent } from '../../shared/components/forms/template-graph-editor/template-graph-editor.component';
import {
  createTemplateGraphAddonFormModel,
  createTemplateGraphQuestionFormModel,
} from '../../shared/components/forms/template-graph-editor/template-graph-form.model';
import { TemplateRegistrationOptionEditorComponent } from '../../shared/components/forms/template-graph-editor/template-registration-option-editor.component';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';
import {
  TemplateCreateComponent,
  templateCreateErrorMessage,
} from './template-create.component';

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
const findTaxRates = vi.fn(async () => []);
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
    findTaxRates.mockReset().mockResolvedValue([]);
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
                  queryFn: findTaxRates,
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

  it('preserves paid values through a failed tax catalog and account unavailability', async () => {
    findTaxRates
      .mockRejectedValueOnce(new Error('Tax catalog unavailable'))
      .mockResolvedValue([]);
    const fixture = TestBed.createComponent(TemplateCreateComponent);
    fixture.componentRef.setInput('categoryId', 'category-1');
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected the template editor root');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain('Tax rates could not be loaded.');
      expect(
        graphEditor(fixture).graphForm()().value().registrationOptions,
      ).toHaveLength(2);
    });
    const editor = graphEditor(fixture);
    editor
      .graphForm()()
      .value.update((model) => ({
        ...model,
        description: '<p>Retained paid template</p>',
        icon: { iconColor: 2, iconName: 'calendar:fas' },
        registrationOptions: model.registrationOptions.map((option) =>
          option.organizingRegistration
            ? option
            : {
                ...option,
                esnCardDiscountedPrice: 800,
                isPaid: true,
                price: 1200,
                stripeTaxRateId: 'txr-retained',
              },
        ),
        title: 'Retained paid template',
      }));
    const expected = structuredClone(editor.graphForm()().value());
    TestBed.inject(ConfigService).tenantSignal.set(
      new ClientTenantConfig({ ...tenant, paymentsConfigured: false }),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(
        'Existing payment details are preserved.',
      );
      expect(
        root.querySelector<HTMLButtonElement>(
          '[data-testid="save-template-graph"]',
        )?.disabled,
      ).toBe(true);
    });
    expect(JSON.stringify(editor.graphForm()().value())).toBe(
      JSON.stringify(expected),
    );
    const taxAlert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) =>
      element.textContent?.includes('Tax rates could not be loaded.'),
    );
    const retry = taxAlert?.querySelector<HTMLButtonElement>('button');
    if (!retry) throw new Error('Expected the tax catalog retry button');
    retry.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findTaxRates).toHaveBeenCalledTimes(2);
      expect(root.textContent).not.toContain('Tax rates could not be loaded.');
    });
    expect(JSON.stringify(editor.graphForm()().value())).toBe(
      JSON.stringify(expected),
    );
    expect(
      root.querySelector<HTMLButtonElement>(
        '[data-testid="save-template-graph"]',
      )?.disabled,
    ).toBe(true);
    TestBed.inject(ConfigService).tenantSignal.set(
      new ClientTenantConfig({ ...tenant, paymentsConfigured: true }),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        root.querySelector<HTMLButtonElement>(
          '[data-testid="save-template-graph"]',
        )?.disabled,
      ).toBe(false);
    });
    expect(JSON.stringify(editor.graphForm()().value())).toBe(
      JSON.stringify(expected),
    );
  });
});

describe('templateCreateErrorMessage', () => {
  it('uses the organization payment connection when validating prices', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-create/template-create.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain('paymentsConfigured');
  });

  it('shows an actionable form problem', () => {
    expect(
      templateCreateErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Add a title and description for this template.',
      }),
    ).toBe('Add a title and description for this template.');
  });

  it.each([
    new Error('database failed'),
    { _tag: 'RpcInternalServerError', message: 'database failed' },
    { _tag: 'RpcUnauthorizedError', message: 'token expired' },
  ])('keeps technical and access failures behind plain copy', (error) => {
    expect(templateCreateErrorMessage(error)).toBe(
      'The save outcome could not be confirmed. Load the template list again to check whether the template was saved before trying again.',
    );
  });
});

describe('TemplateCreateComponent save outcomes', () => {
  type OutcomeRpcClient = ReturnType<typeof AppRpc.injectClient>;
  type SaveInput = Parameters<
    NonNullable<
      ReturnType<
        OutcomeRpcClient['templates']['create']['mutationOptions']
      >['mutationFn']
    >
  >[0];
  const roles: readonly RoleLookupRecord[] = [
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
  ];
  const option = (
    organizingRegistration: boolean,
  ): TemplateGraphRecord['registrationOptions'][number] => ({
    cancellationDeadlineHoursBeforeStart: null,
    closeRegistrationOffset: 1,
    description: null,
    esnCardDiscountedPrice: null,
    id: organizingRegistration ? 'saved-organizer' : 'saved-attendee',
    isPaid: false,
    openRegistrationOffset: 168,
    organizingRegistration,
    price: 0,
    refundFeesOnCancellation: null,
    registeredDescription: null,
    registrationMode: 'fcfs',
    roleIds: [organizingRegistration ? 'organizer' : 'participant'],
    roles: [
      {
        id: organizingRegistration ? 'organizer' : 'participant',
        name: organizingRegistration ? 'Organizer' : 'Participant',
      },
    ],
    spots: organizingRegistration ? 2 : 20,
    stripeTaxRateId: null,
    title: organizingRegistration ? 'Saved organizers' : 'Saved attendees',
    transferDeadlineHoursBeforeStart: null,
  });
  const savedTemplate: TemplateGraphRecord = {
    addOns: [],
    categoryId: 'category-1',
    description: '<p>Original template description</p>',
    icon: { iconColor: 2, iconName: 'calendar:fas' },
    id: 'template-1',
    location: null,
    planningTips: 'Original planning tips',
    questions: [],
    registrationOptions: [option(true), option(false)],
    simpleModeEnabled: false,
    title: 'Original template title',
  };
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
  const unknownSaveMessage =
    'The save outcome could not be confirmed. Load the template list again to check whether the template was saved before trying again.';
  const refreshMessage =
    'The template was saved, but the template list could not be updated. Load the template list again to see the saved template.';
  const navigationMessage =
    'The template was saved, but its page could not be opened. Open it from the template list.';
  const save = vi.fn<(input: SaveInput) => Promise<TemplateGraphRecord>>();
  let queryClient: QueryClient;
  let fixture: ComponentFixture<TemplateCreateComponent>;
  let root: HTMLElement;
  let entered: OrdinaryTemplateGraphFormModel;
  let expectedInput: SaveInput;

  const renderedGraph = () => {
    const element = fixture.debugElement.query(
      By.directive(TemplateGraphEditorComponent),
    );
    if (!element) throw new Error('Expected the real template graph editor.');
    return element.injector.get(TemplateGraphEditorComponent);
  };
  const saveButton = () => {
    const button = root.querySelector<HTMLButtonElement>(
      '[data-testid="save-template-graph"]',
    );
    if (!button) throw new Error('Expected the template save button.');
    return button;
  };
  const submitForm = () => {
    const formElement = root.querySelector('form');
    if (!formElement) throw new Error('Expected the template form.');
    formElement.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  };
  const expectMessage = async (message: string) => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      const alert = [...root.querySelectorAll('[role="alert"]')].find(
        (element) => element.textContent?.includes(message),
      );
      expect(alert?.textContent).toContain(message);
      expect(alert?.textContent).toContain('Your entries are still here.');
    });
  };
  const expectRetainedEntries = () => {
    // Compare every serialized form field without Signal Forms tracking symbols.
    expect(JSON.stringify(renderedGraph().graphForm()().value())).toBe(
      JSON.stringify(entered),
    );
    expect(
      root.querySelector<HTMLInputElement>(
        ':scope app-template-general-form input',
      )?.value,
    ).toBe(entered.title);
    expect(
      root.querySelector<HTMLTextAreaElement>(
        ':scope app-template-general-form textarea',
      )?.value,
    ).toBe(entered.planningTips);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toEqual(expectedInput);
    expect(root.textContent).not.toContain(
      'The template could not be saved. Try again.',
    );
    expect(root.textContent).not.toContain('Review them and try again.');
  };
  const expectMutationStatus = (status: 'error' | 'success') => {
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
      status,
    );
  };

  beforeEach(async () => {
    save.mockReset().mockResolvedValue(savedTemplate);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
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
                  OutcomeRpcClient['discounts']['getTenantProviders']['queryOptions']
                > => ({
                  queryFn: async () => [],
                  queryKey: [
                    ['discounts', 'getTenantProviders'],
                    { type: 'query' },
                  ],
                }),
              },
            },
            queryFilter: createRpcQueryFilter,
            roles: {
              findMany: {
                queryOptions: (
                  input: Parameters<
                    OutcomeRpcClient['roles']['findMany']['queryOptions']
                  >[0],
                ): ReturnType<
                  OutcomeRpcClient['roles']['findMany']['queryOptions']
                > => ({
                  queryFn: async () => {
                    const search = input.search;
                    return search === undefined
                      ? roles
                      : roles
                          .filter((role) =>
                            role.name
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                          )
                          .slice(0, 15);
                  },
                  queryKey: [['roles', 'findMany'], { input, type: 'query' }],
                }),
              },
              findOne: {
                queryOptions: (
                  input: Parameters<
                    OutcomeRpcClient['roles']['findOne']['queryOptions']
                  >[0],
                ): ReturnType<
                  OutcomeRpcClient['roles']['findOne']['queryOptions']
                > => ({
                  queryFn: async () => {
                    const role = roles.find(
                      (candidate) => candidate.id === input.id,
                    );
                    if (!role)
                      throw new RoleLookupNotFoundError({
                        id: input.id,
                        message: 'Role not found',
                      });
                    return role;
                  },
                  queryKey: [['roles', 'findOne'], { input, type: 'query' }],
                }),
              },
            },
            taxRates: {
              listActive: {
                queryOptions: (): ReturnType<
                  OutcomeRpcClient['taxRates']['listActive']['queryOptions']
                > => ({
                  queryFn: async () => [],
                  queryKey: [['taxRates', 'listActive'], { type: 'query' }],
                }),
              },
            },
            templateCategories: {
              findMany: {
                queryOptions: (): ReturnType<
                  OutcomeRpcClient['templateCategories']['findMany']['queryOptions']
                > => ({
                  queryFn: async () => [
                    {
                      icon: { iconColor: 2, iconName: 'calendar:fas' },
                      id: 'category-1',
                      title: 'Trips',
                    },
                  ],
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
                  OutcomeRpcClient['templates']['create']['mutationOptions']
                > => ({ mutationFn: save }),
              },
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TemplateCreateComponent);
    fixture.componentRef.setInput('categoryId', 'category-1');
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected the template component root.');
    root = element;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        renderedGraph().graphForm()().value().registrationOptions,
      ).toHaveLength(2);
    });
    const graph = renderedGraph().graphForm();
    const attendee = graph()
      .value()
      .registrationOptions.find(
        (candidate) => !candidate.organizingRegistration,
      );
    if (!attendee) throw new Error('Expected the attendee choice.');
    graph().value.update((model) => ({
      ...model,
      addOns: [
        {
          ...createTemplateGraphAddonFormModel(attendee.key),
          description: 'Vegetarian lunch',
          title: 'Retained lunch',
          totalAvailableQuantity: 30,
        },
      ],
      categoryId: 'category-1',
      description: '<p>Retained graph description</p>',
      icon: { iconColor: 2, iconName: 'calendar:fas' },
      planningTips: 'Retained organizer instructions',
      questions: [
        {
          ...createTemplateGraphQuestionFormModel(attendee.key),
          description: 'Tell us about allergies.',
          title: 'Retained dietary question',
        },
      ],
      registrationOptions: model.registrationOptions.map((candidate) => ({
        ...candidate,
        description: candidate.organizingRegistration
          ? '<p>Organizer duties</p>'
          : '<p>Attendee details</p>',
        spots: candidate.organizingRegistration ? 3 : 27,
        title: candidate.organizingRegistration
          ? 'Retained organizer choice'
          : 'Retained attendee choice',
      })),
      simpleModeEnabled: false,
      title: 'Retained template graph',
    }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(saveButton().disabled).toBe(false);
    });
    entered = structuredClone(graph().value());
    if (!entered.icon) throw new Error('Expected the entered template icon.');
    const payload = ordinaryTemplateGraphFormToPayload(
      { ...entered, icon: entered.icon },
      false,
    );
    expectedInput = payload;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('keeps a lost response after a simulated commit unconfirmed without another mutation or navigation', async () => {
    let simulatedCommit = false;
    save.mockImplementationOnce(async () => {
      simulatedCommit = true;
      throw new Error(
        'Test-local commit completed, but its response was lost.',
      );
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    submitForm();
    await expectMessage(unknownSaveMessage);
    expect(simulatedCommit).toBe(true);
    expectMutationStatus('error');
    expectRetainedEntries();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('The template was saved, but');
  });

  it('keeps an internal RPC failure unconfirmed while retaining the entered graph', async () => {
    save.mockRejectedValueOnce(
      new RpcInternalServerError({
        message: 'Internal database detail must stay private.',
      }),
    );
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    submitForm();
    await expectMessage(unknownSaveMessage);
    expectMutationStatus('error');
    expectRetainedEntries();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain(
      'Internal database detail must stay private.',
    );
    expect(root.textContent).not.toContain('The template was saved, but');
  });

  it('shows an expected validation message without losing entries or navigating', async () => {
    const message = 'Choose an available role for each sign-up choice.';
    save.mockRejectedValueOnce(
      new RpcBadRequestError({ message, reason: 'invalidRole' }),
    );
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    submitForm();
    await expectMessage(message);
    expectMutationStatus('error');
    expectRetainedEntries();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain(unknownSaveMessage);
    expect(root.textContent).not.toContain('The template was saved, but');
  });

  it('reports confirmed saving when the active template list really fails to refetch', async () => {
    const findList = vi.fn(async () => []);
    const listOptions: ReturnType<
      OutcomeRpcClient['templates']['groupedByCategory']['queryOptions']
    > = {
      queryFn: findList,
      queryKey: [['templates', 'groupedByCategory'], { type: 'query' }],
    };
    const observer = new QueryObserver(queryClient, listOptions);
    let listStatus = 'pending';
    const unsubscribe = observer.subscribe((result) => {
      listStatus = result.status;
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    try {
      await vi.waitFor(() => {
        expect(listStatus).toBe('success');
        expect(findList).toHaveBeenCalledOnce();
      });
      findList.mockRejectedValueOnce(
        new Error('Template list refetch failed.'),
      );
      submitForm();
      await expectMessage(refreshMessage);
      expect(findList).toHaveBeenCalledTimes(2);
      expect(listStatus).toBe('error');
      expectMutationStatus('success');
      expectRetainedEntries();
      expect(navigate).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledExactlyOnceWith(
        createRpcQueryFilter(['templates', 'groupedByCategory']),
        { throwOnError: true },
      );
      expect(root.textContent).not.toContain(unknownSaveMessage);
    } finally {
      unsubscribe();
    }
  });

  it('reports confirmed saving when navigation rejects after successful invalidation', async () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockRejectedValueOnce(new Error('Navigation failed.'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    submitForm();
    await expectMessage(navigationMessage);
    expectMutationStatus('success');
    expectRetainedEntries();
    expect(saveButton().disabled).toBe(true);
    submitForm();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledExactlyOnceWith([
      '/templates',
      'template-1',
    ]);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(
      createRpcQueryFilter(['templates', 'groupedByCategory']),
      { throwOnError: true },
    );
    expect(root.textContent).not.toContain(unknownSaveMessage);
  });

  it('reports confirmed saving when navigation returns false', async () => {
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValueOnce(false);
    submitForm();
    await expectMessage(navigationMessage);
    expectMutationStatus('success');
    expectRetainedEntries();
    expect(saveButton().disabled).toBe(true);
    submitForm();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledExactlyOnceWith([
      '/templates',
      'template-1',
    ]);
    expect(root.textContent).not.toContain(unknownSaveMessage);
  });

  it('keeps submit locked until navigation settles after the mutation succeeds', async () => {
    let releaseNavigation: (() => void) | undefined;
    const heldNavigation = new Promise<boolean>((resolve) => {
      releaseNavigation = () => resolve(false);
    });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValueOnce(heldNavigation);
    try {
      submitForm();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(navigate).toHaveBeenCalledOnce();
        expectMutationStatus('success');
        expect(saveButton().disabled).toBe(true);
      });
      submitForm();
      expect(save).toHaveBeenCalledOnce();
      expect(JSON.stringify(renderedGraph().graphForm()().value())).toBe(
        JSON.stringify(entered),
      );
    } finally {
      releaseNavigation?.();
      await fixture.whenStable();
    }
    await expectMessage(navigationMessage);
    expectRetainedEntries();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(saveButton().disabled).toBe(true);
    });
    submitForm();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledExactlyOnceWith([
      '/templates',
      'template-1',
    ]);
  });
});
