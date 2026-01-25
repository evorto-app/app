export interface DiscountProvidersConfig {
  esnCard?: EsnCardProviderSettings;
}

export type DiscountProviderType = 'esnCard';

export interface EsnCardProviderSettings {
  config?: {
    ctaEnabled?: boolean;
    ctaLink?: string;
  };
  enabled: boolean;
}
