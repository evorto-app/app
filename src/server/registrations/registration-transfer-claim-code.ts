import { createHash, randomBytes } from 'node:crypto';

const claimCodeBytes = 16;

export interface RegistrationTransferClaimCode {
  readonly claimCode: string;
  readonly claimCodeHash: string;
}

export const normalizeRegistrationTransferClaimCode = (value: string): string =>
  value.trim().toUpperCase();

export const hashRegistrationTransferClaimCode = (value: string): string =>
  createHash('sha256')
    .update(normalizeRegistrationTransferClaimCode(value), 'utf8')
    .digest('hex');

const formatClaimCode = (hex: string): string =>
  hex.match(/.{1,4}/gu)?.join('-') ?? hex;

export const createRegistrationTransferClaimCode =
  (): RegistrationTransferClaimCode => {
    const claimCode = formatClaimCode(
      randomBytes(claimCodeBytes).toString('hex').toUpperCase(),
    );

    return {
      claimCode,
      claimCodeHash: hashRegistrationTransferClaimCode(claimCode),
    };
  };
