export interface EsnCardValidationResult {
  metadata?: unknown;
  status: 'expired' | 'invalid' | 'unverified' | 'verified';
  validFrom?: Date | null;
  validTo?: Date | null;
}

export const validateEsnCard = async (identifier: string): Promise<EsnCardValidationResult> => {
  if (!identifier) return { status: 'invalid' };
  try {
    const url = `https://esncard.org/services/1.0/card.json?code=${encodeURIComponent(identifier)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return { status: 'unverified' };
    }
    const data = (await response.json()) as unknown;
    const card = Array.isArray(data) ? data[0] : undefined;
    if (!card) return { status: 'invalid' };
    const status = String((card as any).status ?? '').toLowerCase();
    if (status !== 'active') {
      return { status: status === 'expired' ? 'expired' : 'invalid' };
    }
    const expiration = (card as any)['expiration-date'] ?? (card as any)['expiration_date'];
    const validTo = expiration ? new Date(expiration) : null;
    return { metadata: card, status: 'verified', validFrom: null, validTo };
  } catch {
    return { status: 'unverified' };
  }
};
