import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_RPC_CLIENT } from '@app/core/effect-rpc-angular-client';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type GlobalAdminPlatformAuditCursor,
  type GlobalAdminPlatformAuditPage,
  type GlobalAdminPlatformAuditRecord,
} from '../../../shared/rpc-contracts/app-rpcs/global-admin.rpcs';
import {
  platformAuditActionLabel,
  platformAuditChangedRows,
  PlatformAuditComponent,
  platformAuditTargetLabel,
} from './platform-audit.component';

const loadAuditPage = vi.fn();

const makeAuditRecord = (options: {
  readonly id: string;
  readonly reason: string;
}): GlobalAdminPlatformAuditRecord => ({
  action: 'role.update',
  actorEmail: 'platform@example.org',
  after: {
    resourceType: 'role',
    state: {
      name: 'Event coordinator',
      permissions: ['events:create', 'events:viewPublic'],
    },
  },
  before: {
    resourceType: 'role',
    state: {
      name: 'Event helper',
      permissions: ['events:viewPublic'],
    },
  },
  createdAt: '2026-07-15T14:30:00.000Z',
  id: options.id,
  reason: options.reason,
  targetTenantName: 'Section',
});

describe('platformAuditActionLabel', () => {
  it('uses plain operational labels for each application audit action', () => {
    expect(platformAuditActionLabel('tenant.create')).toBe(
      'Organization created',
    );
    expect(platformAuditActionLabel('tenant.update')).toBe(
      'Organization settings updated',
    );
    expect(platformAuditActionLabel('refundClaim.requeue')).toBe(
      'Refund continued',
    );
    expect(platformAuditActionLabel('event.updateAnnouncementDiscovery')).toBe(
      'Who can find the announcement changed',
    );
    expect(platformAuditActionLabel('taxRates.import')).toBe(
      'Tax rates checked',
    );
  });

  it('keeps raw errors and implementation identifiers out', () => {
    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-audit/platform-audit.component.ts',
      ),
      'utf8',
    );
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-audit/platform-audit.component.html',
      ),
      'utf8',
    );

    expect(source).not.toContain('getErrorMessage');
    expect(template).not.toContain('errorMessage(');
    expect(template).not.toContain('entry.actorId');
    expect(template).not.toContain('entry.targetTenantId');
    expect(template).not.toContain('before.resourceId');
    expect(template).not.toContain('after.resourceId');
    expect(template).not.toContain('row.value');
    expect(template).not.toContain('No listed fields');
    expect(template).toContain('This change summary is unavailable.');
    expect(template).toContain('Contact Evorto support');
    expect(template).toContain('the organization and time shown above.');
    expect(template).toContain('Administrator unavailable');
  });

  it('uses a readable organization name', () => {
    expect(
      platformAuditTargetLabel({
        after: {
          resourceType: 'tenant',
          state: { name: 'Target tenant' },
        },
        before: null,
        targetTenantName: null,
      }),
    ).toBe('Target tenant');
    expect(
      platformAuditTargetLabel({
        after: {
          resourceType: 'event',
          state: { status: 'APPROVED' },
        },
        before: {
          resourceType: 'event',
          state: { status: 'PENDING_REVIEW' },
        },
        targetTenantName: 'Example Organization',
      }),
    ).toBe('Example Organization');
    expect(
      platformAuditTargetLabel({
        after: null,
        before: null,
        targetTenantName: null,
      }),
    ).toBe('Former organization');
  });
});

describe('platformAuditChangedRows', () => {
  it.each([
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
  ] as const)(
    'describes a submitted receipt changing to %s',
    (status, label) => {
      expect(
        platformAuditChangedRows({
          after: {
            resourceType: 'receipt',
            state: { currency: 'EUR', status },
          },
          before: {
            resourceType: 'receipt',
            state: { currency: 'EUR', status: 'submitted' },
          },
        }),
      ).toEqual([{ after: label, before: 'Submitted', label: 'Status' }]);
    },
  );

  it('describes payment readiness without exposing account details', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'tenant',
          state: { paymentsConfigured: true },
        },
        before: {
          resourceType: 'tenant',
          state: { paymentsConfigured: false },
        },
      }),
    ).toEqual([
      { after: 'Ready', before: 'Not ready', label: 'Paid sign-ups' },
    ]);
  });

  it('describes a tax-rate refresh even when the total stays the same', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'taxRateBatch',
          state: { taxRateCount: 2, taxRateUpdatedCount: 1 },
        },
        before: {
          resourceType: 'taxRateBatch',
          state: { taxRateCount: 2 },
        },
      }),
    ).toEqual([{ after: '1', before: 'Not set', label: 'Tax rates updated' }]);
  });

  it('describes a real refund continuation without exposing recovery details', () => {
    expect(
      platformAuditChangedRows({
        action: 'refundClaim.requeue',
        after: {
          resourceType: 'refundClaim',
          state: {
            status: 'pending',
            transferStatus: 'refund_pending',
          },
        },
        before: {
          resourceType: 'refundClaim',
          state: {
            status: 'pending',
            transferStatus: 'refund_failed',
          },
        },
      }),
    ).toEqual([
      {
        after: 'Started again',
        before: 'Needed attention',
        label: 'Refund',
      },
    ]);
  });

  it('uses the friendly organization time-zone label', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'tenant',
          state: { timezone: 'Europe/Berlin' },
        },
        before: {
          resourceType: 'tenant',
          state: { timezone: 'America/New_York' },
        },
      }),
    ).toEqual([
      { after: 'Berlin time', before: 'New York time', label: 'Time zone' },
    ]);
  });

  it('uses readable permission labels', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'role',
          state: {
            permissions: ['events:create', 'events:viewPublic'],
          },
        },
        before: {
          resourceType: 'role',
          state: {
            permissions: ['events:viewPublic'],
          },
        },
      }),
    ).toEqual([
      {
        after: 'Create events, View public events',
        before: 'View public events',
        label: 'Role permissions',
      },
    ]);
  });

  it('omits a row when changed permission details have the same safe display', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'role',
          state: {
            permissions: ['unrecognized:after'],
          },
        },
        before: {
          resourceType: 'role',
          state: {
            permissions: ['unrecognized:before'],
          },
        },
      }),
    ).toEqual([]);
  });

  it('uses plain copy when an access setting cannot be shown', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'role',
          state: {
            permissions: ['unrecognized:after'],
          },
        },
        before: {
          resourceType: 'role',
          state: {
            permissions: [],
          },
        },
      }),
    ).toEqual([
      {
        after: 'This role includes an access setting that cannot be shown',
        before: 'No permissions',
        label: 'Role permissions',
      },
    ]);
  });

  it('requires investigation when no displayable details were recorded', () => {
    expect(
      platformAuditChangedRows({
        after: {
          resourceType: 'role',
          state: {},
        },
        before: {
          resourceType: 'role',
          state: {},
        },
      }),
    ).toEqual([]);
  });
});

