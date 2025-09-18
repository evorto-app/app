import { Schema } from 'effect';

export interface ProviderAdapter<TConfig> {
  validate: (arguments_: {
    config: TConfig;
    identifier: string;
  }) => Promise<ValidationResult>;
}

export interface ProviderConfig<TConfig extends Schema.Schema<any> = any> {
  configSchema: TConfig;
  description?: string;
  displayName: string;
  type: ProviderType;
}

export type ProviderType = 'esnCard';

export interface ValidationResult {
  metadata?: unknown;
  status: 'expired' | 'invalid' | 'unverified' | 'verified';
  validFrom?: Date | null;
  validTo?: Date | null;
}

// ESNcard example config schema (placeholder)
const EsnConfig = Schema.Struct({
  apiKey: Schema.NonEmptyString,
  apiUrl: Schema.NonEmptyString,
});

export const PROVIDERS: Record<ProviderType, ProviderConfig> = {
  esnCard: {
    configSchema: EsnConfig,
    description: 'Validate ESNcard credentials and eligibility windows.',
    displayName: 'ESNcard',
    type: 'esnCard',
  },
};

export const Adapters: Partial<Record<ProviderType, ProviderAdapter<any>>> = {
  esnCard: {
    async validate({ identifier }) {
      if (!identifier) return { status: 'invalid' };
      try {
        const url = `https://esncard.org/services/1.0/card.json?code=${encodeURIComponent(identifier)}`;
        const response = await fetch(url);
        if (!response.ok) {
          return { status: 'unverified' };
        }
        const data = (await response.json()) as any[];
        const card = Array.isArray(data) ? data[0] : undefined;
        if (!card) return { status: 'invalid' };
        const status = String(card.status ?? '').toLowerCase();
        if (status !== 'active') {
          return { status: status === 'expired' ? 'expired' : 'invalid' };
        }
        const expiration = card['expiration-date'] ?? card['expiration_date'];
        const validTo = expiration ? new Date(expiration) : null;
        return { metadata: card, status: 'verified', validFrom: null, validTo };
      } catch {
        return { status: 'unverified' };
      }
    },
  },
};
