export interface CancellationPolicy {
  allowCancellation: boolean;
  includeTransactionFees: boolean;
  includeAppFees: boolean;
  cutoffDays: number; // >= 0
  cutoffHours: number; // 0..23
}

export type PolicyVariant = 'paid-regular' | 'paid-organizer' | 'free-regular' | 'free-organizer';

export type TenantCancellationPolicies = Partial<Record<PolicyVariant, CancellationPolicy>>;

export type CancellationReason = 'user' | 'admin' | 'organizer' | 'payment_abandoned' | 'other';