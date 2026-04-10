# Implementation Plan

## Phase 1: Data Model + Test Intent

- [ ] Task: Design and add tenant website settings persistence
  - [ ] Add storage for title/description, social metadata, indexing controls, and structured-data toggle
  - [ ] Add storage for logo asset reference and generated favicon asset references
  - [ ] Add storage for footer links and Members Hub links (title, URL, icon, order)
- [ ] Task: Add privacy policy and acceptance tracking persistence
  - [ ] Add tenant privacy policy content with `last_changed_at`
  - [ ] Add global platform privacy policy content with `last_changed_at`
  - [ ] Add per-user acceptance records for tenant and platform privacy policies
- [ ] Task: Plan e2e/doc coverage for this track
  - [ ] Map journeys for admin settings management and website rendering behavior
  - [ ] Map journeys for privacy-policy re-acceptance banner and sensitive-action gating
- [ ] Task: Conductor - User Manual Verification 'Data Model + Test Intent' (Protocol in workflow.md)

## Phase 2: Backend + Rendering Integration

- [ ] Task: Implement website settings APIs
  - [ ] Add typed input/output schemas for tenant settings CRUD
  - [ ] Enforce tenant-admin permissions and tenant scoping
- [ ] Task: Implement logo processing and favicon generation pipeline
  - [ ] Accept optional crop/focal-point metadata
  - [ ] Generate favicon assets and persist references
- [ ] Task: Integrate SEO and structured data rendering
  - [ ] Render title/description and social metadata in SSR head output
  - [ ] Apply indexing and sitemap controls based on tenant opt-in settings
  - [ ] Enable/disable structured data output from tenant settings
- [ ] Task: Implement link list data APIs
  - [ ] CRUD and ordering for global footer links
  - [ ] CRUD and ordering for Members Hub links
- [ ] Task: Implement privacy policy APIs and state checks
  - [ ] Update tenant and platform privacy policies with `last_changed_at`
  - [ ] Record user acceptances and compute whether re-acceptance is required
- [ ] Task: Conductor - User Manual Verification 'Backend + Rendering Integration' (Protocol in workflow.md)

## Phase 3: Admin UI

- [ ] Task: Build tenant website settings UI sections
  - [ ] Add sections for branding, SEO, indexing, and structured-data controls
  - [ ] Add validation and inline error handling for form fields
- [ ] Task: Build branding uploader workflow
  - [ ] Add logo upload with crop/focal-point UI
  - [ ] Show current logo/favicon preview state
- [ ] Task: Build link management UI
  - [ ] Add global footer links editor using existing icon picker
  - [ ] Add Members Hub links editor using existing icon picker
  - [ ] Add reorder interactions for both lists
- [ ] Task: Build content editor UI
  - [ ] Add editors for Terms, Imprint, FAQ, and tenant Privacy Policy
  - [ ] Keep publish behavior immediate with save feedback
- [ ] Task: Build platform admin UI for global privacy policy
  - [ ] Restrict editing to platform-level admins only
- [ ] Task: Conductor - User Manual Verification 'Admin UI' (Protocol in workflow.md)

## Phase 4: User-Facing Integration + Consent Enforcement

- [ ] Task: Integrate link rendering in the live app
  - [ ] Render tenant footer links in the global site footer
  - [ ] Render secondary link list only inside the Members Hub
- [ ] Task: Implement privacy re-acceptance UX
  - [ ] Show persistent banner when tenant or platform policy re-acceptance is required
  - [ ] Ensure users can open/review policies and accept updates from the banner
- [ ] Task: Implement sensitive-action gating
  - [ ] Define and enforce sensitive actions blocked until required acceptances are completed
  - [ ] Keep non-sensitive navigation available while acceptance is pending
- [ ] Task: Conductor - User Manual Verification 'User-Facing Integration + Consent Enforcement' (Protocol in workflow.md)

## Phase 5: Validation, Docs, and Release Readiness

- [ ] Task: Add/extend Playwright e2e coverage
  - [ ] Cover tenant admin settings updates and rendered public output
  - [ ] Cover footer and Members Hub link visibility rules
  - [ ] Cover privacy-policy update and re-acceptance flows
- [ ] Task: Add/extend documentation tests and generated docs
  - [ ] Update feature docs/screenshots for settings and consent experiences
- [ ] Task: Run quality gates and finalize release notes
  - [ ] Run `yarn lint`
  - [ ] Run `yarn build`
  - [ ] Run `yarn e2e`
  - [ ] Run `yarn e2e:docs`
  - [ ] Add required Knope change file in `.changeset/*.md`
- [ ] Task: Conductor - User Manual Verification 'Validation, Docs, and Release Readiness' (Protocol in workflow.md)
