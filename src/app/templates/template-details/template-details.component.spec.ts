import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import {
  templateAddonPurchaseTiming,
  TemplateDetailsComponent,
  templateDetailsErrorMessage,
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
  it('uses sign-up wording in the template overview', () => {
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/templates/template-details/template-details.component.html',
      ),
      'utf8',
    );

    expect(template).toContain('Sign-up questions');
    expect(template).not.toContain('Registration questions');
  });

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
    ).toBe('Sign-up choice unavailable');
  });
  it('shows a missing template without exposing internal failures', () => {
    expect(
      templateDetailsErrorMessage({
        _tag: 'RpcBadRequestError',
        message: 'Template not found for the target tenant',
        reason: 'templateNotFound',
      }),
    ).toBe(
      'This template could not be found. Return to Templates and choose an existing template.',
    );
  });

  it.each([
    {
      _tag: 'RpcBadRequestError',
      message: 'A different request failed',
      reason: 'invalidTemplate',
    },
    {
      _tag: 'RpcInternalServerError',
      message: 'database failed',
    },
    {
      _tag: 'UnrecognizedTemplateError',
      message: 'stale error',
    },
  ])('keeps other failures behind plain recovery copy', (error) => {
    expect(templateDetailsErrorMessage(error)).toBe(
      'The template could not be loaded. Try again.',
    );
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
    await TestBed.configureTestingModule({
      imports: [TemplateDetailsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        provideRouter([]),
        {
          provide: PermissionsService,
          useValue: { hasPermissionSync: () => false },
        },
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
      error: new RpcBadRequestError({
        message:
          'This template no longer exists in this organization. No changes were made. Return to Templates and choose an existing template.',
        reason: 'templateNotFound',
      }),
      expected:
        'This template could not be found. Return to Templates and choose an existing template.',
    },
    {
      error: new RpcBadRequestError({
        message: 'Private request detail',
        reason: 'invalidTemplate',
      }),
      expected: 'The template could not be loaded. Try again.',
    },
    {
      error: new RpcForbiddenError({
        message: 'private authorization details',
      }),
      expected: 'The template could not be loaded. Try again.',
    },
    {
      error: new RpcInternalServerError({
        message: 'private database details',
      }),
      expected: 'The template could not be loaded. Try again.',
    },
    {
      error: new Error('private transport details'),
      expected: 'The template could not be loaded. Try again.',
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
          fixture.nativeElement.querySelector('p')?.textContent?.trim(),
        ).toBe(`Error: ${expected}`);
        const root: unknown = fixture.nativeElement;
        if (!(root instanceof HTMLElement))
          throw new Error('Expected the template detail root');
        const recovery = [...root.querySelectorAll('a')].find(
          (link) => link.textContent?.trim() === 'Return to Templates',
        );
        expect(recovery?.getAttribute('href')).toBe('/templates');
        expect(root.textContent).not.toContain('private');
        expect(root.textContent).not.toContain('Private');
      });
    },
  );
});
