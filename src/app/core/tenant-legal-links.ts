export interface TenantLegalLink {
  external: boolean;
  href: string;
  label: string;
}

export interface TenantLegalLinks {
  legalNoticeText?: null | string | undefined;
  legalNoticeUrl?: null | string | undefined;
  privacyPolicyText?: null | string | undefined;
  privacyPolicyUrl?: null | string | undefined;
  termsText?: null | string | undefined;
  termsUrl?: null | string | undefined;
}

export type TenantLegalPage = 'imprint' | 'privacy' | 'terms';

const textOrNothing = (value: null | string | undefined): string | undefined =>
  value?.trim() || undefined;

const linkOrNothing = (
  label: string,
  href: null | string | undefined,
  page: TenantLegalPage,
  text: null | string | undefined,
): TenantLegalLink[] => {
  const trimmedHref = href?.trim();
  if (trimmedHref) {
    return [{ external: true, href: trimmedHref, label }];
  }

  return textOrNothing(text)
    ? [{ external: false, href: `/legal/${page}`, label }]
    : [];
};

export const tenantLegalLinks = (
  tenant: null | TenantLegalLinks | undefined,
) =>
  tenant
    ? [
        ...linkOrNothing(
          'Imprint',
          tenant.legalNoticeUrl,
          'imprint',
          tenant.legalNoticeText,
        ),
        ...linkOrNothing(
          'Privacy',
          tenant.privacyPolicyUrl,
          'privacy',
          tenant.privacyPolicyText,
        ),
        ...linkOrNothing('Terms', tenant.termsUrl, 'terms', tenant.termsText),
      ]
    : [];

export const tenantLegalPageContent = (
  tenant: null | TenantLegalLinks | undefined,
  page: TenantLegalPage,
): string | undefined => {
  if (!tenant) {
    return undefined;
  }

  switch (page) {
    case 'imprint': {
      return textOrNothing(tenant.legalNoticeText);
    }
    case 'privacy': {
      return textOrNothing(tenant.privacyPolicyText);
    }
    case 'terms': {
      return textOrNothing(tenant.termsText);
    }
  }
};

export const tenantLegalPageTitle = (page: TenantLegalPage): string => {
  switch (page) {
    case 'imprint': {
      return 'Imprint';
    }
    case 'privacy': {
      return 'Privacy policy';
    }
    case 'terms': {
      return 'Terms';
    }
  }
};
