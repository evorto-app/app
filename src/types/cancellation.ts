/**
 * Types for registration cancellation configuration feature.
 * These types are shared between client and server code.
 */

/**
 * Variants for cancellation policies based on registration type and payment status
 */
export type PolicyVariant = 'paid-regular' | 'paid-organizer' | 'free-regular' | 'free-organizer';

/**
 * Base cancellation policy configuration
 */
export interface CancellationPolicy {
  /** Whether cancellation is allowed for this variant */
  allowCancellation: boolean;
  /** Whether refunds include transaction/processor fees */
  includeTransactionFees: boolean;
  /** Whether refunds include application fees */
  includeAppFees: boolean;
  /** Days before event start when cancellation is no longer allowed */
  cutoffDays: number;
  /** Hours before event start when cancellation is no longer allowed (0-23) */
  cutoffHours: number;
}

/**
 * Tenant-level default policies for all four variants
 */
export interface TenantCancellationPolicies {
  'paid-regular': CancellationPolicy;
  'paid-organizer': CancellationPolicy;
  'free-regular': CancellationPolicy;
  'free-organizer': CancellationPolicy;
}

/**
 * Option-level policy configuration with inheritance flag
 */
export interface OptionCancellationConfig {
  /** Whether to use tenant default for this option */
  useTenantDefault: boolean;
  /** Custom policy if not using tenant default */
  policy?: CancellationPolicy;
}

/**
 * Effective policy resolved for a specific registration
 */
export interface EffectiveCancellationPolicy extends CancellationPolicy {
  /** Source of the policy for auditing */
  source: 'tenant-default' | 'option-override';
  /** Which variant was resolved */
  variant: PolicyVariant;
}

/**
 * Cancellation request input
 */
export interface CancellationRequest {
  /** Registration ID to cancel */
  registrationId: string;
  /** Reason for cancellation */
  reason: CancellationReason;
  /** Optional additional notes */
  reasonNote?: string;
}

/**
 * Cancellation result
 */
export interface CancellationResult {
  /** Whether cancellation was successful */
  success: boolean;
  /** Refund amount if applicable */
  refundAmount?: number;
  /** Whether refund includes transaction fees */
  refundIncludesTransactionFees?: boolean;
  /** Whether refund includes app fees */
  refundIncludesAppFees?: boolean;
  /** Error message if cancellation failed */
  error?: string;
}

/**
 * Reasons for cancellation
 */
export type CancellationReason = 
  | 'user-request'
  | 'no-show'
  | 'duplicate'
  | 'admin-action'
  | 'policy-violation'
  | 'other';

/**
 * Helper to resolve policy variant based on registration details
 */
export function resolvePolicyVariant(isPaid: boolean, isOrganizer: boolean): PolicyVariant {
  if (isPaid && isOrganizer) return 'paid-organizer';
  if (isPaid && !isOrganizer) return 'paid-regular';
  if (!isPaid && isOrganizer) return 'free-organizer';
  return 'free-regular';
}

/**
 * Helper to check if cancellation is allowed based on policy and timing
 */
export function isCancellationAllowed(
  policy: CancellationPolicy,
  eventStartTime: Date,
  currentTime: Date = new Date()
): boolean {
  if (!policy.allowCancellation) return false;
  
  const cutoffTime = new Date(eventStartTime);
  cutoffTime.setDate(cutoffTime.getDate() - policy.cutoffDays);
  cutoffTime.setHours(cutoffTime.getHours() - policy.cutoffHours);
  
  return currentTime < cutoffTime;
}

/**
 * Helper to create default cancellation policy
 */
export function createDefaultPolicy(): CancellationPolicy {
  return {
    allowCancellation: true,
    includeTransactionFees: false,
    includeAppFees: true,
    cutoffDays: 1,
    cutoffHours: 0,
  };
}

/**
 * Helper to create default tenant policies
 */
export function createDefaultTenantPolicies(): TenantCancellationPolicies {
  const basePolicy = createDefaultPolicy();
  
  return {
    'paid-regular': { ...basePolicy },
    'paid-organizer': { ...basePolicy, cutoffDays: 0, cutoffHours: 12 },
    'free-regular': { ...basePolicy, cutoffDays: 0, cutoffHours: 6 },
    'free-organizer': { ...basePolicy, cutoffDays: 0, cutoffHours: 3 },
  };
}