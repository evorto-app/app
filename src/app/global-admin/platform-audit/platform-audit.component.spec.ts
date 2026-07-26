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
  PlatformAuditComponent,
  platformAuditSnapshotRows,
  platformAuditTargetLabel,
} from './platform-audit.component';

const loadAuditPage = vi.fn();

const makeAuditRecord = (options: {
  readonly id: string;
  readonly reason: string;
}): GlobalAdminPlatformAuditRecord => ({
  action: 'role.update',
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  after: {
    resourceId: 'role-1',
    resourceType: 'role',
    state: {
      lastError: 'raw provider failure',
      name: 'Event coordinator',
      permissions: ['events:manage', 'registrations:checkIn'],
      providerPayload: { secret: 'provider response body' },
    },
  },
  before: {
    resourceId: 'role-1',
    resourceType: 'role',
    state: {
      name: 'Event helper',
      permissions: ['registrations:checkIn'],
    },
  },
  createdAt: '2026-07-15T14:30:00.000Z',
  id: options.id,
  reason: options.reason,
  targetTenantId: 'tenant-1',
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
      'Registration refund requeued',
    );
  });

  it('keeps raw errors out and exposes investigation identifiers', () => {
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
    expect(template).toContain('entry.actorId');
    expect(template).toContain('entry.targetTenantId');
    expect(template).toContain('before.resourceId');
    expect(template).toContain('after.resourceId');
    expect(template).toContain('Administrator email unavailable');
  });

  it('uses a readable organization name alongside explicit authority ids', () => {
    expect(
      platformAuditTargetLabel({
        after: {
          resourceId: 'tenant-1',
          resourceType: 'tenant',
          state: { id: 'tenant-1', name: 'Target tenant' },
        },
        before: null,
        targetTenantName: null,
      }),
    ).toBe('Target tenant');
    expect(
      platformAuditTargetLabel({
        after: {
          resourceId: 'event-1',
          resourceType: 'event',
          state: { id: 'event-1', status: 'APPROVED' },
        },
        before: {
          resourceId: 'event-1',
          resourceType: 'event',
          state: { id: 'event-1', status: 'PENDING_REVIEW' },
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

describe('platformAuditSnapshotRows', () => {
  it('formats useful values and hides internal identifiers', () => {
    expect(
      platformAuditSnapshotRows({
        resourceId: 'refund-1',
        resourceType: 'refundClaim',
        state: {
          amount: 1250,
          currency: 'EUR',
          generation: 2,
          refundClaimId: 'refund-1',
          status: 'needs_attention',
          transferId: 'transfer-1',
        },
      }),
    ).toEqual([
      { label: 'Amount', value: '12,50 €' },
      { label: 'Currency', value: 'EUR' },
      { label: 'Status', value: 'needs attention' },
    ]);
  });

  it('shows permission changes without exposing error or provider payload fields', () => {
    expect(
      platformAuditSnapshotRows({
        resourceId: 'role-1',
        resourceType: 'role',
        state: {
          lastError: 'raw provider failure',
          permissions: ['events:manage', 'registrations:checkIn'],
          providerPayload: { secret: 'provider response body' },
        },
      }),
    ).toEqual([
      {
        label: 'Permissions',
        value: 'events:manage, registrations:checkIn',
      },
    ]);
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

  it('loads older entries and displays only safe investigation evidence', async () => {
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
      expect(text).toContain('auth0|platform-admin');
      expect(text).toContain('tenant-1');
      expect(text).toContain('role · role-1');
      expect(text).toContain('events:manage, registrations:checkIn');
      expect(text).not.toContain('raw provider failure');
      expect(text).not.toContain('provider response body');
    });
    expect(loadAuditPage).toHaveBeenNthCalledWith(1, { cursor: null });

    const loadOlder = buttonByText(fixture, 'Load older');
    loadOlder.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadOlder.disabled).toBe(true);
      expect(normalizedText(fixture)).toContain(
        'Loading older platform changes...',
      );
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
        'Older platform changes could not be loaded. The entries above are still available.',
      );
      expect(text).not.toContain('provider response body');
      expect(buttonByText(fixture, 'Load older').disabled).toBe(false);
    });
  });
});
