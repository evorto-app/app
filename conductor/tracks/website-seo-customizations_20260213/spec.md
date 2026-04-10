# Track Spec: Tenant Website SEO + Admin Website Customizations

## Overview

Add tenant-admin controls for website branding, SEO metadata, public/internal link lists, and legal/help content pages so each tenant can configure their website and member-facing resources without code changes.

This is a feature track focused on admin-managed website settings and policy compliance.

## Functional Requirements

### 1. Tenant Website Settings Area

- Provide an admin settings area for website customization.
- Scope is tenant-specific and isolated; tenant changes must not affect other tenants.

### 2. Branding: Logo + Favicon Processing

- Admin can upload a primary logo image.
- Admin can optionally define crop/focal-point before favicon generation.
- System generates favicon assets from the selected crop:
  - `.ico`
  - PNG variants for common sizes (at least 16x16, 32x32, 180x180).
- Generated favicon is applied on tenant website pages.
- Original uploaded logo remains available for brand display use.

### 3. Core SEO Fields

- Admin can set:
  - Site title
  - Site description
- These values are used in default page metadata for the tenant website.

### 4. Social Preview Metadata (v1)

- Admin can configure Open Graph/Twitter metadata:
  - Social title
  - Social description
  - Social image (reuse logo or upload dedicated image)
- Public pages render corresponding social meta tags.

### 5. Google Opt-In Indexing Controls

- Tenant can explicitly opt in/out of Google indexing controls.
- Controls include:
  - Allow/disallow indexing (robots/meta directives)
  - Sitemap enable/disable
- No GA4/Search Console integration in this track.

### 6. Structured Data Controls

- Tenant can enable/disable structured data output.
- Structured data supports relevant website/event context where available.
- Social profile links can be represented in structured data when configured.

### 7. Public Footer Links (Global Footer)

- Admin manages a list of links displayed in the global footer across the entire website.
- Each link entry includes:
  - Title
  - URL
  - Icon (using the existing icon control/picker already in the product)
- Intended for social links (e.g., Instagram, TikTok) and similar external destinations.
- Admin can reorder links.

### 8. Internal Links (Members Hub Only)

- Admin manages a second list of links shown only in the Members Hub.
- Each entry includes:
  - Title
  - URL
  - Icon (same existing icon control/picker)
- Admin can reorder links.

### 9. Legal/Informational Content Editors

- Provide one rich-text editor per page:
  - Terms and Conditions
  - Imprint
  - FAQ
  - Privacy Policy (tenant)
- Publishing behavior is immediate (no draft/publish workflow).

### 10. Privacy Policy Versioning and Acceptance Tracking

#### Tenant Privacy Policy (per tenant)

- Track `last_changed_at` whenever tenant privacy policy content changes.
- Track each user's `last_accepted_at` (or accepted version reference) per tenant privacy policy.
- If tenant policy changed after user acceptance:
  - show persistent banner until re-accepted,
  - gate sensitive actions until re-accepted.

#### Platform Privacy Policy (global, shared across all tenants)

- Maintain one global platform privacy policy.
- Track global policy `last_changed_at`.
- Track each user's global platform policy acceptance (`last_accepted_at` or version reference).
- If global policy changed after user acceptance:
  - show persistent banner until re-accepted,
  - gate sensitive actions until re-accepted.

### 11. Permissions and Validation

- Only authorized tenant admins can edit tenant website settings.
- Platform privacy policy can only be edited by platform-level admins.
- Validate URL fields and uploaded file types/sizes.
- Prevent unsafe or malformed rich-text output.

## Non-Functional Requirements

- Maintain full type safety end-to-end (schema, API, client typing).
- Preserve SSR compatibility and correct meta rendering in SSR output.
- Accessibility for admin forms and link management UI.
- Mobile-responsive settings screens.
- Minimal performance overhead for metadata and footer/member link rendering.

## Acceptance Criteria

1. Tenant admin can upload logo, set crop/focal-point, and generated favicon is used on tenant pages.
2. Tenant admin can set site title/description and social metadata; metadata appears in rendered HTML head.
3. Tenant admin can configure indexing/sitemap controls via tenant Google opt-in settings.
4. Tenant admin can enable/disable structured data output.
5. Tenant admin can manage global footer links (with existing icon control); links appear in global footer everywhere.
6. Tenant admin can manage Members Hub links (with existing icon control); links appear only in Members Hub.
7. Tenant admin can edit Terms, Imprint, FAQ, and tenant Privacy Policy via rich-text editors with immediate publishing.
8. Tenant privacy policy changes force re-acceptance (banner + sensitive-action gate) until accepted.
9. Global platform privacy policy exists and changes force re-acceptance (banner + sensitive-action gate) until accepted.
10. Non-admin users cannot modify website settings; only platform admins can modify global platform policy.
11. Existing tenants/users without configured values fall back safely (no crashes, sensible defaults).

## Out of Scope

- GA4, Search Console verification, tag manager, ad integrations.
- Multi-language policy/content management.
- Draft/version history workflow beyond required change/acceptance tracking.
- Per-page advanced SEO rule builders beyond defined controls.

## Suggested Follow-Ups

- Add a metadata preview panel showing search/social snippets before saving.
- Add per-link `nofollow` and `open in new tab` toggles for external links.
- Add policy acceptance audit export for compliance reviews.
