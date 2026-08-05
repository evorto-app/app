import { describe, expect, it } from 'vitest';

import { normalizeRegistrationTransferCode } from './registration-transfer-code-entry.component';

describe('normalizeRegistrationTransferCode', () => {
  it('normalizes copied claim codes before RPC submission', () => {
    expect(normalizeRegistrationTransferCode(' abcd-1234-ef56 ')).toBe(
      'ABCD-1234-EF56',
    );
  });
});
