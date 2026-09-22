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
import { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
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
  TemplateEditComponent,
  templateEditLoadErrorMessage,
  templateEditSaveErrorMessage,
} from './template-edit.component';

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
const findTaxRates =
  vi.fn<() => Promise<readonly TaxRatesListActiveRecord[]>>();
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
    (candidate) => candidate.textContent?.includes('Add sign-up choice'),
  );
  if (!button)
    throw new Error('Expected the Add sign-up choice button to render.');
  button.click();
  fixture.detectChanges();
};

const titleInput = (fixture: ComponentFixture<TemplateEditComponent>) => {
  const root: HTMLElement = fixture.nativeElement;
  const input = root.querySelector<HTMLInputElement>(
    ':scope app-template-general-form input',
  );
  if (!input) throw new Error('Expected the template title input to render.');
  return input;
};
const saveButton = (fixture: ComponentFixture<TemplateEditComponent>) => {
  const root: HTMLElement = fixture.nativeElement;
  const button = root.querySelector<HTMLButtonElement>(
    ':scope [data-testid="save-template-graph"]',
  );
  if (!button) throw new Error('Expected the template save button to render.');
  return button;
};
const retryRolesButton = (fixture: ComponentFixture<TemplateEditComponent>) => {
  const root: HTMLElement = fixture.nativeElement;
  const button = root.querySelector<HTMLButtonElement>(
    ':scope [data-testid="retry-template-roles"]',
  );
  if (!button) throw new Error('Expected the roles retry button to render.');
  return button;
};

describe('TemplateEditComponent role catalog defaults', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    findRoles.mockReset().mockResolvedValue(roleCatalog);
    findTaxRates.mockReset().mockResolvedValue([]);
    findTemplate.mockReset().mockResolvedValue(savedTemplate);
    roleQueryOptions.mockClear();
    templateQueryOptions.mockClear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    TestBed.overrideComponent(TemplateGeneralFormComponent, {
      set: {
        template: `
          <mat-form-field>
            <mat-label>Template title</mat-label>
            <input matInput [formField]="generalForm().title" />
          </mat-form-field>
        `,
      },
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

  it('explains the initial role load while retaining edits and blocking save', async () => {
    const rolesResponse = new Subject<readonly RoleLookupRecord[]>();
    findRoles.mockReturnValueOnce(firstValueFrom(rolesResponse));
    try {
      const fixture = TestBed.createComponent(TemplateEditComponent);
      fixture.componentRef.setInput('templateId', 'template-1');
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(titleInput(fixture).value).toBe('Saved template');
      });
      const input = titleInput(fixture);
      input.value = 'Edited while roles load';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.textContent).toContain('Loading roles');
      expect(saveButton(fixture).disabled).toBe(true);
      rolesResponse.next(roleCatalog);
      rolesResponse.complete();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(saveButton(fixture).disabled).toBe(false);
      });
      expect(titleInput(fixture)).toBe(input);
      expect(input.value).toBe('Edited while roles load');
      expect(root.textContent).not.toContain('Loading roles');
      expect(findRoles).toHaveBeenCalledOnce();
    } finally {
      rolesResponse.next(roleCatalog);
      rolesResponse.complete();
    }
  });

  it('retries an initial role failure through the rendered button without resetting the form', async () => {
    findRoles.mockRejectedValueOnce(new Error('private role catalog failure'));
    const fixture = TestBed.createComponent(TemplateEditComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(retryRolesButton(fixture).disabled).toBe(false);
      expect(titleInput(fixture).value).toBe('Saved template');
    });
    const input = titleInput(fixture);
    input.value = 'Unsaved template title';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Roles could not be loaded');
    expect(root.textContent).not.toContain('private role catalog failure');
    expect(saveButton(fixture).disabled).toBe(true);
    retryRolesButton(fixture).click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(saveButton(fixture).disabled).toBe(false);
    });
    expect(titleInput(fixture)).toBe(input);
    expect(input.value).toBe('Unsaved template title');
    expect(
      root.querySelector(':scope [data-testid="retry-template-roles"]'),
    ).toBeNull();
    expect(findRoles).toHaveBeenCalledTimes(2);
    expect(findTemplate).toHaveBeenCalledOnce();
  });

  it('retains the draft across a failed background role refresh and a real retry', async () => {
    const fixture = TestBed.createComponent(TemplateEditComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(saveButton(fixture).disabled).toBe(false);
    });
    const editor = graphEditor(fixture);
    const input = titleInput(fixture);
    input.value = 'Keep this draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    addRegistrationOption(fixture);
    const draft = structuredClone(editor.graphForm()().value());
    expect(draft.title).toBe('Keep this draft');
    expect(draft.registrationOptions.at(-1)?.roleIds).toEqual([
      'participant',
      'both',
    ]);
    findRoles.mockRejectedValueOnce(new Error('private background failure'));
    await queryClient.invalidateQueries({ queryKey: rolesKey });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(retryRolesButton(fixture).disabled).toBe(false);
      expect(saveButton(fixture).disabled).toBe(true);
    });
    expect(graphEditor(fixture)).toBe(editor);
    expect(structuredClone(editor.graphForm()().value())).toEqual(draft);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.textContent).toContain('Your entries are still here');
    expect(root.textContent).not.toContain('private background failure');
    const rolesResponse = new Subject<readonly RoleLookupRecord[]>();
    findRoles.mockReturnValueOnce(firstValueFrom(rolesResponse));
    const refreshedCatalog = roleCatalog.map((role) => ({
      ...role,
      defaultUserRole: role.id === 'ordinary',
    }));
    try {
      retryRolesButton(fixture).click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(findRoles).toHaveBeenCalledTimes(3);
        expect(retryRolesButton(fixture).disabled).toBe(true);
        expect(retryRolesButton(fixture).textContent).toContain('Retrying');
      });
      expect(saveButton(fixture).disabled).toBe(true);
      expect(structuredClone(editor.graphForm()().value())).toEqual(draft);
      rolesResponse.next(refreshedCatalog);
      rolesResponse.complete();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(saveButton(fixture).disabled).toBe(false);
        expect(editor.defaultParticipantRoleIds()).toEqual(['ordinary']);
      });
      expect(graphEditor(fixture)).toBe(editor);
      expect(titleInput(fixture)).toBe(input);
      expect(input.value).toBe('Keep this draft');
      expect(structuredClone(editor.graphForm()().value())).toEqual(draft);
      expect(
        root.querySelector(':scope [data-testid="retry-template-roles"]'),
      ).toBeNull();
      expect(findTemplate).toHaveBeenCalledOnce();
    } finally {
      rolesResponse.next(refreshedCatalog);
      rolesResponse.complete();
    }
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

  it('preserves paid values through a failed tax catalog and account unavailability', async () => {
    findTaxRates
      .mockRejectedValueOnce(new Error('Tax catalog unavailable'))
      .mockResolvedValue([]);
    const fixture = TestBed.createComponent(TemplateEditComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
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
      ).toBe(true);
    });
    expect(editor.graphForm()().errorSummary()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unavailableTaxRate' }),
      ]),
    );
    findTaxRates.mockResolvedValue([
      {
        country: 'DE',
        displayName: 'Retained tax rate',
        id: 'retained-rate',
        percentage: '19',
        state: null,
        stripeTaxRateId: 'txr-retained',
      },
    ]);
    await queryClient.refetchQueries({
      queryKey: [['taxRates', 'listActive']],
    });
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

