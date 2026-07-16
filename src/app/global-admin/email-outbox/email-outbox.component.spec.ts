import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TENANT_DATE_PIPE_TIMEZONE } from '@app/core/tenant-date.pipe';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EmailOutboxComponent,
  emailOutboxKindLabel,
  EmailOutboxOperations,
} from './email-outbox.component';

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

const loadOverview = vi.fn();

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
          provide: EmailOutboxOperations,
          useValue: {
            overview: () => ({
              queryFn: loadOverview,
              queryKey: ['global-admin', 'email-outbox'],
            }),
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
          attempts: 0,
          createdAt: '2026-07-15T14:30:00.000Z',
          exhaustedAt: null,
          id: 'email-1',
          kind: 'registrationConfirmed',
          lastAttemptAt: '2026-07-15T14:30:00.000Z',
          lastError: null,
          maxAttempts: 8,
          nextAttemptAt: '2026-07-15T14:30:00.000Z',
          recipient: 'member@example.org',
          sentAt: null,
          status: 'queued',
          subject: 'Registration confirmed',
          tenantDomain: 'section.example.org',
          tenantId: 'tenant-1',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
          updatedAt: '2026-07-15T14:30:00.000Z',
        },
      ],
      summary: {
        exhausted: 0,
        failed: 0,
        queued: 1,
        sending: 0,
        sent: 0,
        staleSending: 0,
        waitingForRetry: 0,
      },
    });

    const fixture = TestBed.createComponent(EmailOutboxComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Jul 16, 2026, 12:30:00 AM');
      expect(text).not.toContain('Jul 15, 2026, 4:30:00 PM');
    });
  });

  it('presents exhausted emails as read-only history without a next attempt', async () => {
    loadOverview.mockResolvedValue({
      items: [
        {
          attempts: 8,
          createdAt: '2026-07-15T14:30:00.000Z',
          exhaustedAt: '2026-07-16T14:30:00.000Z',
          id: 'email-1',
          kind: 'registrationConfirmed',
          lastAttemptAt: '2026-07-16T14:30:00.000Z',
          lastError: 'Mailbox unavailable',
          maxAttempts: 8,
          nextAttemptAt: '2026-07-30T14:30:00.000Z',
          recipient: 'member@example.org',
          sentAt: null,
          status: 'failed',
          subject: 'Registration confirmed',
          tenantDomain: 'section.example.org',
          tenantId: 'tenant-1',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
          updatedAt: '2026-07-16T14:30:00.000Z',
        },
      ],
      summary: {
        exhausted: 1,
        failed: 1,
        queued: 0,
        sending: 0,
        sent: 0,
        staleSending: 0,
        waitingForRetry: 0,
      },
    });

    const fixture = TestBed.createComponent(EmailOutboxComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain(
        'Exhausted emails remain stored as read-only history. Automatic retries have ended; no recovery action is required.',
      );
      expect(text).toContain(
        'Automatic retries ended. Stored as read-only history.',
      );
      expect(text).toContain('Retries ended');
      expect(text).not.toContain('Next attempt');
    });
  });
});
