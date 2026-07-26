import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { APP_RPC_CLIENT } from '@app/core/effect-rpc-angular-client';
import { TENANT_DATE_PIPE_TIMEZONE } from '@app/core/tenant-date.pipe';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EmailOutboxComponent,
  emailOutboxKindLabel,
} from './email-outbox.component';

const loadOverview = vi.fn();

describe('emailOutboxKindLabel', () => {
  it('gives every durable email kind an operator-facing label', () => {
    expect(emailOutboxKindLabel).toEqual({
      manualApproval: 'Manual approval',
      receiptReviewed: 'Receipt reviewed',
      registrationCancelled: 'Registration cancelled',
      registrationConfirmed: 'Registration confirmed',
      registrationTransferred: 'Registration transferred',
      waitlistSpotAvailable: 'Waitlist spot available',
    });
  });
});

const normalizeText = (fixture: ComponentFixture<EmailOutboxComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('EmailOutboxComponent overview', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [EmailOutboxComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: LOCALE_ID, useValue: 'en-US' },
        {
          provide: TENANT_DATE_PIPE_TIMEZONE,
          useValue: 'Europe/Berlin',
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            globalAdmin: {
              emailOutbox: {
                findOverview: {
                  queryOptions: () => ({
                    queryFn: loadOverview,
                    queryKey: ['global-admin', 'email-outbox'],
                  }),
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
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders each Brisbane row in Brisbane when the host tenant is Berlin', async () => {
    loadOverview.mockResolvedValue({
      items: [
        {
          attempts: 1,
          createdAt: '2026-07-15T14:30:00.000Z',
          deliveryUnknownAt: null,
          id: 'email-1',
          kind: 'registrationConfirmed',
          lastAttemptAt: '2026-07-15T14:30:00.000Z',
          lastError: null,
          provider: null,
          providerMessageId: null,
          recipient: 'member@example.org',
          sentAt: null,
          status: 'sending',
          subject: 'Registration confirmed',
          suppressedAt: null,
          tenantDomain: 'section.example.org',
          tenantId: 'tenant-1',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
          updatedAt: '2026-07-15T14:30:00.000Z',
        },
      ],
      summary: {
        deliveryUnknown: 0,
        failed: 0,
        queued: 0,
        sending: 1,
        sent: 0,
        staleSending: 0,
        suppressed: 0,
      },
    });

    const fixture = TestBed.createComponent(EmailOutboxComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Jul 16, 2026, 12:30:00 AM');
      expect(text).not.toContain('Jul 15, 2026, 4:30:00 PM');
      expect(text).toContain(
        'Delivery attempt recorded. It will settle once or become unknown; it will not be resent.',
      );
      expect(text).toContain(
        'The summary covers the entire outbox. Details show up to 100 records: failed, unknown, and abandoned deliveries appear before routine records; each group shows the newest first.',
      );
    });
  });

  it('presents explicit provider rejection as terminal evidence', async () => {
    loadOverview.mockResolvedValue({
      items: [
        {
          attempts: 1,
          createdAt: '2026-07-15T14:30:00.000Z',
          deliveryUnknownAt: null,
          id: 'email-1',
          kind: 'registrationConfirmed',
          lastAttemptAt: '2026-07-16T14:30:00.000Z',
          lastError: 'Mailbox unavailable',
          provider: 'tem',
          providerMessageId: null,
          recipient: 'member@example.org',
          sentAt: null,
          status: 'failed',
          subject: 'Registration confirmed',
          suppressedAt: null,
          tenantDomain: 'section.example.org',
          tenantId: 'tenant-1',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
          updatedAt: '2026-07-16T14:30:00.000Z',
        },
        {
          attempts: 1,
          createdAt: '2026-07-15T14:30:00.000Z',
          deliveryUnknownAt: null,
          id: 'email-2',
          kind: 'receiptReviewed',
          lastAttemptAt: '2026-07-16T14:30:00.000Z',
          lastError: 'Provider response was lost',
          provider: 'tem',
          providerMessageId: null,
          recipient: 'second-member@example.org',
          sentAt: null,
          status: 'deliveryUnknown',
          subject: 'Receipt reviewed',
          suppressedAt: null,
          tenantDomain: 'section.example.org',
          tenantId: 'tenant-1',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
          updatedAt: '2026-07-16T14:30:00.000Z',
        },
      ],
      summary: {
        deliveryUnknown: 1,
        failed: 1,
        queued: 0,
        sending: 0,
        sent: 0,
        staleSending: 0,
        suppressed: 0,
      },
    });

    const fixture = TestBed.createComponent(EmailOutboxComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain(
        'Failed emails were explicitly rejected before acceptance. They remain stored as terminal operational evidence.',
      );
      expect(text).toContain(
        'Rejected before provider acceptance. Stored as terminal operational evidence.',
      );
      expect(text).toMatch(/Attempts\s*1/);
      expect(text).not.toContain('Next attempt');
      expect(text).toContain(
        'Outcome unknown. Stored read-only; no automatic retry.',
      );
      expect(text).toContain(
        'Invalid record: missing unknown-outcome timestamp.',
      );
    });
  });
});
