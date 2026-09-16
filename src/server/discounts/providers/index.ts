import { Schema } from 'effect';

export interface ProviderAdapter {
  validate: (arguments_: { identifier: string }) => Promise<ValidationResult>;
}

export const PROVIDER_TYPES = ['esnCard'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type ValidationResult =
  | {
      metadata?: unknown;
      status: 'expired' | 'verified';
      validFrom: Date;
      validTo: Date;
    }
  | {
      metadata?: unknown;
      status: 'invalid' | 'unverified';
      validFrom?: undefined;
      validTo?: undefined;
    };

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

const esnCardProviderRecord = Schema.Struct({
  'activation date': Schema.String,
  'expiration-date': Schema.String,
  status: Schema.Literals(['active', 'expired']),
});

const invalidEsnCardResponse = () =>
  new ProviderValidationUnavailableError(
    'ESNcard validation provider returned an invalid response',
    'invalidResponse',
  );

const providerDate = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidEsnCardResponse();
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw invalidEsnCardResponse();
  }
  return date;
};

export const validateEsnCard = async ({
  fetchImpl = fetch,
  identifier,
  timeoutMs = esnCardValidationTimeoutMs,
}: {
  fetchImpl?: (
    ...arguments_: Parameters<typeof fetch>
  ) => ReturnType<typeof fetch>;
  identifier: string;
  timeoutMs?: number;
}): Promise<ValidationResult> => {
  if (!identifier) return { status: 'invalid' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://www.esncard.org/services/1.0/card.json?code=${encodeURIComponent(identifier)}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ProviderValidationUnavailableError(
        `ESNcard validation provider returned ${response.status}`,
        'unavailable',
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) throw invalidEsnCardResponse();
      throw error;
    }
    if (!Array.isArray(data)) throw invalidEsnCardResponse();
    if (data.length === 0) return { status: 'invalid' };
    if (data.length !== 1) throw invalidEsnCardResponse();

    let card: Schema.Schema.Type<typeof esnCardProviderRecord>;
    try {
      card = Schema.decodeUnknownSync(esnCardProviderRecord)(data[0]);
    } catch {
      throw invalidEsnCardResponse();
    }

    const validFrom = providerDate(card['activation date']);
    const validTo = providerDate(card['expiration-date']);
    if (validFrom > validTo) throw invalidEsnCardResponse();

    return {
      metadata: card,
      status: card.status === 'active' ? 'verified' : 'expired',
      validFrom,
      validTo,
    };
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

export const Adapters: Record<ProviderType, ProviderAdapter> = {
  esnCard: {
    async validate({ identifier }) {
      return validateEsnCard({ identifier });
    },
  },
};
