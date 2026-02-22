import { Effect } from 'effect';

/**
 * Structured logging events for tax rate operations
 * These provide audit trails and debugging information
 */

export interface CheckoutLogData extends TaxRateLogContext {
  effectivePrice: number;
  eventId: string;
  originalPrice: number;
  registrationId: string;
  stripeTaxRateId?: null | string;
  taxRateStatus?: 'active' | 'inactive' | 'missing';
  treatAsFree?: boolean;
}

export interface ImportLogData extends TaxRateLogContext {
  errors?: string[];
  importedCount: number;
  skippedCount: number;
  stripeTaxRateIds: string[];
}

export interface LabelLogData extends TaxRateLogContext {
  fallbackUsed: boolean;
  requestedData?: {
    displayName?: null | string;
    percentage?: null | string;
  };
  resolvedLabel: string;
  stripeTaxRateId?: null | string;
}

export interface MigrationLogData extends TaxRateLogContext {
  assignedTaxRateId?: null | string;
  migrationStep: string;
  optionId: string;
  optionType: 'event' | 'template';
  previousTaxRateId?: null | string;
}

export interface TaxRateLogContext {
  tenantId: string;
  timestamp?: Date;
  userId?: string;
}

export interface ValidationLogData extends TaxRateLogContext {
  errorCode?: string;
  errorMessage?: string;
  isPaid: boolean;
  optionId: string;
  optionTitle?: string;
  optionType: 'event' | 'template';
  stripeTaxRateId?: null | string;
  validationResult: 'error' | 'success';
}

/**
 * Tax rate operation logger with structured events
 */
export const TaxRateLogger = {
  /**
   * Log checkout tax rate events
   */
  logCheckoutEvent(data: CheckoutLogData): Effect.Effect<void> {
    if (data.treatAsFree) {
      return Effect.logInfo({
        event: 'tax-rates.checkout.treat-as-free',
        ...data,
        timestamp: new Date(),
      });
    }

    return Effect.logDebug({
      event: 'tax-rates.checkout.process',
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log checkout tax rate warnings
   */
  logCheckoutWarning(
    data: CheckoutLogData & { warning: string },
  ): Effect.Effect<void> {
    return Effect.logWarning({
      event: 'tax-rates.checkout.warning',
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log tax rate import failure
   */
  logImportError(data: ImportLogData & { error: Error }): Effect.Effect<void> {
    return Effect.logError({
      event: 'tax-rates.import.error',
      ...data,
      errorMessage: data.error.message,
      errorStack: data.error.stack,
      timestamp: new Date(),
    });
  },

  /**
   * Log successful tax rate import operation
   */
  logImportSuccess(data: ImportLogData): Effect.Effect<void> {
    return Effect.logInfo({
      event: 'tax-rates.import.success',
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log fallback label usage
   */
  logLabelFallback(data: LabelLogData): Effect.Effect<void> {
    if (data.fallbackUsed) {
      return Effect.logDebug({
        event: 'tax-rates.label.fallback-used',
        ...data,
        timestamp: new Date(),
      });
    }

    return Effect.void;
  },

  /**
   * Log migration operations
   */
  logMigration(data: MigrationLogData): Effect.Effect<void> {
    return Effect.logInfo({
      event: 'tax-rates.migration.assignment',
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log when imported rate becomes unavailable
   */
  logRateUnavailable(
    data: TaxRateLogContext & {
      affectedOptions?: {
        optionId: string;
        optionType: 'event' | 'template';
      }[];
      reason: string;
      stripeTaxRateId: string;
    },
  ): Effect.Effect<void> {
    return Effect.logWarning({
      event: 'tax-rates.rate.unavailable',
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log tax rate validation events
   */
  logValidation(data: ValidationLogData): Effect.Effect<void> {
    if (data.validationResult === 'error') {
      return Effect.logError({
        event: 'tax-rates.validation.error',
        ...data,
        timestamp: new Date(),
      });
    }

    return Effect.logDebug({
      event: 'tax-rates.validation.success',
      ...data,
      timestamp: new Date(),
    });
  },
};

/**
 * Helper function to create base log context from common parameters
 */
export function createLogContext(
  tenantId: string,
  userId?: string,
): TaxRateLogContext {
  const context: TaxRateLogContext = {
    tenantId,
    timestamp: new Date(),
  };

  if (userId) {
    context.userId = userId;
  }

  return context;
}
