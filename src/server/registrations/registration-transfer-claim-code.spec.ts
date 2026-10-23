import { describe, expect, it } from 'vitest';

import {
  createRegistrationTransferClaimCode,
  deriveRegistrationTransferClaimCode,
  hashRegistrationTransferClaimCode,
  normalizeRegistrationTransferClaimCode,
} from './registration-transfer-claim-code';

describe('registration transfer claim code', () => {
  it('creates independent 128-bit claim codes stored only as hashes', () => {
    const first = createRegistrationTransferClaimCode();
    const second = createRegistrationTransferClaimCode();

    expect(first.claimCode).toMatch(/^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/u);
    expect(first.claimCode).not.toBe(second.claimCode);
    expect(first.claimCodeHash).toHaveLength(64);
    expect(first.claimCodeHash).not.toContain(first.claimCode);
  });

  it('normalizes only harmless whitespace and case differences', () => {
    const code = 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890';
    const pastedCode = ' abcd-1234-ef56-7890-abcd-1234-ef56-7890 ';

    expect(normalizeRegistrationTransferClaimCode(pastedCode)).toBe(
      normalizeRegistrationTransferClaimCode(code),
    );
    expect(hashRegistrationTransferClaimCode(pastedCode)).toBe(
      hashRegistrationTransferClaimCode(code),
    );
    expect(normalizeRegistrationTransferClaimCode('ABCD_1234')).toBe(
      'ABCD_1234',
    );
  });
});

describe('recoverable owner transfer codes', () => {
  it('recovers the same code and isolates keys, tenants, and offers', () => {
    const code = deriveRegistrationTransferClaimCode(
      'test-secret',
      'tenant-1',
      'offer-1',
    );
    expect(code).toEqual(
      deriveRegistrationTransferClaimCode('test-secret', 'tenant-1', 'offer-1'),
    );
    expect(code.claimCode).toMatch(/^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/u);
    expect(code.claimCodeHash).toBe(
      hashRegistrationTransferClaimCode(code.claimCode),
    );
    for (const other of [
      deriveRegistrationTransferClaimCode(
        'other-secret',
        'tenant-1',
        'offer-1',
      ),
      deriveRegistrationTransferClaimCode('test-secret', 'tenant-2', 'offer-1'),
      deriveRegistrationTransferClaimCode('test-secret', 'tenant-1', 'offer-2'),
    ])
      expect(other.claimCode).not.toBe(code.claimCode);
  });
});
