import { describe, expect, it } from 'vitest';

import { safeServerErrorSummary } from './safe-server-error-summary';

const sensitiveEmail = 'person@example.test';
const sensitiveIban = 'DE89370400440532013000';
const sensitiveSql = 'select * from users where email = $1';
const sensitiveTransferToken = 'transfer-token-do-not-log';

describe('safeServerErrorSummary', () => {
  it('keeps only allowlisted diagnostics from nested failures', () => {
    const summary = safeServerErrorSummary('registration.transfer.claim', {
      body: {
        token: sensitiveTransferToken,
      },
      cause: {
        code: '23505',
        constraint: 'registration_transfers_claim_code_unique',
        detail: `Key (email)=(${sensitiveEmail}) already exists`,
        parameters: [sensitiveEmail, sensitiveIban, sensitiveTransferToken],
        query: sensitiveSql,
      },
      raw: {
        providerBody: {
          email: sensitiveEmail,
          iban: sensitiveIban,
        },
        requestId: 'req_safe_123',
      },
      stack: `Error: ${sensitiveSql}`,
    });

    expect(summary).toEqual({
      constraint: 'registration_transfers_claim_code_unique',
      operation: 'registration.transfer.claim',
      requestId: 'req_safe_123',
      sqlState: '23505',
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(sensitiveEmail);
    expect(serialized).not.toContain(sensitiveIban);
    expect(serialized).not.toContain(sensitiveSql);
    expect(serialized).not.toContain(sensitiveTransferToken);
  });

  it('does not copy arbitrary values into diagnostic fields', () => {
    const summary = safeServerErrorSummary(sensitiveSql, {
      code: sensitiveSql,
      constraint: sensitiveTransferToken,
      requestId: sensitiveEmail,
    });

    expect(summary).toEqual({ operation: 'server.operation' });
  });
});
