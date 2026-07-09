import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';

import { sendReceiptReviewedEmail } from './email-delivery';

const emailConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      RESEND_API_KEY: 're_test_123',
      RESEND_DEFAULT_FROM: 'notifications@example.com',
    },
  }),
);

describe('email delivery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.effect('sends receipt review notifications through Resend', () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      yield* sendReceiptReviewedEmail({
        eventTitle: 'City tour',
        receiptId: 'receipt-1',
        rejectionReason: null,
        status: 'approved',
        tenant: {
          emailSenderEmail: null,
          emailSenderName: null,
          id: 'tenant-1',
          name: 'Tenant',
        },
        to: 'alice@example.com',
      }).pipe(Effect.provide(emailConfigProviderLayer));

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] ?? [];
      expect(url).toBe('https://api.resend.com/emails');
      expect(init).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test_123',
            'Content-Type': 'application/json',
            'Idempotency-Key': 'receipt-reviewed:tenant-1:receipt-1:approved',
          }),
          method: 'POST',
        }),
      );
      expect(JSON.parse(String(init?.body))).toEqual(
        expect.objectContaining({
          from: 'Tenant <notifications@example.com>',
          subject: 'Receipt approved',
          to: 'alice@example.com',
        }),
      );
    }),
  );
});
