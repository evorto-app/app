import { createHash, randomBytes } from 'node:crypto';

const claimTokenBytes = 32;
const claimCodeBytes = 16;

export interface RegistrationTransferCredentials {
  readonly claimCode: string;
  readonly claimCodeHash: string;
  readonly claimToken: string;
  readonly claimTokenHash: string;
}

export const normalizeRegistrationTransferClaimCode = (value: string): string =>
  value.replaceAll(/[^0-9a-f]/giu, '').toUpperCase();

export const hashRegistrationTransferCredential = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const formatClaimCode = (hex: string): string =>
  hex.match(/.{1,4}/gu)?.join('-') ?? hex;

export const createRegistrationTransferCredentials =
  (): RegistrationTransferCredentials => {
    const claimToken = randomBytes(claimTokenBytes).toString('base64url');
    const claimCode = formatClaimCode(
      randomBytes(claimCodeBytes).toString('hex').toUpperCase(),
    );

    return {
      claimCode,
      claimCodeHash: hashRegistrationTransferCredential(
        normalizeRegistrationTransferClaimCode(claimCode),
      ),
      claimToken,
      claimTokenHash: hashRegistrationTransferCredential(claimToken),
    };
  };

export const registrationTransferCredentialHashes = (
  credential: string,
): readonly string[] => {
  const trimmed = credential.trim();
  const code = normalizeRegistrationTransferClaimCode(trimmed);
  return [
    ...new Set([
      hashRegistrationTransferCredential(trimmed),
      ...(code ? [hashRegistrationTransferCredential(code)] : []),
    ]),
  ];
};

export const buildRegistrationTransferClaimUrl = (
  baseUrl: string,
  claimToken: string,
): string =>
  new URL(
    `/registration-transfers/${encodeURIComponent(claimToken)}`,
    baseUrl,
  ).toString();
