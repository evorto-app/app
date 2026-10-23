import { createHash, createHmac, randomBytes } from 'node:crypto';

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

// Domain separation keeps transfer codes independent of other uses of the key.
export const deriveRegistrationTransferClaimCode = (
  secret: string,
  tenantId: string,
  transferId: string,
): RegistrationTransferClaimCode => {
  const claimCode = formatClaimCode(
    createHmac('sha256', secret)
      .update(
        JSON.stringify(['evorto.transfer-claim.v1', tenantId, transferId]),
      )
      .digest('hex')
      .slice(0, claimCodeBytes * 2)
      .toUpperCase(),
  );
  return {
    claimCode,
    claimCodeHash: hashRegistrationTransferClaimCode(claimCode),
  };
};
