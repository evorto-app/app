export interface TenantLegalLinks {
  legalNoticeUrl?: null | string | undefined;
  privacyPolicyUrl?: null | string | undefined;
  termsUrl?: null | string | undefined;
}

const linkOrNothing = (label: string, href: null | string | undefined) => {
  const trimmedHref = href?.trim();
  return trimmedHref ? [{ href: trimmedHref, label }] : [];
};

export const tenantLegalLinks = (
  tenant: null | TenantLegalLinks | undefined,
) =>
  tenant
    ? [
        ...linkOrNothing('Imprint', tenant.legalNoticeUrl),
        ...linkOrNothing('Privacy', tenant.privacyPolicyUrl),
        ...linkOrNothing('Terms', tenant.termsUrl),
      ]
    : [];
