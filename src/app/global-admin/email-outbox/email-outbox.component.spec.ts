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
      registrationCancelled: 'Sign-up ended',
      registrationConfirmed: 'Ticket confirmed',
      registrationTransferred: 'Ticket transferred',
      waitlistSpotAvailable: 'Waitlist place available',
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

  it('uses plain delivery language for a message waiting to be sent', async () => {
    loadOverview.mockResolvedValue({
      items: [
        {
          id: 'email-queued',
          kind: 'manualApproval',
          lastAttemptAt: null,
          recipient: 'member@example.org',
          recordIncomplete: false,
          status: 'queued',
          subject: 'Manual approval',
          tenantDomain: 'section.example.org',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
        },
      ],
      summary: {
        deliveryUnknown: 0,
        failed: 0,
        queued: 1,
        sending: 0,
        sent: 0,
        staleSending: 0,
        suppressed: 0,
      },
    });

    const fixture = TestBed.createComponent(EmailOutboxComponent);

    await vi.waitFor(async () => {
      await fixture.whenStable();
      const text = normalizeText(fixture);
      expect(text).toContain('Email delivery');
      expect(text).toMatch(/Waiting to send\s*1/);
      expect(text).toMatch(/Sending\s*0/);
      expect(text).toMatch(/Could not send\s*0/);
      expect(text).toMatch(/Sent\s*0/);
      expect(text).toMatch(/Delivery not confirmed\s*0/);
      expect(text).toMatch(/Not sent\s*0/);
      expect(text).toContain('This message is waiting to be sent.');
      expect(text).not.toContain('Send attempts');
      expect(text).toContain('Not tried yet');
      expect(text).not.toContain('outbox');
    });
  });

  it('does not expose error details when email delivery cannot be loaded', async () => {
    loadOverview.mockRejectedValue(
      new Error('Connection refused at internal-email-service:4321'),
    );

    const fixture = TestBed.createComponent(EmailOutboxComponent);

    await vi.waitFor(async () => {
      await fixture.whenStable();
      const text = normalizeText(fixture);
      expect(text).toContain("We couldn't load email delivery");
      expect(text).toContain('Select Check again to try again.');
      expect(text).not.toContain('internal-email-service');
      expect(text).not.toContain('Connection refused');
    });
  });

  it('renders each Brisbane row in Brisbane when the host tenant is Berlin', async () => {
    loadOverview.mockResolvedValue({
      items: [
        {
          id: 'email-1',
          kind: 'registrationConfirmed',
          lastAttemptAt: '2026-07-15T14:30:00.000Z',
          recipient: 'member@example.org',
          recordIncomplete: false,
          status: 'sending',
          subject: 'Registration confirmed',
          tenantDomain: 'section.example.org',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
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

    await vi.waitFor(async () => {
      await fixture.whenStable();
      const text = normalizeText(fixture);
      expect(text).toContain('Jul 16, 2026, 12:30:00 AM');
      expect(text).not.toContain('Jul 15, 2026, 4:30:00 PM');
      expect(text).toContain(
        'Evorto is sending this message. If delivery cannot be confirmed, it will not be sent again.',
      );
      expect(text).toContain(
        'The counts cover all emails. This list shows up to 100, placing emails that need attention first. Within each status, the newest appear first.',
      );
    });
  });

  it('explains emails that were not sent without exposing service diagnostics', async () => {
    loadOverview.mockResolvedValue({
      items: [
        {
          id: 'email-1',
          kind: 'registrationConfirmed',
          lastAttemptAt: '2026-07-16T14:30:00.000Z',
          recipient: 'member@example.org',
          recordIncomplete: false,
          status: 'failed',
          subject: 'Registration confirmed',
          tenantDomain: 'section.example.org',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
        },
        {
          id: 'email-2',
          kind: 'receiptReviewed',
          lastAttemptAt: '2026-07-16T14:30:00.000Z',
          recipient: 'second-member@example.org',
          recordIncomplete: true,
          status: 'deliveryUnknown',
          subject: 'Receipt reviewed',
          tenantDomain: 'section.example.org',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
        },
        {
          id: 'email-3',
          kind: 'manualApproval',
          lastAttemptAt: null,
          recipient: 'third-member@example.org',
          recordIncomplete: true,
          status: 'suppressed',
          subject: 'Manual approval',
          tenantDomain: 'section.example.org',
          tenantName: 'Section',
          tenantTimezone: 'Australia/Brisbane',
        },
      ],
      summary: {
        deliveryUnknown: 1,
        failed: 1,
        queued: 0,
        sending: 0,
        sent: 0,
        staleSending: 0,
        suppressed: 1,
      },
    });

    const fixture = TestBed.createComponent(EmailOutboxComponent);

    await vi.waitFor(async () => {
      await fixture.whenStable();
      const text = normalizeText(fixture);
      expect(text).toContain('This email could not be sent.');
      expect(text).toContain(
        'Evorto could not confirm whether this email was delivered, so it will not send it again.',
      );
      expect(text).toContain(
        'This email was not sent because this address cannot receive organization emails.',
      );
      expect(text).not.toContain('Send attempts');
      expect(text).not.toContain('Provider');
      expect(text).not.toContain('staging allowlist');
      expect(text).not.toContain('Invalid record');
      expect(text).toContain(
        'Some delivery details are missing. Contact Evorto support and include the organization, recipient, and subject shown below.',
      );
    });
  });
});
