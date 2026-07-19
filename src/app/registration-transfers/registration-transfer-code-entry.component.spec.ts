import { describe, expect, it } from 'vitest';

import { normalizeRegistrationTransferCode } from './registration-transfer-code-entry.component';

describe('normalizeRegistrationTransferCode', () => {
  it('normalizes copied manual codes before navigation', () => {
    expect(normalizeRegistrationTransferCode(' abcd-1234-ef56 ')).toBe(
      'ABCD-1234-EF56',
    );
  });
});
