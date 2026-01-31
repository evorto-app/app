import consola from 'consola';

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
  logCheckoutEvent(data: CheckoutLogData): void {
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
  },

  /**
   * Log checkout tax rate warnings
   */
  logCheckoutWarning(data: CheckoutLogData & { warning: string }): void {
    consola.warn('tax-rates.checkout.warning', {
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log tax rate import failure
   */
  logImportError(data: ImportLogData & { error: Error }): void {
    consola.error('tax-rates.import.error', {
      ...data,
      errorMessage: data.error.message,
      errorStack: data.error.stack,
      timestamp: new Date(),
    });
  },

  /**
   * Log successful tax rate import operation
   */
  logImportSuccess(data: ImportLogData): void {
    consola.info('tax-rates.import.success', {
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log fallback label usage
   */
  logLabelFallback(data: LabelLogData): void {
    if (data.fallbackUsed) {
      consola.debug('tax-rates.label.fallback-used', {
        ...data,
        timestamp: new Date(),
      });
    }
  },

  /**
   * Log migration operations
   */
  logMigration(data: MigrationLogData): void {
    consola.info('tax-rates.migration.assignment', {
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log when imported rate becomes unavailable
   */
  logRateUnavailable(data: TaxRateLogContext & {
    affectedOptions?: { optionId: string; optionType: 'event' | 'template' }[];
    reason: string;
    stripeTaxRateId: string;
  }): void {
    consola.warn('tax-rates.rate.unavailable', {
      ...data,
      timestamp: new Date(),
    });
  },

  /**
   * Log tax rate validation events
   */
  logValidation(data: ValidationLogData): void {
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
  },
};

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