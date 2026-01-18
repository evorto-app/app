export type DiscountProviderType = 'esnCard';

export type EsnCardProviderSettings = {
  enabled: boolean;
  config?: {
    ctaEnabled?: boolean;
    ctaLink?: string;
  };
};

export type DiscountProvidersConfig = {
  esnCard?: EsnCardProviderSettings;
};
