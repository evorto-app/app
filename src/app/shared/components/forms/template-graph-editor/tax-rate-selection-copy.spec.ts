import '@angular/compiler';
import { manualChangeDetection } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { provideLuxonDateAdapter } from '@angular/material-luxon-adapter';
import { DateAdapter } from '@angular/material/core';
import { MatFormFieldHarness } from '@angular/material/form-field/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { createRpcQueryKey } from '@heddendorp/effect-angular-query';
import { writableRegistrationModes } from '@shared/registration-modes';
import { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import {
  injectQuery,
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../../../core/config.service';
import {
  APP_RPC_CLIENT,
  AppRpc,
} from '../../../../core/effect-rpc-angular-client';
import { TenantLuxonDateAdapter } from '../../../../core/tenant-luxon-date-adapter';
import { EventAddonEditor } from '../../../../events/event-edit/event-addon-editor';
import {
  createEmptyEventGraphFormModel,
  createEventGraphAddon,
  createEventGraphRegistrationOption,
  type EventGraphFormModel,
} from '../../../../events/event-edit/event-graph-form.model';
import { eventGraphFormSchema } from '../../../../events/event-edit/event-graph-form.schema';
import { EventRegistrationOptionEditor } from '../../../../events/event-edit/event-registration-option-editor';
import { RegistrationOptionForm } from '../registration-option-form/registration-option-form';
import {
  createRegistrationOptionFormModel,
  registrationOptionFormSchema,
} from '../registration-option-form/registration-option-form.schema';

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(process.cwd(), sourcePath), 'utf8');

const taxRateSelectorTemplates = [
  'src/app/events/event-edit/event-addon-editor.html',
  'src/app/events/event-edit/event-registration-option-editor.html',
  'src/app/shared/components/forms/registration-option-form/registration-option-form.html',
  'src/app/shared/components/forms/template-graph-editor/template-addon-editor.component.html',
  'src/app/shared/components/forms/template-graph-editor/template-registration-option-editor.component.html',
  'src/app/global-admin/platform-event-operations/platform-event-detail.component.html',
] as const;

describe('tax-rate selection copy', () => {
  it.each(taxRateSelectorTemplates)(
    'blocks rates without a percentage and explains the missing detail in %s',
    (sourcePath) => {
      const template = readSource(sourcePath);

      expect(template).toContain('[disabled]="rate.percentage === null"');
      expect(template).toContain('Tax rate percentage unavailable');
      expect(template).not.toContain('rate.percentage ?? "?"');
      expect(template).not.toContain(
        'rate.displayName || rate.stripeTaxRateId',
      );
    },
  );

  it('keeps provider references out of the platform import selector', () => {
    const template = readSource(
      'src/app/global-admin/platform-tenant-admin/platform-tax-rates.component.html',
    );

    expect(template).toContain(
      'Percentage unavailable; this rate cannot be imported',
    );
    expect(template).not.toContain('rate.displayName || rate.id');
    expect(template).not.toContain('{{ rate.id }}');
  });

  it('marks incomplete imported rates as unavailable instead of presenting a null percentage', () => {
    const settings = readSource(
      'src/app/admin/tax-rates-settings/tax-rates-settings.component.ts',
    );
    const importDialog = readSource(
      'src/app/admin/components/import-tax-rates-dialog/import-tax-rates-dialog.component.html',
    );

    expect(settings).toContain('Percentage unavailable');
    expect(settings).toContain('rate.percentage === null');
    expect(importDialog).toContain('rate.percentage === null');
    expect(importDialog).toContain('Percentage missing');
  });

  it('blocks incomplete rates in the platform template editor', () => {
    const source = readSource(
      'src/app/global-admin/platform-event-operations/platform-template-editor.component.ts',
    );
    const template = readSource(
      'src/app/global-admin/platform-event-operations/platform-template-editor.component.html',
    );

    expect(
      template.match(/\[disabled\]="rate\.percentage === null"/g),
    ).toHaveLength(2);
    expect(source).toContain(
      'Percentage unavailable; this rate cannot be selected',
    );
  });
});

type TaxSelectorSurface =
  'event-addon' | 'event-registration' | 'shared-registration';

const renderedTaxSelectorSurfaces: readonly TaxSelectorSurface[] = [
  'event-addon',
  'event-registration',
  'shared-registration',
];

const taxSelectorGraphModel = (): EventGraphFormModel => {
  const model = createEmptyEventGraphFormModel('Europe/Berlin');
  const option = {
    ...createEventGraphRegistrationOption(model),
    isPaid: true,
    price: 100,
    stripeTaxRateId: 'txr-standard',
  };
  const addOn = {
    ...createEventGraphAddon(option.key),
    isPaid: true,
    price: 100,
    stripeTaxRateId: 'txr-standard',
  };
  return {
    ...model,
    addOns: [addOn],
    description: '<p>Tax selector test event.</p>',
    end: model.start.plus({ hours: 2 }),
    icon: { iconColor: 0, iconName: 'calendar:fas' },
    registrationOptions: [option],
    title: 'Tax selector test event',
  };
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventAddonEditor,
    EventRegistrationOptionEditor,
    RegistrationOptionForm,
  ],
  selector: 'app-tax-selector-test-host',
  template: `
    @switch (surface()) {
      @case ('event-addon') {
        @for (addOn of graphForm.addOns; track addOn) {
          <app-event-addon-editor
            [taxRates]="availableTaxRates()"
            [taxRateState]="taxRateState()"
            [addOnForm]="addOn"
            currencyCode="EUR"
            [optionChoices]="[]"
          />
        }
      }
      @case ('event-registration') {
        @for (option of graphForm.registrationOptions; track option) {
          <app-event-registration-option-editor
            [taxRates]="availableTaxRates()"
            [taxRateState]="taxRateState()"
            [optionForm]="option"
            currencyCode="EUR"
            [esnEnabled]="false"
          />
        }
      }
      @case ('shared-registration') {
        <app-registration-option-form
          [taxRates]="availableTaxRates()"
          [taxRateState]="taxRateState()"
          [registrationOptionForm]="sharedForm"
          [esnEnabled]="false"
          [registrationModes]="registrationModes"
        />
      }
    }
  `,
})
class TaxSelectorTestHost {
  private readonly rpc = AppRpc.injectClient();
  readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
  readonly availableTaxRates = computed(() =>
    this.taxRatesQuery.isSuccess() && !this.taxRatesQuery.isFetching()
      ? this.taxRatesQuery.data()
      : undefined,
  );
  readonly taxRateState = computed<'error' | 'loading' | 'ready'>(() =>
    this.taxRatesQuery.isError()
      ? 'error'
      : this.availableTaxRates() === undefined
        ? 'loading'
        : 'ready',
  );
  readonly surface = input.required<TaxSelectorSurface>();
  readonly graphModel = signal(taxSelectorGraphModel());
  readonly graphForm = form(this.graphModel, eventGraphFormSchema);
  readonly registrationModes = writableRegistrationModes;
  readonly sharedModel = signal(
    createRegistrationOptionFormModel({
      isPaid: true,
      price: 100,
      stripeTaxRateId: 'txr-standard',
      title: 'Paid registration choice',
    }),
  );
  readonly sharedForm = form(this.sharedModel, registrationOptionFormSchema);

