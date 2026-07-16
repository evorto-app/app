import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
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

describe('PlatformEventCreateComponent', () => {
  let resolvedFormOptions = eventFormOptions;
  const loadFormOptions = vi.fn(async () => resolvedFormOptions);
  let queryClient: QueryClient;

  beforeEach(async () => {
    resolvedFormOptions = eventFormOptions;
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
              mutationFn: vi.fn(),
              mutationKey: ['platform-event-create', 'create'],
            }),
            formOptions: () => ({
              queryFn: loadFormOptions,
              queryKey: ['platform-event-create', 'form-options'],
            }),
            listFilter: () => ({
              queryKey: ['platform-event-create', 'list'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
  });

  const render = (): ComponentFixture<PlatformEventCreateComponent> => {
    const fixture = TestBed.createComponent(PlatformEventCreateComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    return fixture;
  };

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

    const retryButton = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>(':scope [role="alert"] button');
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

    const links = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('a'),
    ].map((link) => link.getAttribute('href'));
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
  });
});
