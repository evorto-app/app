import type { PlatformEventDetailRecord } from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideRouter, Router } from '@angular/router';
import {
  RpcBadRequestError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { QueryObserver } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import {
  PlatformEventCreateComponent,
  PlatformEventCreateOperations,
} from './platform-event-create.component';

@Component({
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

const eventFormOptions = {
  creators: [
    {
      email: 'alex@example.test',
      firstName: 'Alex',
      id: 'user-1',
      lastName: 'Able',
    },
  ],
  esnCardEnabled: false,
  roles: [],
  taxRates: [],
  templates: [{ id: 'template-1', title: 'Weekend template' }],
  timezone: 'Australia/Brisbane',
};

type CreateInput = Parameters<
  NonNullable<ReturnType<PlatformEventCreateOperations['create']>['mutationFn']>
>[0];
const createdEvent: PlatformEventDetailRecord = {
  addOns: [],
  creator: {
    email: 'alex@example.test',
    firstName: 'Alex',
    id: 'user-1',
    lastName: 'Able',
  },
  description: '<p>Preserved description</p>',
  end: '2030-01-02T02:00:00.000Z',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'event-1',
  location: null,
  questions: [],
  registrationCount: 0,
  registrationOptions: [],
  reviewedAt: null,
  simpleModeEnabled: false,
  start: '2030-01-02T00:00:00.000Z',
  status: 'DRAFT',
  statusComment: null,
  title: 'Preserved platform event',
  unlisted: false,
};

describe('PlatformEventCreateComponent', () => {
  let resolvedFormOptions = eventFormOptions;
  const loadFormOptions = vi.fn(async () => resolvedFormOptions);
  let queryClient: QueryClient;
  const createEvent =
    vi.fn<(input: CreateInput) => Promise<PlatformEventDetailRecord>>();

  beforeEach(async () => {
    resolvedFormOptions = eventFormOptions;
    createEvent.mockReset().mockResolvedValue(createdEvent);
    loadFormOptions
      .mockReset()
      .mockImplementation(async () => resolvedFormOptions);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformEventCreateComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformEventCreateComponent],
      providers: [
        provideTanStackQuery(queryClient),
        provideRouter([]),
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformEventCreateOperations,
          useValue: {
            create: () => ({
              mutationFn: createEvent,
              mutationKey: ['platform-event-create', 'create'],
            }),
            formOptions: () => ({
              queryFn: loadFormOptions,
              queryKey: ['platform-event-create', 'form-options'],
            }),
            listFilter: () => ({
              queryKey: ['platform', 'events', 'list'],
            }),
          },
        },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  const render = (): ComponentFixture<PlatformEventCreateComponent> => {
    const fixture = TestBed.createComponent(PlatformEventCreateComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    return fixture;
  };

  const renderForCreate = async () => {
    const fixture = render();
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected platform event form');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(root.querySelector('form')).not.toBeNull();
    });
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const selects = await loader.getAllHarnesses(MatSelectHarness);
    const [ownerSelect, templateSelect] = selects;
    if (!ownerSelect || !templateSelect)
      throw new Error('Expected owner and template selectors');
    await ownerSelect.clickOptions({ text: /Alex Able/ });
    await templateSelect.clickOptions({ text: 'Weekend template' });
    const field = (label: string) => {
      const element = [...root.querySelectorAll('mat-form-field')]
        .find(
          (candidate) =>
            candidate.querySelector('mat-label')?.textContent?.trim() === label,
        )
        ?.querySelector('input, textarea');
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement)
      )
        throw new Error(`Expected ${label}`);
      return element;
    };
    const title = field('Event title');
    const description = field('Description');
    const reason = field('Reason for creating this event');
    const times = root.querySelectorAll<HTMLInputElement>(
      'input[type="datetime-local"]',
    );
    const [start, end] = [...times];
    if (!start || !end) throw new Error('Expected start/end inputs');
    for (const [input, value] of [
      [title, 'Preserved platform event'],
      [description, '<p>Preserved description</p>'],
      [reason, 'Create the requested trip'],
      [start, '2030-01-02T10:00'],
      [end, '2030-01-02T12:00'],
    ] as const) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const form = root.querySelector('form');
    const button = root.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (!form || !button) throw new Error('Expected form and create action');
    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(button.disabled).toBe(false);
    });
    return { button, description, fixture, form, reason, root, title };
  };

  const expectSubmittedOnce = () =>
    expect(createEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        creatorUserId: 'user-1',
        description: '<p>Preserved description</p>',
        end: '2030-01-02T02:00:00.000Z',
        reason: 'Create the requested trip',
        start: '2030-01-02T00:00:00.000Z',
        targetTenantId: 'tenant-1',
        templateId: 'template-1',
        title: 'Preserved platform event',
      }),
      expect.objectContaining({ client: queryClient }),
    );

  it.each([
    { error: new Error('Lost response'), label: 'transport' },
    {
      error: new RpcInternalServerError({ message: 'Private exception' }),
      label: 'Internal',
    },
  ])(
    'keeps $label creation uncertainty visible with the entered values',
    async ({ error }) => {
      let simulatedCommit = false;
      createEvent.mockImplementationOnce(async () => {
        simulatedCommit = true;
        throw error;
      });
      const { fixture, form, reason, title } = await renderForCreate();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledWith(
          'The event creation outcome could not be confirmed. Open the event list, load the page again and check for this event before trying again.',
        ),
      );
      await fixture.whenStable();
      expect(simulatedCommit).toBe(true);
      expectSubmittedOnce();
      expect(title.value).toBe('Preserved platform event');
      expect(reason.value).toBe('Create the requested trip');
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    },
  );

  it('shows the expected validation denial without replaying creation', async () => {
    createEvent.mockRejectedValueOnce(
      new RpcBadRequestError({ message: 'Choose an active event owner.' }),
    );
    const { form, title } = await renderForCreate();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(
        TestBed.inject(NotificationService).showError,
      ).toHaveBeenCalledWith('Choose an active event owner.'),
    );
    expectSubmittedOnce();
    expect(title.value).toBe('Preserved platform event');
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it('reports confirmed creation after a real active event-list read failure', async () => {
    const loadEvents = vi.fn(async () => []);
    const observer = new QueryObserver(queryClient, {
      queryFn: loadEvents,
      queryKey: ['platform', 'events', 'list'],
    });
    const unsubscribe = observer.subscribe(() => {
      // Keep the real list query active while the creation invalidates it.
    });
    try {
      await observer.refetch({ throwOnError: true });
      loadEvents.mockRejectedValueOnce(new Error('Event list unavailable'));
      const { form, title } = await renderForCreate();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledWith(
          'The event was created, but the event list could not be updated. Open the event list and load the page again to see it.',
        ),
      );
      expect(
        queryClient.getQueryState(['platform', 'events', 'list'])?.status,
      ).toBe('error');
      expectSubmittedOnce();
      expect(title.value).toBe('Preserved platform event');
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('keeps submission busy until every active list read settles without waiting for inactive work', async () => {
    const { button, fixture, form, title } = await renderForCreate();
    const heldRead = () => {
      let finish: (() => void) | undefined;
      // Angular's browser library target does not expose Promise.withResolvers.
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      const promise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { finish: () => finish?.(), promise };
    };
    const activeRead = heldRead();
    const inactiveRead = heldRead();
    const failingList = new QueryObserver(queryClient, {
      initialData: [],
      queryFn: async () => {
        throw new Error('First tenant list unavailable');
      },
      queryKey: ['platform', 'events', 'list', { targetTenantId: 'tenant-1' }],
      staleTime: Infinity,
    });
    const loadSibling = vi.fn(async () => {
      await activeRead.promise;
      return [];
    });
    const siblingList = new QueryObserver(queryClient, {
      initialData: [],
      queryFn: loadSibling,
      queryKey: ['platform', 'events', 'list', { targetTenantId: 'tenant-2' }],
      staleTime: Infinity,
    });
    const unsubscribeFailed = failingList.subscribe(() => {
      // Keep the rejected list active for the single invalidation.
    });
    const unsubscribeSibling = siblingList.subscribe(() => {
      // Keep the second tenant list active while its read is held.
    });
    const inactiveKey = [
      'platform',
      'events',
      'list',
      { targetTenantId: 'tenant-3' },
    ];
    let inactiveSettled = false;
    const inactiveFetch = queryClient
      .fetchQuery({
        queryFn: async () => {
          await inactiveRead.promise;
          return [];
        },
        queryKey: inactiveKey,
      })
      .then(() => {
        inactiveSettled = true;
      });
    const invalidation = vi.spyOn(queryClient, 'invalidateQueries');
    try {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(failingList.getCurrentResult().isError).toBe(true);
        expect(loadSibling).toHaveBeenCalledOnce();
        expect(queryClient.isMutating()).toBe(0);
        expect(button.disabled).toBe(true);
      });
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
      expectSubmittedOnce();
      expect(invalidation).toHaveBeenCalledExactlyOnceWith(
        { queryKey: ['platform', 'events', 'list'] },
        { throwOnError: true },
      );
      expect(
        TestBed.inject(NotificationService).showError,
      ).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(title.value).toBe('Preserved platform event');
      activeRead.finish();
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(button.disabled).toBe(false);
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledExactlyOnceWith(
          'The event was created, but the event list could not be updated. Open the event list and load the page again to see it.',
        );
      });
      expect(inactiveSettled).toBe(false);
      expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe(
        'fetching',
      );
      expectSubmittedOnce();
    } finally {
      activeRead.finish();
      inactiveRead.finish();
      try {
        await Promise.allSettled([
          inactiveFetch,
          siblingList.getCurrentQuery().promise,
        ]);
        await vi.waitFor(async () => {
          await fixture.whenStable();
          expect(button.disabled).toBe(false);
        });
      } finally {
        unsubscribeFailed();
        unsubscribeSibling();
      }
    }
  });

  it.each(['cancelled', 'rejected'] as const)(
    'reports confirmed creation after %s navigation',
    async (outcome) => {
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      if (outcome === 'cancelled') navigate.mockResolvedValueOnce(false);
      else navigate.mockRejectedValueOnce(new Error('Navigation unavailable'));
      const { form, title } = await renderForCreate();
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledWith(
          'The event was created, but its page could not be opened. Open it from the event list before making further changes.',
        ),
      );
      expectSubmittedOnce();
      expect(navigate).toHaveBeenCalledExactlyOnceWith([
        '/global-admin/tenants',
        'tenant-1',
        'events',
        'event-1',
      ]);
      expect(title.value).toBe('Preserved platform event');
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
    },
  );

  it('blocks a second submit until confirmed creation has finished navigation', async () => {
    let finishNavigation: ((value: boolean) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const navigation = new Promise<boolean>((resolve) => {
      finishNavigation = resolve;
    });
    vi.mocked(TestBed.inject(Router).navigate).mockReturnValueOnce(navigation);
    const { button, fixture, form, title } = await renderForCreate();
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    try {
      await vi.waitFor(async () => {
        await fixture.whenStable();
        expect(TestBed.inject(Router).navigate).toHaveBeenCalledOnce();
        expect(button.disabled).toBe(true);
      });
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();
      expectSubmittedOnce();
      expect(title.value).toBe('Preserved platform event');
    } finally {
      finishNavigation?.(true);
      await fixture.whenStable();
    }
    expect(
      TestBed.inject(NotificationService).showSuccess,
    ).toHaveBeenCalledExactlyOnceWith('Event created');
  });
  it('retries loading organization choices from the error state', async () => {
    loadFormOptions
      .mockReset()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(eventFormOptions);
    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(
        'Organization members and templates could not be loaded.',
      );
    });
    expect(loadFormOptions).toHaveBeenCalledOnce();

    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new TypeError('Expected an HTML root');
    const retryButton = root.querySelector<HTMLButtonElement>(
      ':scope [role="alert"] button',
    );
    if (!retryButton) throw new Error('Expected a retry button');
    retryButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadFormOptions).toHaveBeenCalledTimes(2);
      expect(fixture.nativeElement.textContent).toContain('Event owner');
      expect(fixture.nativeElement.textContent).toContain('Source template');
    });
  });

  it('explains missing event prerequisites and links to the next actions', async () => {
    resolvedFormOptions = {
      ...eventFormOptions,
      creators: [],
      templates: [],
    };
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(
        'Add an active event owner',
      );
      expect(fixture.nativeElement.textContent).toContain(
        'Create an event template',
      );
    });

    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new TypeError('Expected an HTML root');
    const links = [...root.querySelectorAll('a')].map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toContain('/global-admin/tenants/tenant-1/users');
    expect(links).toContain('/global-admin/tenants/tenant-1/templates/new');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('labels both event times with the organization time zone', async () => {
    const fixture = render();

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    });

    const text = fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ');
    expect(
      text.match(/Organization time zone: Australia\/Brisbane/g),
    ).toHaveLength(2);
    expect(text).toContain('Reason for creating this event');
    expect(text).toContain(
      "Other administrators will see this in the event's change history.",
    );
  });
});
