import { Schema } from 'effect';

export interface ProviderAdapter<TConfig> {
  validate: (arguments_: {
    config: TConfig;
    identifier: string;
  }) => Promise<ValidationResult>;
}

export interface ProviderConfig<TConfig extends Schema.Top = Schema.Top> {
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

export class ProviderValidationUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'invalidResponse' | 'network' | 'timeout' | 'unavailable',
  ) {
    super(message);
    this.name = 'ProviderValidationUnavailableError';
  }
}

const esnCardValidationTimeoutMs = 10_000;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const isValidDate = (date: Date): boolean => !Number.isNaN(date.getTime());

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

export const validateEsnCard = async ({
  fetchImpl = fetch,
  identifier,
  timeoutMs = esnCardValidationTimeoutMs,
}: {
  fetchImpl?: typeof fetch;
  identifier: string;
  timeoutMs?: number;
}): Promise<ValidationResult> => {
  if (!identifier) return { status: 'invalid' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://esncard.org/services/1.0/card.json?code=${encodeURIComponent(identifier)}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ProviderValidationUnavailableError(
        `ESNcard validation provider returned ${response.status}`,
        'unavailable',
      );
    }
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new ProviderValidationUnavailableError(
        'ESNcard validation provider returned an invalid response',
        'invalidResponse',
      );
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
    if (validTo && isValidDate(validTo)) {
      result.validTo = validTo;
    }
    return result;
  } catch (error) {
    if (error instanceof ProviderValidationUnavailableError) {
      throw error;
    }

    throw new ProviderValidationUnavailableError(
      'ESNcard validation provider is unavailable',
      isAbortError(error) ? 'timeout' : 'network',
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const Adapters: Partial<Record<ProviderType, ProviderAdapter<unknown>>> =
  {
    esnCard: {
      async validate({ identifier }) {
        return validateEsnCard({ identifier });
      },
    },
  };
