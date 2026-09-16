import type { PlatformTemplatesUpdateInput } from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import '@angular/compiler';

import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import type { IconValue } from '@shared/types/icon';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField } from '@angular/forms/signals';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectHarness } from '@angular/material/select/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { MAX_EVENT_ADDON_TYPES } from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';
import {
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventLocationType } from '../../../types/location';

import { NotificationService } from '../../core/notification.service';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import { PLATFORM_EVENT_OPERATION_ROUTES } from './platform-event-operations.routes';
import { platformTemplateAddonTypeLimitIssue } from './platform-template-editor.component';
import {
  PlatformTemplateEditorComponent,
  platformTemplateEditorDataReady,
  PlatformTemplateEditorOperations,
  platformTemplateFormToPayload,
  platformTemplateIconChoiceToValue,
  platformTemplateModeTransitionIssue,
  platformTemplateRecordToFormModel,
} from './platform-template-editor.component';
import { platformTemplateUnsavedChangesGuard } from './platform-template-unsaved-changes.guard';

@Component({ selector: 'app-editor', template: '' })
class EditorStub {
  readonly control = input<unknown>();
}

@Component({ selector: 'app-icon', template: '' })
class IconStub {
  readonly iconCommonName = input.required<IconValue>();
  readonly size = input(24);
}

@Component({ selector: 'app-location-selector-field', template: '' })
class LocationSelectorFieldStub {
  readonly value = input<EventLocationType | null>(null);
  readonly valueChange = output<EventLocationType | null>();
}

@Component({ selector: 'app-platform-tenant-page-header', template: '' })
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

describe('platform template editor readiness', () => {
  it('guards both template editor routes', () => {
    const guardedPaths = PLATFORM_EVENT_OPERATION_ROUTES.filter((route) =>
      route.path?.includes('/templates/'),
    );

    expect(guardedPaths.map((route) => route.path)).toEqual([
      'tenants/:tenantId/templates/new',
      'tenants/:tenantId/templates/:templateId',
    ]);
    for (const route of guardedPaths) {
      expect(route.canDeactivate).toEqual([
        platformTemplateUnsavedChangesGuard,
      ]);
    }
  });

  it('uses the target catalog color when an icon is selected', () => {
    expect(
      platformTemplateIconChoiceToValue({
        commonName: 'calendar:fas',
        sourceColor: 42,
      }),
    ).toEqual({ iconColor: 42, iconName: 'calendar:fas' });
    expect(
      platformTemplateIconChoiceToValue({
        commonName: 'calendar:fas',
        sourceColor: null,
      }),
    ).toEqual({ iconColor: 0, iconName: 'calendar:fas' });
  });

  it('keeps saves blocked until all provider-backed editor data is resolved', () => {
    expect(
      platformTemplateEditorDataReady({
        optionsResolved: false,
        rolesResolved: true,
        templateRequired: true,
        templateResolved: true,
      }),
    ).toBe(false);
    expect(
      platformTemplateEditorDataReady({
        optionsResolved: true,
        rolesResolved: true,
        templateRequired: true,
        templateResolved: true,
      }),
    ).toBe(true);
    expect(
      platformTemplateEditorDataReady({
        optionsResolved: true,
        rolesResolved: true,
        templateRequired: false,
        templateResolved: false,
      }),
    ).toBe(true);
  });
  it('accepts the add-on cap and rejects cap plus one', () => {
    expect(
      platformTemplateAddonTypeLimitIssue(
        Array.from({ length: MAX_EVENT_ADDON_TYPES }),
      ),
    ).toBeNull();
    expect(
      platformTemplateAddonTypeLimitIssue(
        Array.from({ length: MAX_EVENT_ADDON_TYPES + 1 }),
      ),
    ).toBe(`Templates support at most ${MAX_EVENT_ADDON_TYPES} add-on types.`);
  });
});

