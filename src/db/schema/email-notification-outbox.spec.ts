import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

describe('emailNotificationOutbox schema', () => {
  it('stores pending email notifications with tenant and recipient context', () => {
    const source = readFileSync(
      new URL('email-notification-outbox.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain(
      "emailNotificationOutbox = pgTable('email_notification_outbox'",
    );
    expect(source).toContain("'receiptReviewed'");
    expect(source).toContain("'registrationConfirmed'");
    expect(source).toContain("'pending'");
    expect(source).toContain("'sent'");
    expect(source).toContain("'failed'");
    expect(source).toContain('recipientEmail');
    expect(source).toContain('recipientUserId');
    expect(source).toContain('textBody');
  });
});