const normalizedText = (fixture: ComponentFixture<PlatformAuditComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

const buttonByText = (
  fixture: ComponentFixture<PlatformAuditComponent>,
  label: string,
): HTMLButtonElement => {
  const button = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new TypeError(`Expected button containing "${label}"`);
  }
  return button;
};

describe('PlatformAuditComponent pagination', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    loadAuditPage.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [PlatformAuditComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            globalAdmin: {
              platformAudit: {
                findMany: {
                  call: loadAuditPage,
                  queryKey: () => ['global-admin', 'platform-audit'],
                },
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

  it('loads older entries and displays only business-readable details', async () => {
    const nextCursor: GlobalAdminPlatformAuditCursor = {
      createdAt: '2026-07-15T14:30:00.000Z',
      id: 'audit-050',
    };
    let resolveOlder:
      ((page: GlobalAdminPlatformAuditPage) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const olderPage = new Promise<GlobalAdminPlatformAuditPage>((resolve) => {
      resolveOlder = resolve;
    });
    loadAuditPage
      .mockResolvedValueOnce({
        items: [makeAuditRecord({ id: 'audit-001', reason: 'Current change' })],
        nextCursor,
      })
      .mockReturnValueOnce(olderPage);

    const fixture = TestBed.createComponent(PlatformAuditComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizedText(fixture);
      expect(text).toContain('platform@example.org');
      expect(text).toContain('Section');
      expect(text).toContain('Name');
      expect(text).toContain('Event helper');
      expect(text).toContain('Event coordinator');
      expect(text).toContain('Role permissions');
      expect(text).toContain('Create events, View public events');
      expect(text).not.toContain('auth0|platform-admin');
      expect(text).not.toContain('tenant-1');
      expect(text).not.toContain('role-1');
      expect(text).not.toContain('events:create');
      expect(text).not.toContain('raw provider failure');
      expect(text).not.toContain('provider response body');
    });
    expect(loadAuditPage).toHaveBeenNthCalledWith(1, { cursor: null });

    const loadOlder = buttonByText(fixture, 'Load older');
    loadOlder.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadOlder.disabled).toBe(true);
      expect(normalizedText(fixture)).toContain('Loading older changes…');
    });

    resolveOlder?.({
      items: [makeAuditRecord({ id: 'audit-051', reason: 'Older change' })],
      nextCursor: null,
    });

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizedText(fixture)).toContain('Older change');
      expect(
        [...fixture.nativeElement.querySelectorAll('button')].some(
          (button) => button.textContent?.includes('Load older') ?? false,
        ),
      ).toBe(false);
    });
    expect(loadAuditPage).toHaveBeenNthCalledWith(2, { cursor: nextCursor });
  });

  it('keeps loaded entries visible when loading an older page fails', async () => {
    const nextCursor: GlobalAdminPlatformAuditCursor = {
      createdAt: '2026-07-15T14:30:00.000Z',
      id: 'audit-050',
    };
    loadAuditPage
      .mockResolvedValueOnce({
        items: [makeAuditRecord({ id: 'audit-001', reason: 'Current change' })],
        nextCursor,
      })
      .mockRejectedValueOnce(new Error('provider response body'));

    const fixture = TestBed.createComponent(PlatformAuditComponent);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizedText(fixture)).toContain('Current change');
    });

    buttonByText(fixture, 'Load older').click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizedText(fixture);
      expect(text).toContain('Current change');
      expect(text).toContain(
        'Older changes could not be loaded. The entries above are still available.',
      );
      expect(text).not.toContain('provider response body');
      expect(buttonByText(fixture, 'Load older').disabled).toBe(false);
    });
  });
});