describe('PlatformTemplateEditorComponent recovery', () => {
  let optionFailuresRemaining = 0;
  let queryClient: QueryClient;
  const loadTemplate = vi.fn(async () => completeTemplate());
  const targetRoles = () => [
    {
      defaultOrganizerRole: true,
      defaultUserRole: true,
      id: 'role-1',
      name: 'Member',
    },
    {
      defaultOrganizerRole: false,
      defaultUserRole: false,
      id: 'organizer-role',
      name: 'Organizer',
    },
    {
      defaultOrganizerRole: false,
      defaultUserRole: false,
      id: 'member-role',
      name: 'Participant',
    },
  ];
  const loadRoles = vi.fn(async () => targetRoles());
  const roleOptions = vi.fn((targetTenantId: string) => ({
    queryFn: loadRoles,
    queryKey: ['platform-template', 'roles', targetTenantId],
  }));
  const updateTemplate =
    vi.fn<
      (input: PlatformTemplatesUpdateInput) => Promise<TemplateGraphRecord>
    >();
  const loadOptions = vi.fn(async () => {
    if (optionFailuresRemaining > 0) {
      optionFailuresRemaining -= 1;
      throw new Error('Category provider unavailable');
    }
    return {
      categories: [{ id: 'category-1', title: 'Trips' }],
      esnCardEnabled: false,
      iconChoices: [
        {
          commonName: 'calendar:fas',
          friendlyName: 'Calendar',
          id: 'icon-1',
          sourceColor: 42,
        },
      ],
    };
  });

  const createTemplate = vi.fn(async () => ({ id: 'template-1' }));
  let taxRateFailuresRemaining = 0;
  const loadTaxRates = vi.fn(async () => {
    if (taxRateFailuresRemaining > 0) {
      taxRateFailuresRemaining -= 1;
      throw new Error('Tax catalog unavailable');
    }
    return [];
  });

  beforeEach(async () => {
    optionFailuresRemaining = 0;
    taxRateFailuresRemaining = 0;
    createTemplate.mockClear();
    loadTaxRates.mockClear();
    loadTemplate.mockReset().mockResolvedValue(completeTemplate());
    loadRoles.mockReset().mockResolvedValue(targetRoles());
    updateTemplate.mockReset().mockResolvedValue(completeTemplate());
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformTemplateEditorComponent, {
      add: {
        imports: [
          EditorStub,
          IconStub,
          LocationSelectorFieldStub,
          PlatformTenantPageHeaderStub,
        ],
      },
      remove: {
        imports: [
          EditorComponent,
          IconComponent,
          LocationSelectorField,
          PlatformTenantPageHeaderComponent,
        ],
      },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformTemplateEditorComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: MatDialog, useValue: { open: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformTemplateEditorOperations,
          useValue: {
            create: () => ({
              mutationFn: createTemplate,
              mutationKey: ['platform-template', 'create'],
            }),
            findOne: () => ({
              queryFn: loadTemplate,
              queryKey: ['platform', 'templates', 'detail'],
            }),
            formOptions: () => ({
              queryFn: loadOptions,
              queryKey: ['platform-template', 'options'],
            }),
            roles: roleOptions,
            taxRates: () => ({
              queryFn: loadTaxRates,
              queryKey: ['platform-template', 'tax-rates'],
            }),
            templateFilter: () => ({
              queryKey: ['platform', 'templates'],
            }),
            tenant: () => ({
              queryFn: async () => ({
                currency: 'EUR',
                paymentsConfigured: true,
              }),
              queryKey: ['platform-template', 'tenant'],
            }),
            update: () => ({
              mutationFn: updateTemplate,
              mutationKey: ['platform-template', 'update'],
            }),
          },
        },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  const render = (): ComponentFixture<PlatformTemplateEditorComponent> => {
    const fixture = TestBed.createComponent(PlatformTemplateEditorComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    return fixture;
  };

  const renderExistingTemplate = async (roleIds: string[]) => {
    const source = completeTemplate();
    loadTemplate.mockResolvedValue({
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) => ({
        ...option,
        roleIds: index === 0 ? roleIds : ['role-1'],
      })),
    });
    const fixture = render();
    fixture.componentRef.setInput('templateId', 'template-1');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    });
    const root: HTMLElement = fixture.nativeElement;
    const reasonField = [...root.querySelectorAll('mat-form-field')].find(
      (field) =>
        field.querySelector('mat-label')?.textContent?.trim() ===
        'Operational reason',
    );
    const reason = reasonField?.querySelector('textarea');
    if (!reason) throw new Error('Expected the operational reason input');
    reason.value = 'Repair template eligibility';
    reason.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const roleBinding = fixture.debugElement.query(
      By.css('mat-select[multiple]'),
    );
    const field = roleBinding.injector.get(FormField).state;
    return { field, fixture, root };
  };

  const submitTemplate = async (
    fixture: ComponentFixture<PlatformTemplateEditorComponent>,
  ) => {
    const root: HTMLElement = fixture.nativeElement;
    const form = root.querySelector('form');
    if (!form) throw new Error('Expected the template form');
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
  };

  it('blocks unavailable target-organization roles until they are removed from the selection', async () => {
    const { field, fixture, root } = await renderExistingTemplate([
      'role-1',
      'deleted-role',
    ]);

    expect(roleOptions).toHaveBeenCalledWith('tenant-1');
    expect(field().errors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'roleMissing' }),
      ]),
    );
    await submitTemplate(fixture);
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(root.textContent).toContain(
      'Remove unavailable organization roles before saving.',
    );
    expect(
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);

    const roles = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      MatSelectHarness.with({ selector: 'mat-select[multiple]' }),
    );
    await roles.open();
    const [missingRole] = await roles.getOptions({
      text: 'Previously selected organization role (no longer available)',
    });
    if (!missingRole)
      throw new Error('Expected the removable unavailable role');
    expect(await missingRole.isSelected()).toBe(true);
    await missingRole.click();
    await roles.close();
    await fixture.whenStable();
    expect(field().errors()).toEqual([]);
    expect(
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(false);

    await submitTemplate(fixture);
    expect(updateTemplate).toHaveBeenCalledOnce();
    expect(updateTemplate.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registrationOptions: expect.arrayContaining([
            expect.objectContaining({
              id: 'organizer-option',
              roleIds: ['role-1'],
            }),
          ]),
          targetTenantId: 'tenant-1',
        }),
      ]),
    );
  });

  it('keeps cached role labels removable after lookup failure without duplicating or adding unverified options', async () => {
    loadRoles.mockResolvedValue([
      {
        defaultOrganizerRole: true,
        defaultUserRole: true,
        id: 'role-1',
        name: 'Member',
      },
      {
        defaultOrganizerRole: false,
        defaultUserRole: false,
        id: 'helper-role',
        name: 'Helper',
      },
      {
        defaultOrganizerRole: false,
        defaultUserRole: false,
        id: 'observer-role',
        name: 'Observer',
      },
    ]);
    const { field, fixture, root } = await renderExistingTemplate([
      'role-1',
      'helper-role',
    ]);
    loadRoles.mockRejectedValueOnce(new Error('Role lookup failed'));
    await queryClient.refetchQueries({
      exact: true,
      queryKey: ['platform-template', 'roles', 'tenant-1'],
    });
    await fixture.whenStable();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(root.textContent).toContain(
        'organization roles could not be loaded',
      );
      expect(root.querySelector('form')).not.toBeNull();
    });
    const roles = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      MatSelectHarness.with({ selector: 'mat-select[multiple]' }),
    );
    expect(await roles.getValueText()).toBe('Member, Helper');
    await roles.open();
    expect(await roles.getOptions()).toHaveLength(3);
    const [helper] = await roles.getOptions({ text: 'Helper' });
    const [observer] = await roles.getOptions({ text: 'Observer' });
    if (!helper || !observer) throw new Error('Expected retained role options');
    expect(await helper.isSelected()).toBe(true);
    expect(await helper.isDisabled()).toBe(false);
    expect(await observer.isDisabled()).toBe(true);
    await helper.click();
    await roles.close();
    expect(field().value()).toEqual(['role-1']);
    expect(field().errors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'roleUnverified' }),
      ]),
    );
    await submitTemplate(fixture);
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);

    const retry = [...root.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Try again',
    );
    if (!retry) throw new Error('Expected the role retry action');
    retry.click();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(field().errors()).toEqual([]);
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    });
    expect(field().value()).toEqual(['role-1']);
    await submitTemplate(fixture);
    expect(updateTemplate).toHaveBeenCalledOnce();
    expect(updateTemplate.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          registrationOptions: expect.arrayContaining([
            expect.objectContaining({
              id: 'organizer-option',
              roleIds: ['role-1'],
            }),
          ]),
          targetTenantId: 'tenant-1',
        }),
      ]),
    );
  });

  it('preserves persisted role labels for removal when the initial catalog lookup fails', async () => {
    loadRoles.mockRejectedValueOnce(new Error('Initial role lookup failed'));
    const { field, fixture, root } = await renderExistingTemplate([
      'organizer-role',
      'role-1',
    ]);
    const roles = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      MatSelectHarness.with({ selector: 'mat-select[multiple]' }),
    );
    expect(await roles.getValueText()).toContain('Organizer (not verified)');
    await roles.open();
    const [organizer] = await roles.getOptions({
      text: 'Organizer (not verified)',
    });
    if (!organizer) throw new Error('Expected the persisted role label');
    expect(await organizer.isSelected()).toBe(true);
    expect(await organizer.isDisabled()).toBe(false);
    await organizer.click();
    await roles.close();
    expect(field().value()).toEqual(['role-1']);
    await submitTemplate(fixture);
    expect(updateTemplate).not.toHaveBeenCalled();
    expect(
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);

    const retry = [...root.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Try again',
    );
    if (!retry) throw new Error('Expected the role retry action');
    let finishRetry:
      ((roles: Awaited<ReturnType<typeof loadRoles>>) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const retryResult = new Promise<Awaited<ReturnType<typeof loadRoles>>>(
      (resolve) => {
        finishRetry = resolve;
      },
    );
    loadRoles.mockReturnValueOnce(retryResult);
    retry.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        queryClient.getQueryState(['platform-template', 'roles', 'tenant-1'])
          ?.fetchStatus,
      ).toBe('fetching');
      expect(root.querySelector('form')).not.toBeNull();
      expect(root.textContent).toContain('Loading organization roles');
      expect(field().value()).toEqual(['role-1']);
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(true);
    });
    if (!finishRetry) throw new Error('Expected the pending role retry');
    finishRetry([
      {
        defaultOrganizerRole: true,
        defaultUserRole: true,
        id: 'role-1',
        name: 'Member',
      },
    ]);
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(field().errors()).toEqual([]);
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    });
    expect(await roles.getValueText()).toBe('Member');
    expect(field().value()).toEqual(['role-1']);
  });

  it.each(['available', 'missing', 'error'])(
    'blocks role revalidation until the target catalog resolves as %s',
    async (outcome) => {
      const { field, fixture, root } = await renderExistingTemplate(['role-1']);
      expect(field().errors()).toEqual([]);
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
      let resolveRoles:
        ((roles: Awaited<ReturnType<typeof loadRoles>>) => void) | undefined;
      let rejectRoles: ((error: Error) => void) | undefined;
      // Angular's browser library target does not expose Promise.withResolvers.
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      const pendingRoles = new Promise<Awaited<ReturnType<typeof loadRoles>>>(
        (resolve, reject) => {
          resolveRoles = resolve;
          rejectRoles = reject;
        },
      );
      loadRoles.mockImplementationOnce(() => pendingRoles);
      const refetch = queryClient.refetchQueries({
        exact: true,
        queryKey: ['platform-template', 'roles', 'tenant-1'],
      });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          queryClient.getQueryState(['platform-template', 'roles', 'tenant-1'])
            ?.fetchStatus,
        ).toBe('fetching');
        expect(loadRoles).toHaveBeenCalledTimes(2);
        expect(field().errors()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'roleUnverified' }),
          ]),
        );
        expect(
          root.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled,
        ).toBe(true);
      });
      const pendingForm = root.querySelector('form');
      if (!pendingForm) throw new Error('Expected the pending template form');
      pendingForm.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
      expect(updateTemplate).not.toHaveBeenCalled();

      if (!resolveRoles || !rejectRoles)
        throw new Error('Expected a pending target role lookup');
      if (outcome === 'error')
        rejectRoles(new Error('Role provider unavailable'));
      else
        resolveRoles(
          outcome === 'missing'
            ? []
            : [
                {
                  defaultOrganizerRole: true,
                  defaultUserRole: true,
                  id: 'role-1',
                  name: 'Member',
                },
              ],
        );
      await refetch;
      await fixture.whenStable();
      if (outcome === 'available') {
        expect(field().errors()).toEqual([]);
        await submitTemplate(fixture);
        expect(updateTemplate).toHaveBeenCalledOnce();
      } else if (outcome === 'missing') {
        expect(field().errors()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'roleMissing' }),
          ]),
        );
        await submitTemplate(fixture);
        expect(updateTemplate).not.toHaveBeenCalled();
      } else {
        expect(field().errors()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'roleUnverified' }),
          ]),
        );
        expect(root.textContent).toContain(
          'organization roles could not be loaded',
        );
        expect(updateTemplate).not.toHaveBeenCalled();
        const retry = [...root.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Try again',
        );
        if (!retry) throw new Error('Expected the role retry action');
        retry.click();
        await vi.waitFor(async () => {
          await fixture.whenStable();
          expect(field().errors()).toEqual([]);
          expect(
            root.querySelector<HTMLButtonElement>('button[type="submit"]')
              ?.disabled,
          ).toBe(false);
        });
        await submitTemplate(fixture);
        expect(updateTemplate).toHaveBeenCalledOnce();
      }
    },
  );

  const renderForSave = async () => {
    const fixture = render();
    fixture.componentRef.setInput('templateId', 'template-1');
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected template editor');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        root.querySelector('[data-testid="platform-template-editor"]'),
      ).not.toBeNull();
    });
    const title = root.querySelector('input');
    const reasonField = [...root.querySelectorAll('mat-form-field')].find(
      (field) =>
        field.querySelector('mat-label')?.textContent?.trim() ===
        'Operational reason',
    );
    const reason = reasonField?.querySelector('textarea');
    const form = root.querySelector('form');
    const save = root.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (!title || !reason || !form || !save)
      throw new Error('Expected title, reason, form and save button');
    title.value = 'Submitted trip';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    reason.value = 'Update the advertised trip';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(save.disabled).toBe(false);
    });
    return { fixture, form, reason, root, save, title };
  };

  it.each([
    { error: new Error('Response was lost'), label: 'transport' },
    {
      error: new RpcInternalServerError({ message: 'Private storage failure' }),
      label: 'internal',
    },
  ])(
    'keeps an unconfirmed $label save separate from an unsaved template',
    async ({ error }) => {
      let simulatedServerCommit = false;
      updateTemplate.mockImplementationOnce(async () => {
        simulatedServerCommit = true;
        throw error;
      });
      const { fixture, form, reason, title } = await renderForSave();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledWith(
          'The save outcome could not be confirmed. Open the template list, load the page again and check this template before trying again.',
        );
      });
      await fixture.whenStable();
      expect(simulatedServerCommit).toBe(true);
      expect(updateTemplate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          reason: 'Update the advertised trip',
          registrationOptions: expect.arrayContaining([
            expect.objectContaining({
              price: 1000,
              stripeTaxRateId: 'txr-organizer',
            }),
          ]),
          title: 'Submitted trip',
        }),
        expect.objectContaining({ client: queryClient }),
      );
      expect(title.value).toBe('Submitted trip');
      expect(reason.value).toBe('Update the advertised trip');
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    },
  );

  it('keeps the allowlisted validation reason visible without exposing internal failures', async () => {
    updateTemplate.mockRejectedValueOnce(
      new RpcBadRequestError({
        message: 'Choose a current organization role.',
      }),
    );
    const { form, title } = await renderForSave();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(
        TestBed.inject(NotificationService).showError,
      ).toHaveBeenCalledWith('Choose a current organization role.');
    });
    expect(updateTemplate).toHaveBeenCalledOnce();
    expect(title.value).toBe('Submitted trip');
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it('reports a confirmed save when the active template read fails and retains the entered model on recovery', async () => {
    const { fixture, form, root } = await renderForSave();
    loadTemplate.mockRejectedValueOnce(new Error('Template read failed'));
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        TestBed.inject(NotificationService).showError,
      ).toHaveBeenCalledWith(
        'The template was saved, but the latest template information could not be loaded. Load this template again to see the saved details.',
      );
      expect(
        queryClient.getQueryState(['platform', 'templates', 'detail'])?.status,
      ).toBe('error');
    });
    expect(updateTemplate).toHaveBeenCalledOnce();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    const retry = await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      const button = [...root.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Try again',
      );
      if (!button)
        throw new Error('Expected retry after the failed template read');
      expect(button.disabled).toBe(false);
      return button;
    });
    retry.click();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.querySelector('input')?.value).toBe('Submitted trip');
    });
  });

  it('confirms an existing template saved on its current page without redundant navigation', async () => {
    const router = TestBed.inject(Router);
    vi.mocked(router.navigate).mockRestore();
    router.resetConfig([
      {
        component: EditorStub,
        path: 'global-admin/tenants/:tenantId/templates/:templateId',
      },
    ]);
    const destination = '/global-admin/tenants/tenant-1/templates/template-1';
    await expect(router.navigateByUrl(destination)).resolves.toBe(true);
    await expect(router.navigateByUrl(destination)).resolves.toBe(false);
    const navigate = vi.spyOn(router, 'navigate');
    const { fixture, form, save, title } = await renderForSave();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');

    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(async () => {
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).toHaveBeenCalledExactlyOnceWith('Template updated');
      expect(fixture.componentInstance['templateForm']().submitting()).toBe(
        false,
      );
      expect(save.disabled).toBe(false);
    });
    expect(updateTemplate).toHaveBeenCalledOnce();
    expect(updateTemplate.mock.calls[0]?.[0].title).toBe('Submitted trip');
    expect(loadTemplate).toHaveBeenCalledTimes(2);
    expect(invalidation).toHaveBeenCalledExactlyOnceWith(
      { queryKey: ['platform', 'templates'] },
      { throwOnError: true },
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(
      TestBed.inject(NotificationService).showError,
    ).not.toHaveBeenCalled();
    expect(router.url).toBe(destination);
    expect(title.value).toBe('Submitted trip');
  });

  it.each(['rejected', 'cancelled'] as const)(
    'reports confirmed save after %s navigation',
    async (outcome) => {
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      if (outcome === 'rejected')
        navigate.mockRejectedValueOnce(new Error('Navigation failed'));
      else navigate.mockResolvedValueOnce(false);
      const { form, reason, title } = await renderForSave();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledWith(
          'The template was saved, but its page could not be opened. Open it from the template list before making further changes.',
        );
      });
      expect(updateTemplate).toHaveBeenCalledOnce();
      expect(navigate).toHaveBeenCalledExactlyOnceWith([
        '/global-admin/tenants',
        'tenant-1',
        'templates',
        'template-1',
      ]);
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
      expect(title.value).toBe('Submitted trip');
      expect(reason.value).toBe('Update the advertised trip');
    },
  );

  it('keeps fields edited during a save dirty and blocks another submit through navigation', async () => {
    let finishSave: ((value: TemplateGraphRecord) => void) | undefined;
    let finishNavigation: ((opened: boolean) => void) | undefined;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const saving = new Promise<TemplateGraphRecord>((resolve) => {
      finishSave = resolve;
    });
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const navigation = new Promise<boolean>((resolve) => {
      finishNavigation = resolve;
    });
    updateTemplate.mockReturnValueOnce(saving);
    vi.mocked(TestBed.inject(Router).navigate).mockReturnValueOnce(navigation);
    const { fixture, form, save, title } = await renderForSave();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    try {
      await vi.waitFor(() => expect(updateTemplate).toHaveBeenCalledOnce());
      title.value = 'Later unsent title';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      if (!finishSave) throw new Error('Expected pending save');
      finishSave(completeTemplate());
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledOnce();
        expect(save.disabled).toBe(true);
      });
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
      expect(updateTemplate).toHaveBeenCalledOnce();
      expect(updateTemplate.mock.calls[0]?.[0].title).toBe('Submitted trip');
      expect(title.value).toBe('Later unsent title');
      const confirmDiscard = vi.fn(() => false);
      vi.stubGlobal('confirm', confirmDiscard);
      expect(fixture.componentInstance.canDeactivate()).toBe(false);
      expect(confirmDiscard).toHaveBeenCalledOnce();
    } finally {
      if (finishSave) finishSave(completeTemplate());
      finishNavigation?.(false);
      await fixture.whenStable();
    }
  });
  it('keeps the full save locked until active template siblings settle after one rejects', async () => {
    const { fixture, form, reason, save, title } = await renderForSave();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    let releaseSibling: ((value: string[]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldSibling = new Promise<string[]>((resolve) => {
      releaseSibling = resolve;
    });
    const listKey = ['platform', 'templates', 'list', 'tenant-1'];
    const siblingKey = ['platform', 'templates', 'form-options', 'tenant-2'];
    const loadList = vi.fn(async () => ['template-1']);
    const loadSibling = vi.fn(async () => ['category-1']);
    const listObserver = new QueryObserver(queryClient, {
      queryFn: loadList,
      queryKey: listKey,
    });
    const siblingObserver = new QueryObserver(queryClient, {
      queryFn: loadSibling,
      queryKey: siblingKey,
    });
    const unsubscribeList = listObserver.subscribe(() => {
      // Keep the failed list in the active refetch population.
    });
    const unsubscribeSibling = siblingObserver.subscribe(() => {
      // Keep the held sibling in the active refetch population.
    });
    const modelSnapshot = JSON.stringify(
      fixture.componentInstance['templateModel'](),
    );
    try {
      await vi.waitFor(() => {
        expect(listObserver.getCurrentResult().status).toBe('success');
        expect(siblingObserver.getCurrentResult().status).toBe('success');
      });
      loadList.mockRejectedValueOnce(
        new Error('Template list failed before the sibling settled'),
      );
      loadSibling.mockReturnValueOnce(heldSibling);
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(listObserver.getCurrentResult().status).toBe('error');
        expect(siblingObserver.getCurrentResult().fetchStatus).toBe('fetching');
        expect(fixture.componentInstance['updateMutation'].isPending()).toBe(
          false,
        );
        expect(fixture.componentInstance['templateForm']().submitting()).toBe(
          true,
        );
        expect(save.disabled).toBe(true);
      });
      expect(
        TestBed.inject(NotificationService).showError,
      ).not.toHaveBeenCalled();
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      fixture.componentInstance['save'](
        new Event('submit', { cancelable: true }),
      );
      expect(updateTemplate).toHaveBeenCalledOnce();
      expect(fixture.componentInstance['templateForm']().submitting()).toBe(
        true,
      );
      if (!releaseSibling)
        throw new Error('Expected the owned active sibling read');
      releaseSibling(['category-1']);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.componentInstance['templateForm']().submitting()).toBe(
          false,
        );
        expect(save.disabled).toBe(false);
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledExactlyOnceWith(
          'The template was saved, but the latest template information could not be loaded. Load this template again to see the saved details.',
        );
      });
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(
        { queryKey: ['platform', 'templates'] },
        { throwOnError: true },
      );
      expect(loadList).toHaveBeenCalledTimes(2);
      expect(loadSibling).toHaveBeenCalledTimes(2);
      expect(loadTemplate).toHaveBeenCalledTimes(2);
      expect(updateTemplate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          reason: 'Update the advertised trip',
          targetTenantId: 'tenant-1',
          templateId: 'template-1',
          title: 'Submitted trip',
        }),
        expect.objectContaining({ client: queryClient }),
      );
      expect(JSON.stringify(fixture.componentInstance['templateModel']())).toBe(
        modelSnapshot,
      );
      expect(title.value).toBe('Submitted trip');
      expect(reason.value).toBe('Update the advertised trip');
    } finally {
      releaseSibling?.(['released']);
      try {
        await vi.waitFor(() =>
          expect(fixture.componentInstance['templateForm']().submitting()).toBe(
            false,
          ),
        );
      } finally {
        unsubscribeList();
        unsubscribeSibling();
      }
    }
  });

  it('finishes saving while an inactive matching template read remains held', async () => {
    const { fixture, form, reason, save, title } = await renderForSave();
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    let releaseInactive: ((value: string[]) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const heldInactive = new Promise<string[]>((resolve) => {
      releaseInactive = resolve;
    });
    const inactiveKey = ['platform', 'templates', 'list', 'inactive-tenant'];
    const loadInactive = vi.fn(async () => ['template-2']);
    const observer = new QueryObserver(queryClient, {
      queryFn: loadInactive,
      queryKey: inactiveKey,
    });
    const unsubscribe = observer.subscribe(() => {
      // Establish an active query before explicitly making it inactive.
    });
    let inactiveRead: Promise<string[]> | undefined;
    const modelSnapshot = JSON.stringify(
      fixture.componentInstance['templateModel'](),
    );
    try {
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().status).toBe('success'),
      );
      unsubscribe();
      loadInactive.mockReturnValueOnce(heldInactive);
      inactiveRead = queryClient.fetchQuery({
        queryFn: loadInactive,
        queryKey: inactiveKey,
      });
      expect(
        queryClient
          .getQueryCache()
          .find({ exact: true, queryKey: inactiveKey })
          ?.isActive(),
      ).toBe(false);
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          TestBed.inject(NotificationService).showSuccess,
        ).toHaveBeenCalledExactlyOnceWith('Template updated');
        expect(fixture.componentInstance['templateForm']().submitting()).toBe(
          false,
        );
        expect(save.disabled).toBe(false);
      });
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      expect(loadInactive).toHaveBeenCalledTimes(2);
      expect(loadTemplate).toHaveBeenCalledTimes(2);
      expect(updateTemplate).toHaveBeenCalledOnce();
      expect(
        TestBed.inject(NotificationService).showError,
      ).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledExactlyOnceWith([
        '/global-admin/tenants',
        'tenant-1',
        'templates',
        'template-1',
      ]);
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(
        { queryKey: ['platform', 'templates'] },
        { throwOnError: true },
      );
      expect(JSON.stringify(fixture.componentInstance['templateModel']())).toBe(
        modelSnapshot,
      );
      expect(title.value).toBe('Submitted trip');
      expect(reason.value).toBe('Update the advertised trip');
    } finally {
      releaseInactive?.(['released']);
      try {
        await inactiveRead;
      } finally {
        try {
          await vi.waitFor(() =>
            expect(
              fixture.componentInstance['templateForm']().submitting(),
            ).toBe(false),
          );
        } finally {
          unsubscribe();
        }
      }
    }
  });

  it('keeps add-on creation independent of the question cap and explains overlong help text', async () => {
    const template = completeTemplate();
    const [question] = template.questions;
    if (!question) throw new Error('Expected a persisted template question');
    loadTemplate.mockResolvedValue({
      ...template,
      questions: Array.from(
        { length: MAX_REGISTRATION_QUESTIONS - 1 },
        (_, index) => ({
          ...question,
          id: `question-${index + 1}`,
          sortOrder: index,
        }),
      ),
    });
    const fixture = render();
    fixture.componentRef.setInput('templateId', 'template-1');
    const element: unknown = fixture.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected the platform template root');
    const button = (label: string) => {
      const found = [...element.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === label,
      );
      if (!found) throw new Error(`Expected ${label} button`);
      return found;
    };
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        element.querySelector('[aria-labelledby="template-questions-title"]'),
      ).not.toBeNull();
    });
    const questionSection = element.querySelector(
      '[aria-labelledby="template-questions-title"]',
    );
    if (!questionSection) throw new Error('Expected question section');
    const help = questionSection.querySelector('textarea');
    if (!(help instanceof HTMLTextAreaElement))
      throw new Error('Expected question help input');
    help.value = 'a'.repeat(MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH + 1);
    help.dispatchEvent(new Event('input', { bubbles: true }));
    help.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(help.closest('mat-form-field')?.textContent).toContain(
      `Question descriptions must be ${MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH} characters or fewer.`,
    );
    expect(questionSection.querySelectorAll('legend')).toHaveLength(
      MAX_REGISTRATION_QUESTIONS - 1,
    );
    expect(button('Add question').disabled).toBe(false);
    button('Add question').click();
    fixture.detectChanges();
    expect(questionSection.querySelectorAll('legend')).toHaveLength(
      MAX_REGISTRATION_QUESTIONS,
    );
    expect(button('Add question').disabled).toBe(true);
    const addOnSection = element.querySelector(
      '[aria-labelledby="template-add-ons-title"]',
    );
    expect(addOnSection?.querySelectorAll('legend')).toHaveLength(1);
    expect(button('Add add-on').disabled).toBe(false);
    button('Add add-on').click();
    fixture.detectChanges();
    expect(addOnSection?.querySelectorAll('legend')).toHaveLength(2);
  });

  it('keeps loaded paid prices while tax loading fails and payment settings become unavailable', async () => {
    taxRateFailuresRemaining = 1;
    const fixture = render();
    fixture.componentRef.setInput('templateId', 'template-1');
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected the platform template root');
    const prices = () =>
      [
        ...root.querySelectorAll<HTMLInputElement>(
          '[aria-label="Price (EUR)"]',
        ),
      ].map((input) => input.value);
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.textContent).toContain('Tax rates could not be loaded.');
      expect(prices()).toEqual(['10', '4.5']);
    });
    const reasonField = [...root.querySelectorAll('mat-form-field')].find(
      (field) =>
        field.querySelector('mat-label')?.textContent?.trim() ===
        'Operational reason',
    );
    const reason = reasonField?.querySelector('textarea');
    if (!(reason instanceof HTMLTextAreaElement))
      throw new Error('Expected the operational reason input');
    reason.value =
      'Keep existing pricing while checking the payment configuration';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    const form = root.querySelector('form');
    if (!(form instanceof HTMLFormElement))
      throw new Error('Expected the template form');
    expect(root.textContent).not.toContain(
      'Previously selected tax rate (no longer available)',
    );
    expect(
      root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(createTemplate).not.toHaveBeenCalled();
    expect(updateTemplate).not.toHaveBeenCalled();
    const taxAlert = [
      ...root.querySelectorAll<HTMLElement>('[role="alert"]'),
    ].find((element) =>
      element.textContent?.includes('Tax rates could not be loaded.'),
    );
    const retry = taxAlert?.querySelector<HTMLButtonElement>('button');
    if (!retry)
      throw new Error('Expected the platform tax catalog retry button');
    retry.click();
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(loadTaxRates).toHaveBeenCalledTimes(2);
      expect(root.textContent).not.toContain('Tax rates could not be loaded.');
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    });
    expect(prices()).toEqual(['10', '4.5']);
    queryClient.setQueryData(['platform-template', 'tenant'], {
      currency: 'EUR',
      paymentsConfigured: false,
    });
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.textContent?.replaceAll(/\s+/g, ' ')).toContain(
        'Existing paid registration options and add-ons are preserved.',
      );
      expect(prices()).toEqual(['10', '4.5']);
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(true);
    });
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(createTemplate).not.toHaveBeenCalled();
    expect(updateTemplate).not.toHaveBeenCalled();
    queryClient.setQueryData(['platform-template', 'tenant'], {
      currency: 'EUR',
      paymentsConfigured: true,
    });
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(prices()).toEqual(['10', '4.5']);
      expect(
        root.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    });
  });

  it('retries failed target-organization form options from the page', async () => {
    optionFailuresRemaining = 1;
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain('Try again');
    });

    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.trim() === 'Try again',
    );
    if (!retry) throw new Error('Expected the editor retry action');
    retry.click();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });
    expect(loadOptions).toHaveBeenCalledTimes(2);
    const renderedText = fixture.nativeElement.textContent.replaceAll(
      /\s+/g,
      ' ',
    );
    expect(renderedText).toContain('Calendar');
    expect(renderedText).not.toContain('Icon name');
    expect(renderedText).not.toContain('Google place ID');
  });

  it('explains that blank deadlines inherit the organization defaults', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });

    const text = fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ');
    expect(
      text.match(/Leave blank to use the organization default\./g),
    ).toHaveLength(4);
    expect(text).not.toContain('Leave blank for no template deadline.');
  });

  it('warns before route or browser navigation discards template work', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });
    expect(fixture.componentInstance.canDeactivate()).toBe(true);

    const title = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input');
    if (!title) throw new Error('Expected the template title input');
    title.value = 'Changed template title';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    const confirmDiscard = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmDiscard);
    expect(fixture.componentInstance.canDeactivate()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith(
      'You have unsaved template changes. Leave this page and discard them?',
    );

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    globalThis.window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    confirmDiscard.mockReturnValue(true);
    expect(fixture.componentInstance.canDeactivate()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('keeps navigation blocked while dirty editor data is refetching', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="platform-template-editor"]',
        ),
      ).not.toBeNull();
    });

    const title = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>('input');
    if (!title) throw new Error('Expected the template title input');
    title.value = 'Changed during a refresh';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    let resolveRefetch:
      ((options: Awaited<ReturnType<typeof loadOptions>>) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingOptions = new Promise<Awaited<ReturnType<typeof loadOptions>>>(
      (resolve) => {
        resolveRefetch = resolve;
      },
    );
    loadOptions.mockImplementationOnce(() => pendingOptions);
    const refetch = queryClient.refetchQueries({
      exact: true,
      queryKey: ['platform-template', 'options'],
    });

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(['platform-template', 'options'])
          ?.fetchStatus,
      ).toBe('fetching');
    });
    const confirmDiscard = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmDiscard);
    expect(fixture.componentInstance.canDeactivate()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledOnce();

    if (!resolveRefetch) throw new Error('Expected the refetch to start');
    resolveRefetch({
      categories: [{ id: 'category-1', title: 'Trips' }],
      esnCardEnabled: false,
      iconChoices: [
        {
          commonName: 'calendar:fas',
          friendlyName: 'Calendar',
          id: 'icon-1',
          sourceColor: 42,
        },
      ],
    });
    await refetch;
  });
});

