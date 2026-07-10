import { describe, expect, it } from 'vitest';

import {
  buildRegistrationTransferClaimUrl,
  createRegistrationTransferCredentials,
  hashRegistrationTransferCredential,
  normalizeRegistrationTransferClaimCode,
  registrationTransferCredentialHashes,
} from './registration-transfer-credentials';

describe('registration transfer credentials', () => {
  it('creates independent high-entropy link and manual-code locators', () => {
    const first = createRegistrationTransferCredentials();
    const second = createRegistrationTransferCredentials();

    expect(first.claimToken).toMatch(/^[\w-]{43}$/u);
    expect(first.claimCode).toMatch(/^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/u);
    expect(first.claimToken).not.toBe(second.claimToken);
    expect(first.claimCode).not.toBe(second.claimCode);
    expect(first.claimTokenHash).toHaveLength(64);
    expect(first.claimCodeHash).toHaveLength(64);
    expect(first.claimTokenHash).not.toContain(first.claimToken);
    expect(first.claimCodeHash).not.toContain(first.claimCode);
  });

  it('normalizes pasted codes while preserving case-sensitive link tokens', () => {
    const code = 'ABCD-1234-EF56-7890-ABCD-1234-EF56-7890';
    const codeHash = hashRegistrationTransferCredential(
      normalizeRegistrationTransferClaimCode(code),
    );
    const codeCandidates = registrationTransferCredentialHashes(
      ' abcd 1234 ef56 7890 abcd 1234 ef56 7890 ',
    );
    const tokenCandidates = registrationTransferCredentialHashes('Ab_c-123');

    expect(codeCandidates).toContain(codeHash);
    expect(tokenCandidates).toContain(
      hashRegistrationTransferCredential('Ab_c-123'),
    );
  });

  it('builds an application-owned claim URL without treating it as authorization', () => {
    expect(
      buildRegistrationTransferClaimUrl(
        'https://events.example/base',
        'claim/token',
      ),
    ).toBe('https://events.example/registration-transfers/claim%2Ftoken');
  });
});
