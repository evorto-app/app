# Feature Specification: Tenant‑wide Discount Enablement with ESNcard (v1)

**Feature Branch**: `003-discount-cards-expand`  
**Created**: 2025-09-16  
**Status**: Draft  
**Input**: User description: "Discount cards

Expand Evorto with a tenant-wide Discount Enablement feature that standardizes how price reductions are defined, activated, and applied across registrations. The aim is to support multiple discount providers through a shared contract while delivering ESNcard handling as the first concrete implementation. Admins
must be able to toggle a provider on or off for their tenant, that decision must flow through all user journeys, and participants should automatically receive the best eligible price when they register.

Establish a discount provider catalog that declares each provider’s type identifier, display name, description. The status of which providers are enabled should be in the tenant config. It is fine if the different providers are hard coded as admins can only enable them and not create new ones. Start with a single provider config for the ESNcard, but structure the data so that future providers can be added to the code.
Give tenant admins a single control surface to manage provider availability. When an admin enables or disables a provider, the selection must immediately impact the whole product: user profile screens, event editors, registration flows, and any warnings should respect the toggle. Disabled providers should
disappear from participant-facing flows and be blocked from accepting new card numbers until re-enabled.
Allow authenticated users to manage their own discount credentials per provider: add a card, view stored details, or delete it. Enforce uniqueness so a card number cannot be reused by another account, capture verification status (unverified, verified, expired, invalid), track last-checked
timestamps, validity windows, and raw metadata for diagnostics, and surface actionable error messages whenever validation fails.
Integrate discounts into event pricing. Event organizers must be able to attach provider-specific discounted prices to each registration option (and duplicate those definitions automatically when generating events from templates). During registration the system should gather the participant’s verified cards,
filter them by providers that are enabled for the tenant and valid through the event start, pick the lowest eligible discounted price, and if the discount drives the amount to zero treat the registration as fully confirmed without payment. Participants whose cards expire before the event should see a clear
warning while browsing the event.
Deliver the ESNcard provider end to end. Validate card identifiers against the esncard.org service, interpret an “active” response as verified, map the reported expiration date into the stored validity window, and mark any other status as invalid or expired. Keep enough metadata to troubleshoot verification
issues. Educate users about ESNcard eligibility and provide a “get your card” call to action whenever the tenant has the provider enabled but the user does not yet have a verified card.
Try to not blow up the data model if possible. (See <attachments> above for file contents. You may not need to search or read the file again.)"

