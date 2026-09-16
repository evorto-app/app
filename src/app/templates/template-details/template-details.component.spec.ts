import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { TestBed } from '@angular/core/testing';
import { RpcForbiddenError } from '@shared/errors/rpc-errors';
import {
  TemplateSimpleInternalError,
  TemplateSimpleNotFoundError,
} from '@shared/rpc-contracts/app-rpcs/templates.errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import {
  templateAddonPurchaseTiming,
  TemplateDetailsComponent,
  templateRegistrationOptionTitle,
} from './template-details.component';

const createTemplate = (): TemplateFindOneRecord => ({
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: {
    iconColor: 0,
    iconName: 'calendar:fas',
  },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'template-option-1',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: [],
      roles: [],
      spots: 20,
      stripeTaxRateId: null,
      title: 'Participant registration',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  title: 'Template',
});

describe('template detail add-on helpers', () => {
  it('shows registration-time purchase timing only', () => {
    expect(
      templateAddonPurchaseTiming({
        allowMultiple: true,
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: true,
        description: null,
        id: 'addon-1',
        isPaid: false,
        maxQuantityPerUser: 1,
        price: 0,
        registrationOptions: [],
        stripeTaxRateId: null,
        title: 'Dinner',
        totalAvailableQuantity: 40,
      }),
    ).toBe('During registration');
  });

  it('marks add-ons without purchase windows as unavailable', () => {
    expect(
      templateAddonPurchaseTiming({
        allowMultiple: false,
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: false,
        allowPurchaseDuringRegistration: false,
        description: null,
        id: 'addon-1',
        isPaid: false,
        maxQuantityPerUser: 1,
        price: 0,
        registrationOptions: [],
        stripeTaxRateId: null,
        title: 'Dinner',
        totalAvailableQuantity: 40,
      }),
    ).toBe('Unavailable');
  });

  it('resolves add-on registration option labels from the template record', () => {
    expect(
      templateRegistrationOptionTitle(createTemplate(), 'template-option-1'),
    ).toBe('Participant registration');
  });

  it('keeps missing add-on registration option labels explicit', () => {
    expect(
      templateRegistrationOptionTitle(createTemplate(), 'missing-option'),
    ).toBe('Broken registration option configuration');
  });
});

describe('template detail error state', () => {
  const loadTemplate = vi.fn();
  let queryClient: QueryClient;

  beforeEach(async () => {
    loadTemplate.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    TestBed.overrideComponent(TemplateDetailsComponent, {
      set: {
        template: `
      @if (templateQuery.isError()) { <p role="alert">{{ errorMessage(templateQuery.error()) }}</p> }
    `,
      },
    });
    await TestBed.configureTestingModule({
      imports: [TemplateDetailsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            taxRates: {
              listActive: {
                queryOptions: () => ({
                  enabled: false,
                  queryKey: ['tax-rates'],
                }),
              },
            },
            templates: {
              findOne: {
                queryOptions: () => ({
                  queryFn: loadTemplate,
                  queryKey: ['template-details'],
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  it.each([
    {
      error: new TemplateSimpleNotFoundError({ message: 'Template not found' }),
      expected: 'Template not found',
    },
    {
      error: new RpcForbiddenError({
        message: 'private authorization details',
      }),
      expected: 'Unknown error',
    },
    {
      error: new TemplateSimpleInternalError({
        message: 'private database details',
      }),
      expected: 'Unknown error',
    },
    {
      error: new Error('private transport details'),
      expected: 'Unknown error',
    },
  ])(
    'distinguishes a deleted template without exposing unsafe failures: $expected',
    async ({ error, expected }) => {
      loadTemplate.mockRejectedValueOnce(error);
      const fixture = TestBed.createComponent(TemplateDetailsComponent);
      fixture.componentRef.setInput('templateId', 'template-1');
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(
          fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
        ).toBe(expected);
      });
    },
  );
});
