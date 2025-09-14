import consola from 'consola';

/**
 * Structured logging events for tax rate operations
 * These provide audit trails and debugging information
 */

export interface TaxRateLogContext {
  tenantId: string;
  userId?: string;
  timestamp?: Date;
}

export interface ImportLogData extends TaxRateLogContext {
  stripeTaxRateIds: string[];
  importedCount: number;
  skippedCount: number;
  errors?: string[];
}

export interface ValidationLogData extends TaxRateLogContext {
  optionType: 'template' | 'event';
  optionId: string;
  optionTitle?: string;
  stripeTaxRateId?: string | null;
  isPaid: boolean;
  validationResult: 'success' | 'error';
  errorCode?: string;
  errorMessage?: string;
}

export interface CheckoutLogData extends TaxRateLogContext {
  registrationId: string;
  eventId: string;
  stripeTaxRateId?: string | null;
  originalPrice: number;
  effectivePrice: number;
  treatAsFree?: boolean;
  taxRateStatus?: 'active' | 'inactive' | 'missing';
}

export interface LabelLogData extends TaxRateLogContext {
  stripeTaxRateId?: string | null;
  fallbackUsed: boolean;
  requestedData?: {
    percentage?: string | null;
    displayName?: string | null;
  };
  resolvedLabel: string;
}

export interface MigrationLogData extends TaxRateLogContext {
  optionType: 'template' | 'event';
  optionId: string;
  previousTaxRateId?: string | null;
  assignedTaxRateId?: string | null;
  migrationStep: string;
}

/**
 * Tax rate operation logger with structured events
 */
export class TaxRateLogger {
  /**
   * Log successful tax rate import operation
   */
  static logImportSuccess(data: ImportLogData): void {
    consola.info('tax-rates.import.success', {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Log tax rate import failure
   */
  static logImportError(data: ImportLogData & { error: Error }): void {
    consola.error('tax-rates.import.error', {
      ...data,
      errorMessage: data.error.message,
      errorStack: data.error.stack,
      timestamp: new Date(),
    });
  }

  /**
   * Log tax rate validation events
   */
  static logValidation(data: ValidationLogData): void {
    if (data.validationResult === 'error') {
      consola.error('tax-rates.validation.error', {
        ...data,
        timestamp: new Date(),
      });
    } else {
      consola.debug('tax-rates.validation.success', {
        ...data,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Log checkout tax rate warnings
   */
  static logCheckoutWarning(data: CheckoutLogData & { warning: string }): void {
    consola.warn('tax-rates.checkout.warning', {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Log checkout tax rate events
   */
  static logCheckoutEvent(data: CheckoutLogData): void {
    if (data.treatAsFree) {
      consola.info('tax-rates.checkout.treat-as-free', {
        ...data,
        timestamp: new Date(),
      });
    } else {
      consola.debug('tax-rates.checkout.process', {
        ...data,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Log fallback label usage
   */
  static logLabelFallback(data: LabelLogData): void {
    if (data.fallbackUsed) {
      consola.debug('tax-rates.label.fallback-used', {
        ...data,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Log migration operations
   */
  static logMigration(data: MigrationLogData): void {
    consola.info('tax-rates.migration.assignment', {
      ...data,
      timestamp: new Date(),
    });
  }

  /**
   * Log when imported rate becomes unavailable
   */
  static logRateUnavailable(data: TaxRateLogContext & {
    stripeTaxRateId: string;
    reason: string;
    affectedOptions?: Array<{ optionId: string; optionType: 'template' | 'event' }>;
  }): void {
    consola.warn('tax-rates.rate.unavailable', {
      ...data,
      timestamp: new Date(),
    });
  }
}

/**
 * Helper function to create base log context from common parameters
 */
export function createLogContext(tenantId: string, userId?: string): TaxRateLogContext {
  const context: TaxRateLogContext = {
    tenantId,
    timestamp: new Date(),
  };
  
  if (userId) {
    context.userId = userId;
  }
  
  return context;
}