## Execution Flow (main)
```
1. Parse user description from Input
	→ If empty: ERROR "No feature description provided"
2. Extract key concepts from description
	→ Identify: actors, actions, data, constraints
3. For each unclear aspect:
	→ Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
	→ If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
	→ Each requirement must be testable
	→ Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
	→ If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
	→ If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- Mandatory sections: Must be completed for every feature
- Optional sections: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. Mark all ambiguities: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. Don't guess: If the prompt doesn't specify something, mark it
3. Think like a tester: Every vague requirement should fail the "testable and unambiguous" checklist item
4. Common underspecified areas:
	- User types and permissions
	- Data retention/deletion policies
	- Performance targets and scale
	- Error handling behaviors
	- Integration requirements
	- Security/compliance needs

---

## User Scenarios & Testing (mandatory)

### Primary User Story
As a tenant admin, I want to enable or disable discount providers for my tenant so that participants automatically receive the best eligible discounted price during registration, and providers that are disabled are fully hidden and inactive in participant flows.

As an authenticated participant, I want to save and verify my discount card(s) per provider so that my eligible discounts are applied automatically to event registrations, including zero-priced outcomes where appropriate.

As an event organizer, I want to define provider‑specific discounted prices on registration options so that participants with valid, verified credentials see the correct lowest price and free registrations are auto‑confirmed.

### Acceptance Scenarios
1. Given a tenant has ESNcard provider enabled, When a participant with an active, verified ESNcard views an event, Then eligible discounted prices are shown and the lowest price is preselected during registration.
2. Given ESNcard is disabled by a tenant admin, When participants browse profile, events, or registration, Then ESNcard fields, warnings, and prices are hidden and new ESNcard numbers cannot be added.
3. Given a participant has multiple verified discount credentials (future providers), When registering, Then the system selects the lowest eligible discounted price among enabled providers.
4. Given a discounted price reduces the total to zero, When a participant completes registration, Then the system follows the exact same process as a free event registration (no payment collection, same confirmation flow, states, notifications, capacity and waitlist handling) and the registration is marked as fully confirmed.
5. Given a participant’s ESNcard will expire before the event start, When they browse the event, Then they see a clear warning that the card will be expired for this event and discount will not apply; if the card is valid on the event start date itself, the discount remains eligible.
6. Given an admin toggles ESNcard from enabled to disabled, When a participant attempts to add a new ESNcard number, Then the action is blocked with a message indicating the provider is disabled by the tenant.
7. Given a participant attempts to add an ESNcard number already used by another account, When saving, Then the system rejects it with an error that the card number is already in use.
8. Given a participant adds a new ESNcard number, When the system validates with the ESNcard service and receives an "active" status, Then the credential is marked Verified and its validity window is set from the reported expiration date; otherwise it is marked Invalid or Expired with details.
9. Given an event is created from a template that includes provider‑specific discounted prices, When the event is being created, Then the member creating the event can see all provider‑specific discount options for each registration option on the creation screen (based on the template and tenant‑enabled providers), decide to keep or change them, and upon creation the final discounted price definitions are duplicated to the new event’s registration options.
10. Given ESNcard is enabled and a participant has no verified ESNcard, When they view the discount area, Then they see educational guidance on eligibility and a "Get your ESNcard" call to action.
11. Given a credential is deleted by the user, When they view future registrations, Then discounts based solely on that credential no longer apply.
12. Given tenant enablement changes while a user is mid‑registration, When the user proceeds to payment/confirmation, Then pricing recalculates according to the latest enablement and eligibility before finalization, with a clear message if the price changed.
13. Given an organizer views the event’s participant/user list, When registrations include discounts, Then each registration row indicates whether a discount was used and shows the discount amount (difference between base price and discounted price).

### Edge Cases
- Duplicate card entry attempts across different accounts → must be prevented platform‑wide with clear messaging.
- ESNcard expiring exactly on the event start date → still eligible for discount on that date.
- Provider toggled off between browsing and checkout → price must re‑evaluate; show delta if changed at confirmation.
- Validation service outage or timeout → inform the user the service is currently unavailable and suggest trying again later; do not auto‑retry.
- Multiple providers yield identical lowest price → prefer non‑discounted/base price if present; otherwise select by discount provider type identifier in ascending alphabetical order.
- Organizer defines a discounted price higher than the base price → validation must fail and block saving with a clear error.
- Free registration capacity handling when discount yields zero → apply the same capacity, reservation, and waitlist rules as for free event registrations.

## Requirements (mandatory)

### Functional Requirements
- FR‑001: The system MUST provide a discount provider catalog containing each provider’s type identifier, display name, and description; the catalog MAY be hard‑coded.
- FR‑002: The set of enabled providers for a tenant MUST be stored in tenant configuration and be changeable by tenant admins.
- FR‑003: Tenant admins MUST have a single control surface to enable/disable providers; other clients MAY require a reload to see changes. Business rules during registration MUST always use the current configuration at the time of checkout.
- FR‑004: When a provider is disabled, participant‑facing flows MUST hide all mentions of that provider, and the system MUST block new credential submissions for that provider until re‑enabled. Existing stored credentials MAY remain in the user’s account but MUST be ignored for eligibility.
- FR‑005: Authenticated users MUST be able to add, view, and delete their discount credentials per provider.
- FR‑006: The system MUST enforce uniqueness so a credential identifier (e.g., ESNcard number) cannot be used by more than one account across the entire platform (platform‑wide uniqueness).
- FR‑007: For each credential, the system MUST capture: identifier, verification status (Unverified, Verified, Expired, Invalid), last‑checked timestamp, validity window (start/end if available), and raw metadata sufficient for diagnostics, plus an error message when validation fails.
- FR‑008: The system MUST validate ESNcard credentials against the ESNcard service; interpret "active" as Verified; map the reported expiration date to the credential’s validity window; treat other statuses as Invalid or Expired as appropriate; and retain metadata for troubleshooting.
- FR‑009: If a tenant has ESNcard enabled and a user lacks a Verified ESNcard, the system MUST present educational guidance about ESNcard eligibility and a prominent "Get your ESNcard" call to action; tenant admins MUST be able to disable this CTA.
- FR‑010: Event organizers MUST be able to attach provider‑specific discounted prices to each registration option.
- FR‑011: When generating an event from a template, provider‑specific discounted price definitions MUST be duplicated to the new event’s corresponding registration options.
- FR‑012: During registration, the system MUST gather the participant’s Verified credentials, filter by providers that are enabled for the tenant and valid through the event start, and select the lowest eligible discounted price.
- FR‑013: If the selected discounted price reduces the amount to zero, the system MUST follow the same process as a free event registration: no payment collection, same confirmation flow, participant states, notifications, and identical capacity/waitlist handling.
- FR‑014: Participants whose credential(s) will be invalid for the event (e.g., expire before event start) MUST see a clear warning while browsing the event.
- FR‑015: On validation failures, the system MUST surface actionable error messages (e.g., "Card not found", "Card expired", "Provider temporarily unavailable; please retry").
- FR‑016: Administrative actions (provider enable/disable) and credential verification changes MUST be auditable with timestamps, actor (where applicable), and an objectId; audit logs MUST be retained indefinitely until further notice.
- FR‑017: The system MUST handle provider service unavailability gracefully (do not block unrelated flows); on failure to validate, inform the user the service is unavailable and that they should try again later; the system does not automatically retry.
- FR‑018: Access control MUST ensure only tenant admins manage provider enablement and that users can manage only their own credentials; organizer pricing capabilities MUST follow existing role permissions; a dedicated "discount management" permission MAY be introduced.
- FR‑019: Pricing validation MUST prevent discounted prices that exceed the base price; all prices are tax‑inclusive on the platform (disregard tax calculations); invalid configurations MUST be rejected with clear guidance.
- FR‑020: The feature SHOULD minimize data model changes and prefer reuse of existing structures; specific entities and relationships will be identified during research and planning.

- FR‑021: If multiple eligible prices are tied for the lowest amount, the system MUST prefer a non‑discounted/base price; if none, select by discount provider type identifier in ascending alphabetical order.
- FR‑022: A credential that is valid on the event start date MUST be considered eligible for discounts for that event.
- FR‑023: During event creation, the member creating the event MUST be able to view, keep, or change provider‑specific discounted prices for each registration option; defaults come from the template (where applicable) and tenant‑enabled providers.
- FR‑024: Event participant/user lists MUST indicate whether a discount was used for each registration and display the discount amount (base price minus discounted price).
- FR‑025: When the validation service does not respond or times out, the system MUST inform the user that validation is currently unavailable and suggest trying again later; no automatic retries are performed.
- FR‑026: The system MUST reject any discounted price configuration that results in a price higher than the base price.

### Key Entities
- Discount Provider (Catalog Entry): Describes a provider available in the product, including type identifier (stable key), display name, and description. Initial scope includes ESNcard; the catalog is fixed (admins toggle availability; they do not create providers).
- Tenant Discount Settings: Captures which providers are enabled for a given tenant; changes are immediate and affect all user journeys.
- Discount Credential (User‑Provider Credential): A user‑owned record containing the provider type, credential identifier (e.g., card number), verification status, validity window, last‑checked timestamp, and diagnostic metadata; enforces platform‑wide uniqueness of identifier usage.
- Discounted Price (Registration Option Modifier): For each registration option, an optional set of provider‑specific prices that define the amount a participant pays when eligible under that provider; duplicated from templates when generating events.
- Registration Discount Summary (Registration Attribute): For each registration, a stored record of the applied pricing context including base price, applied provider (if any), discounted price, and discount amount; supports participant list displays and reporting.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non‑technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous where specified
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

### Testability & Validation Surface
- [x] Primary user journey can be validated via E2E tests
- [x] Non‑functional constraints (auth/roles, reliability of external validation) are captured for E2E consideration
- [x] Documentation test journey is feasible for `.doc.ts` (admin toggling, user adding card, registration with discount)
- [x] Expected documentation outputs identified (user education and admin control surfaces)
- [x] PR preview assets (screenshots or rendered markdown snippets) can be produced from documentation tests

### Design System Alignment (if UI involved)
- [x] Material‑style control surfaces (toggles, list‑detail) implied; specifics to be defined in design
- [x] Accessibility, responsive behavior, and clear warnings are required

### Legacy Data Migration (if applicable)
- [x] Data mapping rules: reuse existing entities where possible and add minimal fields
- [x] Defaults/backfills for new fields identified conceptually (credentials start Unverified)
- [x] Seed data limited to provider catalog entries
- [x] Migration work minimized; final migration occurs at cut‑over

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
*Based on Constitution 1.1.3*

