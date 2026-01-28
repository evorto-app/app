# Spec: ESNcard Discounts + Validation (Finish & Align)

## Overview

Enable an optional ESNcard integration for ESN sections that validates card numbers via an external service, stores expiry, and allows ESNcard-specific pricing on event registrations. The feature must be entirely hidden when disabled, keep data structures simple, and record when a discount was applied for scanning/verification workflows.

## Functional Requirements

### Feature Toggle (Section-Level)

- ESNcard support is controlled by a section-level toggle (default off).
- When disabled, there is no ESNcard UI visible anywhere.

### Admin Configuration

- Admins can set an optional “Buy ESNcard” link.
- The link is only visible to users when ESNcard is enabled and they do not have a valid card.

### User Profile

- Users can add an ESNcard number to their profile.
- Card is validated on save via the external ESN service.
- Persist the card number and its expiry date (no re-validation needed unless changed).

### Event Pricing

- Any user who can edit an event can set ESNcard-specific prices for registration options (when the feature is enabled).
- ESNcard prices are optional; events may have no ESNcard pricing even if the feature is enabled.
- ESNcard price is only available to users with a valid card at the event start date.

### Registration & Scanning

- During registration, the user is presented with the lowest available price.
- If the lowest price is discounted due to ESNcard, the user must be informed that a discount is applied.
- When a registration uses the ESNcard price, this must be recorded on the registration.
- Event organizers must see that an ESNcard discount was applied when scanning the ticket (to optionally verify the physical card).

### Integration Design

- ESNcard integration should be structured so additional future integrations can be added with minimal work.
- Avoid a fully generic discount management system.

## Non-Functional Requirements

- Keep data structures minimal and easy to reason about.
- Maintain readability and document the integration module.
- Preserve type safety end-to-end.
- Record the intent of this integration in root-level feature folders (especially server-side).

## Implementation Notes

- Most functionality already exists; it may be reworked or replaced.
- Breaking changes are acceptable pre-release.
- It’s OK to change existing code, flows, and concepts to reach the desired outcome.

## Acceptance Criteria

- Admin can enable/disable ESNcard integration at section level.
- When disabled, ESNcard-related UI and flows are completely hidden.
- User can add ESNcard number; it is validated on save and expiry is stored.
- Event editors can set optional ESNcard prices per registration option.
- User with a valid ESNcard sees the lowest price and is informed if it’s discounted.
- User without a valid ESNcard does not see ESNcard pricing.
- Registrations using ESNcard pricing are marked and visible during ticket scanning.
- “Buy ESNcard” CTA appears only when feature enabled and user lacks a valid card.

## Out of Scope

- Generic discount engine or multi-discount stacking.
- Automatic re-validation of stored ESNcards beyond save-time.
- ESNcard features when the toggle is off.
