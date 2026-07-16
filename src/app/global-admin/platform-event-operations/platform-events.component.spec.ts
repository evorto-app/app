import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlatformEventListRecord } from '../../../shared/rpc-contracts/app-rpcs/platform-events.rpcs';

import { PlatformTenantPageHeaderComponent } from '../platform-tenant-admin/platform-tenant-page-header.component';
import {
  PlatformEventsComponent,
  PlatformEventsOperations,
} from './platform-events.component';

@Component({
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

const listedEvent: PlatformEventListRecord = {
  end: '2030-01-02T02:00:00.000Z',
  id: 'event-1',
  start: '2030-01-02T00:00:00.000Z',
  status: 'APPROVED',
  title: 'Weekend trip',
  unlisted: false,
};

describe('PlatformEventsComponent', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });
    TestBed.overrideComponent(PlatformEventsComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformEventsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        provideRouter([]),
        {
          provide: PlatformEventsOperations,
          useValue: {
            formOptions: () => ({
              queryFn: async () => ({ timezone: 'Australia/Brisbane' }),
              queryKey: ['platform-events', 'target-tenant-options'],
            }),
            list: () => ({
              queryFn: async () => [listedEvent],
              queryKey: ['platform-events', 'list'],
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

  const render = (): ComponentFixture<PlatformEventsComponent> => {
    const fixture = TestBed.createComponent(PlatformEventsComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    return fixture;
  };

  it('formats event instants in the target tenant timezone', async () => {
    const fixture = render();

    await expect
      .poll(() => {
        fixture.detectChanges();
        return fixture.nativeElement.textContent;
      })
      .toContain(
        '02 Jan 2030, 10:00 – 02 Jan 2030, 12:00 · Australia/Brisbane',
      );
  });
});