const completeTemplate = (): TemplateGraphRecord => ({
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: false,
      description: 'Add-on description',
      id: 'addon-1',
      isPaid: true,
      maxQuantityPerUser: 3,
      price: 450,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 0,
          registrationOptionId: 'organizer-option',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionId: 'participant-option',
        },
      ],
      stripeTaxRateId: 'txr-addon',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    },
  ],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: { iconColor: 4, iconName: 'campground:fas' },
  id: 'template-1',
  location: {
    address: 'Main Street 1',
    coordinates: { lat: 52.1, lng: 4.3 },
    name: 'Student Center',
    placeId: 'google-place-1',
    type: 'google',
  },
  planningTips: 'Bring the banner',
  questions: [
    {
      description: 'Dietary needs',
      id: 'question-1',
      registrationOptionId: 'participant-option',
      required: true,
      sortOrder: 2,
      title: 'Do you have dietary requirements?',
    },
  ],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: 48,
      closeRegistrationOffset: 12,
      description: 'Organizer description',
      esnCardDiscountedPrice: 800,
      id: 'organizer-option',
      isPaid: true,
      openRegistrationOffset: 240,
      organizingRegistration: true,
      price: 1000,
      refundFeesOnCancellation: false,
      registeredDescription: 'Organizer confirmation',
      registrationMode: 'application',
      roleIds: ['organizer-role'],
      roles: [{ id: 'organizer-role', name: 'Organizer' }],
      spots: 5,
      stripeTaxRateId: 'txr-organizer',
      title: 'Organizers',
      transferDeadlineHoursBeforeStart: 72,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 2,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'participant-option',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['member-role'],
      roles: [{ id: 'member-role', name: 'Member' }],
      spots: 30,
      stripeTaxRateId: null,
      title: 'Participants',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  title: 'Weekend trip',
  unlisted: true,
});

