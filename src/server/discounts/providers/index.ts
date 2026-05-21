import { literalUnion } from '@shared/schema-utilities';
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
  validationMode: Schema.optional(literalUnion('live', 'test')),
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

const testEsnCardValidTo = new Date('2099-12-31T00:00:00.000Z');

const testEsnCardResultByIdentifier: Record<string, ValidationResult> = {
  TESTESN0001: {
    metadata: { provider: 'evorto-test-mode', status: 'active' },
    status: 'verified',
    validTo: testEsnCardValidTo,
  },
  TESTESNEXPIRE: {
    metadata: { provider: 'evorto-test-mode', status: 'expired' },
    status: 'expired',
  },
  TESTESNINVALID: {
    metadata: { provider: 'evorto-test-mode', status: 'invalid' },
    status: 'invalid',
  },
  TESTESNUNVERIF: {
    metadata: { provider: 'evorto-test-mode', status: 'unverified' },
    status: 'unverified',
  },
  TESTESNVERIFY: {
    metadata: { provider: 'evorto-test-mode', status: 'active' },
    status: 'verified',
    validTo: testEsnCardValidTo,
  },
};

const isTestModeConfig = (config: unknown): boolean =>
  !!config &&
  typeof config === 'object' &&
  (config as { validationMode?: unknown }).validationMode === 'test';

export const validateTestEsnCard = ({
  identifier,
}: {
  identifier: string;
}): ValidationResult => {
  if (identifier === 'TESTESNDOWN') {
    throw new ProviderValidationUnavailableError(
      'ESNcard validation test provider is unavailable',
      'unavailable',
    );
  }

  return testEsnCardResultByIdentifier[identifier] ?? { status: 'invalid' };
};

export const Adapters: Partial<Record<ProviderType, ProviderAdapter<unknown>>> =
  {
    esnCard: {
      async validate({ config, identifier }) {
        if (isTestModeConfig(config)) {
          return validateTestEsnCard({ identifier });
        }

        return validateEsnCard({ identifier });
      },
    },
  };