describe('template edit error messages', () => {
  it('uses the organization payment connection when validating prices', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-edit/template-edit.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain('paymentsConfigured');
  });

  it('shows when the requested template is no longer available', () => {
    expect(
      templateEditLoadErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'This template could not be found.',
        reason: 'templateNotFound',
      }),
    ).toBe('This template could not be found.');
  });

  it('shows an actionable form problem', () => {
    expect(
      templateEditSaveErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Choose an available tax rate for each paid add-on.',
      }),
    ).toBe('Choose an available tax rate for each paid add-on.');
  });

  it.each([
    new Error('database failed'),
    { _tag: 'RpcInternalError', message: 'database failed' },
    { _tag: 'RpcUnauthorizedError', message: 'token expired' },
  ])('keeps technical and access failures behind plain copy', (error) => {
    expect(templateEditLoadErrorMessage(error)).toBe(
      'This template could not be loaded. Try again.',
    );
    expect(templateEditSaveErrorMessage(error)).toBe(
      'The save outcome could not be confirmed. Load this template again to check the saved details before trying again.',
    );
  });
});

describe('TemplateEditComponent save outcomes', () => {
  type OutcomeRpcClient = ReturnType<typeof AppRpc.injectClient>;
  type SaveInput = Parameters<
    NonNullable<
      ReturnType<
        OutcomeRpcClient['templates']['update']['mutationOptions']
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
    'The save outcome could not be confirmed. Load this template again to check the saved details before trying again.';
  const refreshMessage =
    'The template was saved, but the latest template information could not be loaded. Load this template again to see the saved details.';
  const navigationMessage =
    'The template was saved, but its page could not be opened. Open it from the template list.';
  const save = vi.fn<(input: SaveInput) => Promise<TemplateGraphRecord>>();
  const findTemplate = vi.fn<() => Promise<TemplateGraphRecord>>();
  const detailKey = (
    input: Parameters<OutcomeRpcClient['templates']['findOne']['queryKey']>[0],
  ): ReturnType<OutcomeRpcClient['templates']['findOne']['queryKey']> => [
    ['templates', 'findOne'],
    { input, type: 'query' },
  ];
  let queryClient: QueryClient;
  let fixture: ComponentFixture<TemplateEditComponent>;
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
    findTemplate.mockReset().mockResolvedValue(savedTemplate);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    await TestBed.configureTestingModule({
      imports: [TemplateEditComponent],
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
              findOne: {
                queryKey: detailKey,
                queryOptions: (
                  input: Parameters<
                    OutcomeRpcClient['templates']['findOne']['queryOptions']
                  >[0],
                ): ReturnType<
                  OutcomeRpcClient['templates']['findOne']['queryOptions']
                > => ({ queryFn: findTemplate, queryKey: detailKey(input) }),
              },
              update: {
                mutationOptions: (): ReturnType<
                  OutcomeRpcClient['templates']['update']['mutationOptions']
                > => ({ mutationFn: save }),
              },
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TemplateEditComponent);
    fixture.componentRef.setInput('templateId', 'template-1');
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
    expectedInput = { ...payload, id: 'template-1' };
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

  it('keeps confirmed saving visible through a real detail refetch failure and preserves edits after retry', async () => {
    findTemplate.mockRejectedValueOnce(
      new Error('Template detail refetch failed.'),
    );
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    submitForm();
    await expectMessage(refreshMessage);
    expect(findTemplate).toHaveBeenCalledTimes(2);
    expectMutationStatus('success');
    expect(
      queryClient.getQueryState(detailKey({ id: 'template-1' }))?.status,
    ).toBe('error');
    expect(
      fixture.debugElement.query(By.directive(TemplateGraphEditorComponent)),
    ).toBeNull();
    expect(root.querySelector('form')).toBeNull();
    expect(save).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: detailKey({ id: 'template-1' }) },
      { throwOnError: true },
    );
    expect(invalidate).toHaveBeenCalledWith(
      createRpcQueryFilter(['templates', 'groupedByCategory']),
      { throwOnError: true },
    );
    const loadError = [...root.querySelectorAll('[role="alert"]')].find(
      (element) =>
        element.textContent?.includes(
          'This template could not be loaded. Try again.',
        ),
    );
    const retry = loadError?.querySelector<HTMLButtonElement>('button');
    if (!retry) throw new Error('Expected the template-load Try again button.');
    retry.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findTemplate).toHaveBeenCalledTimes(3);
      expectRetainedEntries();
    });
    await expectMessage(refreshMessage);
    expect(navigate).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain(unknownSaveMessage);
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
    expect(navigate).toHaveBeenCalledExactlyOnceWith([
      '/templates',
      'template-1',
    ]);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: detailKey({ id: 'template-1' }) },
      { throwOnError: true },
    );
    expect(invalidate).toHaveBeenCalledWith(
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
      expect(saveButton().disabled).toBe(false);
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith([
      '/templates',
      'template-1',
    ]);
  });

  it('keeps submit locked after one invalidation rejects until its sibling read settles', async () => {
    let releaseRead: (() => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldRead = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockRejectedValueOnce(new Error('The detail read failed.'))
      .mockReturnValueOnce(heldRead);
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    try {
      submitForm();
      await vi.waitFor(() => {
        expect(invalidate).toHaveBeenCalledTimes(2);
        expectMutationStatus('success');
      });
      fixture.detectChanges();
      expect(saveButton().disabled).toBe(true);
      expect(root.textContent).not.toContain(refreshMessage);
      submitForm();
      expect(save).toHaveBeenCalledOnce();
      expect(navigate).not.toHaveBeenCalled();
      expect(JSON.stringify(renderedGraph().graphForm()().value())).toBe(
        JSON.stringify(entered),
      );
    } finally {
      releaseRead?.();
      await fixture.whenStable();
    }
    await expectMessage(refreshMessage);
    expectRetainedEntries();
    expectMutationStatus('success');
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith(
      { queryKey: detailKey({ id: 'template-1' }) },
      { throwOnError: true },
    );
    expect(invalidate).toHaveBeenCalledWith(
      createRpcQueryFilter(['templates', 'groupedByCategory']),
      { throwOnError: true },
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(saveButton().disabled).toBe(false);
    });
  });
});