describe('platform template editor graph mapping', () => {
  it('round-trips every supported mode and multi-option add-on mapping', () => {
    const loadResult = platformTemplateRecordToFormModel(completeTemplate());

    expect('model' in loadResult).toBe(true);
    if (!('model' in loadResult)) return;
    expect(loadResult.model.registrationOptions[1]?.registrationMode).toBe(
      'fcfs',
    );
    expect(loadResult.model.addOns[0]?.registrationOptions).toEqual([
      {
        includedQuantity: 2,
        optionalPurchaseQuantity: 0,
        registrationOptionKey: 'organizer-option',
      },
      {
        includedQuantity: 0,
        optionalPurchaseQuantity: 1,
        registrationOptionKey: 'participant-option',
      },
    ]);

    const payload = platformTemplateFormToPayload(loadResult.model, true);

    expect(payload.registrationOptions).toEqual([
      {
        cancellationDeadlineHoursBeforeStart: 48,
        closeRegistrationOffset: 12,
        description: 'Organizer description',
        esnCardDiscountedPrice: 800,
        id: 'organizer-option',
        isPaid: true,
        key: 'organizer-option',
        openRegistrationOffset: 240,
        organizingRegistration: true,
        price: 1000,
        refundFeesOnCancellation: false,
        registeredDescription: 'Organizer confirmation',
        registrationMode: 'application',
        roleIds: ['organizer-role'],
        spots: 5,
        stripeTaxRateId: 'txr-organizer',
        title: 'Organizers',
        transferDeadlineHoursBeforeStart: 72,
      },
      {
        cancellationDeadlineHoursBeforeStart: null,
        closeRegistrationOffset: 2,
        description: null,
        esnCardDiscountedPrice: null,
        id: 'participant-option',
        isPaid: false,
        key: 'participant-option',
        openRegistrationOffset: 168,
        organizingRegistration: false,
        price: 0,
        refundFeesOnCancellation: null,
        registeredDescription: null,
        registrationMode: 'fcfs',
        roleIds: ['member-role'],
        spots: 30,
        stripeTaxRateId: null,
        title: 'Participants',
        transferDeadlineHoursBeforeStart: null,
      },
    ]);
    expect(payload.addOns[0]).toEqual({
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: true,
      allowPurchaseDuringRegistration: false,
      description: 'Add-on description',
      id: 'addon-1',
      isPaid: true,
      key: 'addon-1',
      maxQuantityPerUser: 3,
      price: 450,
      registrationOptions: [
        {
          includedQuantity: 2,
          optionalPurchaseQuantity: 0,
          registrationOptionKey: 'organizer-option',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 1,
          registrationOptionKey: 'participant-option',
        },
      ],
      stripeTaxRateId: 'txr-addon',
      title: 'Dinner',
      totalAvailableQuantity: 40,
    });
    expect(payload.questions[0]).toEqual({
      description: 'Dietary needs',
      id: 'question-1',
      key: 'question-1',
      registrationOptionKey: 'participant-option',
      required: true,
      sortOrder: 2,
      title: 'Do you have dietary requirements?',
    });
    expect({
      categoryId: payload.categoryId,
      description: payload.description,
      icon: payload.icon,
      planningTips: payload.planningTips,
      simpleModeEnabled: payload.simpleModeEnabled,
      title: payload.title,
      unlisted: payload.unlisted,
    }).toEqual({
      categoryId: 'category-1',
      description: '<p>Template description</p>',
      icon: { iconColor: 4, iconName: 'campground:fas' },
      planningTips: 'Bring the banner',
      simpleModeEnabled: false,
      title: 'Weekend trip',
      unlisted: true,
    });
  });

  it('explains why a random-allocation template cannot be edited', () => {
    const source = completeTemplate();
    const legacyRandomTemplate: TemplateGraphRecord = {
      ...source,
      registrationOptions: source.registrationOptions.map((option, index) =>
        index === 1 ? { ...option, registrationMode: 'random' } : option,
      ),
    };

    expect(platformTemplateRecordToFormModel(legacyRandomTemplate)).toEqual({
      error:
        'Random allocation is unavailable. Create a new template using First come, first served or Manual approval instead.',
    });
  });

  it('fails only when a persisted graph reference is genuinely corrupt', () => {
    const source = completeTemplate();
    const corrupt: TemplateGraphRecord = {
      ...source,
      questions: source.questions.map((question) => ({
        ...question,
        registrationOptionId: 'missing-option',
      })),
    };

    expect(platformTemplateRecordToFormModel(corrupt)).toEqual({
      error:
        'A sign-up question or add-on points to a choice that no longer exists. Ask Evorto support to repair this template before editing it.',
    });
  });

  it('allows supported one-save mode changes while keeping the required final shape', () => {
    const source = completeTemplate();
    const [organizerOption, participantOption] = source.registrationOptions;
    if (!organizerOption || !participantOption)
      throw new Error('Expected two registration options');
    const currentOptions = [organizerOption, participantOption];
    expect(
      platformTemplateModeTransitionIssue('simple', currentOptions),
    ).toBeNull();
    expect(
      platformTemplateModeTransitionIssue('advanced', currentOptions),
    ).toBeNull();
    expect(
      platformTemplateModeTransitionIssue('simple', [
        organizerOption,
        { ...participantOption, organizingRegistration: true },
      ]),
    ).toContain('exactly one organizing and one non-organizing option');
  });

  it('reuses the shared graph validation and confirms mode changes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-template-editor.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-template-editor.component.html',
      ),
      'utf8',
    );

    expect(source).toContain(
      'apply(registration, templateGraphRegistrationOptionFormSchema)',
    );
    expect(source).toContain('apply(addOn, templateGraphAddonFormSchema)');
    expect(source).toContain(
      'applyEach(template.questions, templateGraphQuestionFormSchema)',
    );
    expect(source).toContain('TemplateModeConfirmationDialogComponent');
    expect(source).not.toContain('persistedAdvancedToSimpleModeIssue');
    expect(source).toContain('globalAdmin.tenants.findOne.queryOptions');
    expect(source).toContain(
      'disabled(registration.isPaid, () => !this.stripeConnected())',
    );
    expect(source).toContain(
      'disabled(addOn.isPaid, () => !this.stripeConnected())',
    );
    expect(source).not.toContain('resetTemplateGraphPayments');
    expect(source).toContain('paidGraphBlocked');
    expect(source).toContain('paymentSettingsReady');
    expect(source).toContain('taxRatesReady');
    expect(template).toContain("requestMode('simple')");
    expect(template).toContain("requestMode('advanced')");
    expect(template).toContain('status could not be loaded');
    expect(template.match(/<app-currency-amount-input/g)?.length).toBe(3);
    expect(template.match(/\[minimumMinorUnits\]="1"/g)?.length).toBe(2);
    expect(template).toContain('[currencyCode]="targetTenantCurrency()"');
    expect(template).not.toContain('(cents)');
    expect(template).toContain(
      'Previously selected category (no longer available)',
    );
    expect(template).toMatch(
      /Previously selected organization role \(no longer\s+available\)/u,
    );
    expect(template.match(/Previously selected tax rate/g)?.length).toBe(2);
    expect(template).not.toContain('{{ selectedCategoryId }}');
    expect(template).not.toContain('{{ missingRoleId }}');
    expect(template).not.toContain('{{ selectedTaxRateId }}');
    expect(source).toContain("['RpcBadRequestError']");
    expect(template).not.toContain(
      '[formField]="templateForm.simpleModeEnabled"',
    );
  });

  it('reinitializes a new template when the organization changes', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-event-operations/platform-template-editor.component.ts',
      ),
      'utf8',
    );

    expect(source).toContain(
      'private readonly initializedNewTemplateTenantId = signal<null | string>(null)',
    );
    expect(source).toContain(
      'this.initializedNewTemplateTenantId() === tenantId',
    );
    expect(source).toContain(
      'this.initializedNewTemplateTenantId.set(tenantId)',
    );
    expect(source).toContain('const model = createPlatformTemplateFormModel()');
    expect(source).not.toContain('initializedNewTemplate = signal(false)');
  });
});
