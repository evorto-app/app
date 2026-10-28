import { Schema } from 'effect';

export const MAX_TENANT_FOOTER_LINKS = 8;
export const tenantFooterIconNames = [
  'website',
  'email',
  'social',
  'camera',
  'video',
  'link',
] as const;

export const isTenantFooterHref = (value: string): boolean => {
  if (value !== value.trim() || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? Boolean(url.hostname)
      : url.protocol === 'mailto:' &&
          /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url.pathname);
  } catch {
    return false;
  }
};

export const TenantFooterLink = Schema.Struct({
  href: Schema.String.check(
    Schema.makeFilter(isTenantFooterHref, {
      expected: 'an HTTP, HTTPS, or email link without credentials',
    }),
  ),
  icon: Schema.Literals(tenantFooterIconNames),
  label: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(60),
    Schema.makeFilter((value) => value.trim().length > 0),
  ),
});
export type TenantFooterLink = Schema.Schema.Type<typeof TenantFooterLink>;
export const TenantFooterLinks = Schema.Array(TenantFooterLink).check(
  Schema.isMaxLength(MAX_TENANT_FOOTER_LINKS),
);
