import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserErrorHandler } from './browser-error-handler';

const browserErrorLog = vi.hoisted(() => vi.fn());

vi.mock('consola/browser', () => ({
  default: {
    withTag: () => ({ error: browserErrorLog }),
  },
}));

describe('application error reporting', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    browserErrorLog.mockClear();
  });

  it.each(['browser', 'server'])(
    'redacts error details before logging on %s',
    (platformId) => {
      const fetchReport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchReport);
      vi.stubGlobal('navigator', { sendBeacon: undefined });
      vi.stubGlobal('location', {
        href: 'https://page-user:page-password@tenant.example.com/registration-transfers/private-transfer-token?private=query#fragment',
      });
      TestBed.configureTestingModule({
        providers: [
          BrowserErrorHandler,
          { provide: PLATFORM_ID, useValue: platformId },
        ],
      });
      const error = new Error(
        'Failed https://message-user:message-password@tenant.example.com/events for member@example.com; Bearer private-token',
      );

      TestBed.inject(BrowserErrorHandler).handleError(error);

      expect(browserErrorLog).toHaveBeenCalledExactlyOnceWith({
        message:
          'Failed https://tenant.example.com/events for [REDACTED_EMAIL]; Bearer [REDACTED]',
        name: 'Error',
        stack: expect.stringContaining('[REDACTED_EMAIL]'),
        url: 'https://tenant.example.com/registration-transfers/[REDACTED_TOKEN]',
      });
      if (platformId === 'browser') {
        expect(fetchReport).toHaveBeenCalledExactlyOnceWith(
          '/telemetry/browser-errors',
          expect.objectContaining({ method: 'POST' }),
        );
        const body = fetchReport.mock.calls[0]?.[1]?.body;
        expect(typeof body).toBe('string');
        expect(body).toContain('[REDACTED_EMAIL]');
        expect(body).not.toContain('password');
        expect(body).not.toContain('private-token');
        expect(body).not.toContain('private-transfer-token');
        expect(body).not.toContain('private=query');
      } else {
        expect(fetchReport).not.toHaveBeenCalled();
      }
    },
  );
});