  selectedTaxRate(): null | string | undefined {
    switch (this.surface()) {
      case 'event-addon': {
        return this.graphModel().addOns[0]?.stripeTaxRateId;
      }
      case 'event-registration': {
        return this.graphModel().registrationOptions[0]?.stripeTaxRateId;
      }
      case 'shared-registration': {
        return this.sharedModel().stripeTaxRateId;
      }
    }
  }
}

describe('rendered tax-rate selector recovery', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type Rates = readonly TaxRatesListActiveRecord[];
  const rates: Rates = [
    {
      country: 'DE',
      displayName: 'Standard',
      id: 'standard-rate',
      percentage: '19',
      state: null,
      stripeTaxRateId: 'txr-standard',
    },
    {
      country: 'DE',
      displayName: 'Reduced',
      id: 'reduced-rate',
      percentage: '7',
      state: null,
      stripeTaxRateId: 'txr-reduced',
    },
  ];
  const emptyMessage =
    'No tax rates are available. Ask someone who manages payments to import a tax rate.';
  const tenant = new ClientTenantConfig({
    cancellationDeadlineHoursBeforeStart: 24,
    currency: 'EUR',
    defaultLocation: undefined,
    discountProviders: { esnCard: { config: {}, status: 'disabled' } },
    domain: 'tax-selector.example.test',
    id: 'tax-selector-tenant',
    maxActiveRegistrationsPerUser: 3,
    name: 'Tax selector tenant',
    paymentsConfigured: true,
    receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
    refundFeesOnCancellation: false,
    theme: 'evorto',
    timezone: 'Europe/Berlin',
    transferDeadlineHoursBeforeStart: 24,
  });
  const queryKey = createRpcQueryKey<undefined>(['taxRates', 'listActive'], {
    type: 'query',
  });
  const readRates = vi.fn<() => Promise<Rates>>();
  const normalizeText = (value: string) => value.replaceAll(/\s+/g, ' ').trim();
  let fixture: ComponentFixture<TaxSelectorTestHost> | undefined;
  let queryClient: QueryClient;
  let releases: (() => void)[];
  let operations: Promise<PromiseSettledResult<void>[]>[];

  const holdRates = () => {
    let fulfill: ((value: Rates) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    // Angular's browser target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<Rates>((resolve, reject) => {
      fulfill = resolve;
      fail = reject;
    });
    releases.push(() => fulfill?.(rates));
    return {
      promise,
      reject: (error: Error) => {
        if (!fail) throw new Error('Expected a deferred tax-rate rejection');
        fail(error);
      },
      resolve: (value: Rates) => {
        if (!fulfill) throw new Error('Expected a deferred tax-rate result');
        fulfill(value);
      },
    };
  };
  const refreshRates = () => {
    const result = Promise.allSettled([
      queryClient.refetchQueries(
        { exact: true, queryKey },
        { throwOnError: true },
      ),
    ]);
    operations.push(result);
    return result;
  };
  const detectChanges = () => {
    if (!fixture) throw new Error('Expected the rendered tax selector');
    fixture.detectChanges();
  };
  const expectPanelMessage = async (
    select: MatSelectHarness,
    expected: string,
  ) => {
    await manualChangeDetection(async () => {
      await vi.waitFor(async () => {
        detectChanges();
        expect(await select.isOpen()).toBe(false);
      });
      await select.open();
      detectChanges();
      try {
        await vi.waitFor(async () => {
          detectChanges();
          const options = await select.getOptions();
          expect(options, expected).toHaveLength(1);
          const option = options[0];
          if (!option) throw new Error('Expected a diagnostic tax-rate option');
          expect(normalizeText(await option.getText())).toBe(expected);
          expect(await option.isDisabled()).toBe(true);
        });
      } finally {
        await select.close();
        await vi.waitFor(async () => {
          detectChanges();
          expect(await select.isOpen()).toBe(false);
        });
      }
    });
  };
  const waitForQuery = async (status: 'error' | 'success') => {
    await vi.waitFor(() => {
      detectChanges();
      expect(queryClient.getQueryState(queryKey)).toEqual(
        expect.objectContaining({ fetchStatus: 'idle', status }),
      );
    });
  };
  const expectSelectedRate = async (
    select: MatSelectHarness,
    expected: string,
  ) => {
    await vi.waitFor(async () => {
      detectChanges();
      expect(normalizeText(await select.getValueText())).toBe(expected);
    });
  };

  beforeEach(async () => {
    releases = [];
    operations = [];
    fixture = undefined;
    readRates.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    await TestBed.configureTestingModule({
      imports: [TaxSelectorTestHost],
      providers: [
        provideTanStackQuery(queryClient),
        provideLuxonDateAdapter(),
        { provide: DateAdapter, useClass: TenantLuxonDateAdapter },
        {
          provide: ConfigService,
          useValue: {
            tenantSignal: signal<ClientTenantConfig | null>(tenant),
          } satisfies Pick<ConfigService, 'tenantSignal'>,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            roles: {
              findMany: {
                queryOptions: (): ReturnType<
                  Client['roles']['findMany']['queryOptions']
                > => ({
                  queryFn: async () => [],
                  queryKey: createRpcQueryKey(['roles', 'findMany'], {
                    input: { search: '' },
                    type: 'query',
                  }),
                }),
              },
            },
            taxRates: {
              listActive: {
                queryOptions: (): ReturnType<
                  Client['taxRates']['listActive']['queryOptions']
                > => ({
                  queryFn: readRates,
                  queryKey,
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const release of releases) release();
    await Promise.all(operations);
    for (const cleanup of [
      () => queryClient.cancelQueries(),
      () => fixture?.destroy(),
      () => queryClient.clear(),
      () => TestBed.resetTestingModule(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Tax selector cleanup failed');
  });

  it.each(renderedTaxSelectorSurfaces)(
    '%s distinguishes empty, loading, and error panels while retaining a selected usable rate through refreshes',
    async (surface) => {
      const initialRead = holdRates();
      readRates.mockReturnValueOnce(initialRead.promise);
      fixture = TestBed.createComponent(TaxSelectorTestHost);
      fixture.componentRef.setInput('surface', surface);
      detectChanges();
      await vi.waitFor(() => {
        detectChanges();
        expect(readRates).toHaveBeenCalledOnce();
      });
      const loader = TestbedHarnessEnvironment.loader(fixture);
      const select = await manualChangeDetection(async () => {
        const field = await loader.getHarness(
          MatFormFieldHarness.with({ floatingLabelText: 'Tax rate' }),
        );
        const control = await field.getControl(MatSelectHarness);
        if (!control) throw new Error('Expected the actual tax-rate MatSelect');
        return control;
      });
      await expectPanelMessage(select, 'Loading tax rates…');
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-standard');

      initialRead.resolve([]);
      await waitForQuery('success');
      await expectPanelMessage(select, emptyMessage);
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-standard');

      readRates.mockResolvedValueOnce(rates);
      expect(await refreshRates()).toEqual([
        { status: 'fulfilled', value: undefined },
      ]);
      await waitForQuery('success');
      await expectSelectedRate(select, 'Standard — 19%');
      await select.clickOptions({ text: /Reduced.*7%/ });
      detectChanges();
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-reduced');
      await expectSelectedRate(select, 'Reduced — 7%');

      const failedRefresh = holdRates();
      readRates.mockReturnValueOnce(failedRefresh.promise);
      const failedOperation = refreshRates();
      await vi.waitFor(() => {
        detectChanges();
        expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(
          'fetching',
        );
      });
      expect(queryClient.getQueryData(queryKey)).toEqual(rates);
      await expectPanelMessage(select, 'Loading tax rates…');
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-reduced');
      const readError = new Error('Private tax-rate read failure');
      failedRefresh.reject(readError);
      expect(await failedOperation).toEqual([
        { reason: readError, status: 'rejected' },
      ]);
      await waitForQuery('error');
      await expectPanelMessage(select, 'Tax rates are unavailable');
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-reduced');

      readRates.mockResolvedValueOnce([]);
      expect(await refreshRates()).toEqual([
        { status: 'fulfilled', value: undefined },
      ]);
      await waitForQuery('success');
      await expectPanelMessage(select, emptyMessage);
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-reduced');

      const successfulRefresh = holdRates();
      readRates.mockReturnValueOnce(successfulRefresh.promise);
      const successfulOperation = refreshRates();
      await vi.waitFor(() => {
        detectChanges();
        expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe(
          'fetching',
        );
      });
      expect(queryClient.getQueryData(queryKey)).toEqual([]);
      await expectPanelMessage(select, 'Loading tax rates…');
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-reduced');
      successfulRefresh.resolve(rates);
      expect(await successfulOperation).toEqual([
        { status: 'fulfilled', value: undefined },
      ]);
      await waitForQuery('success');
      await expectSelectedRate(select, 'Reduced — 7%');
      expect(fixture.componentInstance.selectedTaxRate()).toBe('txr-reduced');
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
      expect(readRates).toHaveBeenCalledTimes(5);
    },
  );
});
