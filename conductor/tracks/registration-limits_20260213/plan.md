# Implementation Plan

## Phase 1: Data Modeling + Rules Definition

- [ ] Task: Design schema updates for registration option deregistration settings
  - [ ] Add relative deregistration-close rule fields to template registration options
  - [ ] Add absolute deregistration-close timestamp fields to event registration options
  - [ ] Define materialization/update logic from template-relative to event-absolute values
- [ ] Task: Design schema updates for paid-option fee-refund toggle
  - [ ] Add paid-option refund-fees-on-deregistration flag
  - [ ] Define free-option behavior (hidden/ignored at validation level)
- [ ] Task: Design tenant registration-limit settings schema
  - [ ] Add daily-limit enable toggle and cap
  - [ ] Add weekly-limit enable toggle and cap
  - [ ] Add optional free/paid override fields for both daily and weekly windows
  - [ ] Add include-organizing-registrations toggle
- [ ] Task: Define counting/enforcement semantics and boundary rules
  - [ ] Confirm confirmed-status-only counting set
  - [ ] Define day/week window boundary strategy and timezone source
  - [ ] Define precedence when both base and free/paid overrides exist
- [ ] Task: Plan e2e/doc test coverage mapping
  - [ ] Map deregistration cutoff journeys
  - [ ] Map fee-refund toggle journeys
  - [ ] Map registration-blocking message journeys for daily/weekly limits
- [ ] Task: Conductor - User Manual Verification 'Data Modeling + Rules Definition' (Protocol in workflow.md)

## Phase 2: Backend Implementation (Settings + Enforcement)

- [ ] Task: Implement template/event deregistration cutoff backend logic
  - [ ] Persist template-relative cutoff settings
  - [ ] Materialize event-absolute cutoff values
  - [ ] Enforce cutoff in deregistration APIs
- [ ] Task: Implement fee-refund toggle backend behavior
  - [ ] Add typed schemas for toggle input/output
  - [ ] Apply full-refund-vs-fee-excluded behavior in deregistration refund path
- [ ] Task: Implement tenant registration-limit settings APIs
  - [ ] Add typed CRUD for daily/weekly/base/override toggles and caps
  - [ ] Add permission checks and tenant isolation
- [ ] Task: Implement registration eligibility service
  - [ ] Count confirmed registrations per user/tenant in daily and weekly windows
  - [ ] Apply include-organizing toggle
  - [ ] Apply base caps and optional free/paid stricter overrides
  - [ ] Return machine-readable block reason and next eligible context
- [ ] Task: Enforce limits server-side on registration attempts
  - [ ] Validate eligibility at submit time
  - [ ] Return blocking response compatible with UI messaging
- [ ] Task: Conductor - User Manual Verification 'Backend Implementation (Settings + Enforcement)' (Protocol in workflow.md)

## Phase 3: Admin UI (Event/Template + Tenant Settings)

- [ ] Task: Add deregistration close controls to template registration option UI
  - [ ] Implement relative timing input consistent with existing timing patterns
  - [ ] Persist and validate values
- [ ] Task: Add event registration option visibility for absolute cutoff
  - [ ] Show computed/stored absolute cutoff in event context
  - [ ] Keep edit behavior aligned with template-driven model
- [ ] Task: Add paid-option fee-refund toggle in admin UI
  - [ ] Show toggle for paid options only
  - [ ] Persist setting and reflect current state
- [ ] Task: Add tenant-wide registration limit settings UI
  - [ ] Daily/weekly enable toggles and caps
  - [ ] Optional free/paid override controls
  - [ ] Include-organizing-registrations toggle
  - [ ] Active-rules summary for admins
- [ ] Task: Conductor - User Manual Verification 'Admin UI (Event/Template + Tenant Settings)' (Protocol in workflow.md)

## Phase 4: User-Facing Enforcement UX

- [ ] Task: Integrate registration option eligibility checks into registration UI
  - [ ] Hide registration CTA when blocked by active limits
  - [ ] Show explanatory message instead of CTA
  - [ ] Display next eligible context when available
- [ ] Task: Integrate dual-limit enforcement behavior
  - [ ] Ensure both daily and weekly limits must pass when both enabled
  - [ ] Ensure message reflects the limiting rule(s)
- [ ] Task: Integrate deregistration cutoff UX
  - [ ] Prevent deregistration after cutoff in UI and backend
  - [ ] Show clear cutoff-expired feedback
- [ ] Task: Conductor - User Manual Verification 'User-Facing Enforcement UX' (Protocol in workflow.md)

## Phase 5: Verification, Docs, and Release Readiness

- [ ] Task: Add/extend Playwright e2e coverage
  - [ ] Cover template-relative to event-absolute cutoff behavior
  - [ ] Cover paid fee-refund toggle effects in deregistration
  - [ ] Cover daily/weekly/base/override limit enforcement and messaging
  - [ ] Cover include-organizing-registrations toggle impact
- [ ] Task: Add/extend documentation tests and generated docs
  - [ ] Update user-facing docs/screenshots for admin settings and blocked registration UX
- [ ] Task: Run quality gates
  - [ ] Run `yarn lint`
  - [ ] Run `yarn build`
  - [ ] Run `yarn e2e`
  - [ ] Run `yarn e2e:docs`
- [ ] Task: Prepare release note artifacts
  - [ ] Add required Knope change file in `.changeset/*.md`
- [ ] Task: Conductor - User Manual Verification 'Verification, Docs, and Release Readiness' (Protocol in workflow.md)
