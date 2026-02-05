import { Schema } from 'effect';

export interface ProviderAdapter<TConfig> {
  validate: (arguments_: {
    config: TConfig;
    identifier: string;
  }) => Promise<ValidationResult>;
}

export interface ProviderConfig<
  TConfig extends Schema.Schema.Any = Schema.Schema.Any,
> {
  configSchema: TConfig;
  description?: string;
  displayName: string;
  type: ProviderType;
}

export type ProviderType = 'esnCard';

export interface ValidationResult {
  metadata?: unknown;
  status: 'expired' | 'invalid' | 'unverified' | 'verified';
  validFrom?: Date;
  validTo?: Date;
}

// ESN Card example config schema (placeholder)
const EsnConfig = Schema.Struct({
  apiKey: Schema.NonEmptyString,
  apiUrl: Schema.NonEmptyString,
});

export const PROVIDERS: Record<ProviderType, ProviderConfig> = {
  esnCard: {
    configSchema: EsnConfig,
    description: 'Validate ESN cards and eligibility windows.',
    displayName: 'ESN Card',
    type: 'esnCard',
  },
};

export const Adapters: Partial<Record<ProviderType, ProviderAdapter<unknown>>> =
  {
    esnCard: {
      async validate({ identifier }) {
        if (!identifier) return { status: 'invalid' };
        try {
          const url = `https://esncard.org/services/1.0/card.json?code=${encodeURIComponent(identifier)}`;
          const response = await fetch(url);
          if (!response.ok) {
            return { status: 'unverified' };
          }
          const data = (await response.json()) as unknown;
          if (!Array.isArray(data)) {
            return { status: 'invalid' };
          }
          const card = data[0] as Record<string, unknown> | undefined;
          if (!card) return { status: 'invalid' };
          const status = String(card['status'] ?? '').toLowerCase();
          if (status !== 'active') {
            return { status: status === 'expired' ? 'expired' : 'invalid' };
          }
          const expiration = card['expiration-date'] ?? card['expiration_date'];
          const validTo =
            typeof expiration === 'string' || typeof expiration === 'number'
              ? new Date(expiration)
              : undefined;
          const result: ValidationResult = {
            metadata: card,
            status: 'verified',
          };
          if (validTo) {
            result.validTo = validTo;
          }
          return result;
        } catch {
          return { status: 'unverified' };
        }
      },
    },
  };
