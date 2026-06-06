# Product Context

Evorto is a tenant-based event management platform for associations that organize recurring events. It started from ESN-style university sections where events were previously managed through offline coordination, spreadsheets, cash payments, and tacit organizer knowledge.

Evorto should reduce repetitive administrative work, preserve event knowledge across semesters, and make it practical for associations to run many events with changing volunteer teams.

## Product Goal

Evorto is intended to replace the current paid production version with a more flexible and better-modeled system.

The relaunch target is a full production replacement, not a prototype. Core workflows that exist in the current product should be available in the new implementation before rollout.

## Product Principles

- **Progressive disclosure over feature hiding**: common workflows should look simple even when the underlying model is more flexible.
  - Example: the default event setup UI can show "participant signup settings" and "organizer signup settings" while creating separate registration options internally.
- **Tenant-first**: associations/sections own their events, templates, roles, registrations, settings, branding, and configuration.
- **Role-based eligibility**: access to registration options should be modeled through tenant roles and capabilities, not scattered special-case flags.
- **Account-required registration**: anonymous users may browse eligible listed events, but registration requires an account.
- **Stripe is the payment source of truth**: local state may mirror payment details for app behavior, but payment lifecycle changes must respect Stripe state and webhooks.
- **Templates preserve organizational memory**: repeated events should be easy to recreate without losing reusable event knowledge.
- **No hidden deliverables**: a new user-facing feature or page is not complete if it can only be reached by typing a URL.
- **Documentation is part of the product**: essential flows should be documented for users and admins, preferably through Playwright-generated documentation.

## Tenants and Identity

Associations or sections are tenants.

Tenant-scoped data includes:

- roles and capabilities
- event templates
- events
- registration options
- registrations
- tenant settings
- branding
- legal/privacy configuration
- payment-related tenant configuration where applicable

Users are global and may belong to multiple tenants. A user should ideally have a home tenant so the app can warn when they are browsing a tenant that is not where they usually belong.

Tenants are resolved by domain. For relaunch, each tenant has one active primary domain. That domain may be an Evorto-provided subdomain or a manually configured custom domain, but automated custom-domain verification and multiple active domains per tenant are later tenant-onboarding work. If a domain does not match a tenant, fail closed or show a tenant-not-found state; do not guess a tenant.

## Personas

Evorto has configurable tenant roles, but the product should be understood through three main personas.

### Admins / board members

People with elevated access. Depending on the tenant, this may include board members, event managers, treasurers, reviewers, and tenant administrators.

They configure roles, permissions, tenant settings, templates, review/publishing behavior, legal pages, branding, payment settings, and financial workflows.

### Section members / organizers

People who create and organize events. They can prepare events, sign up as organizers/helpers, submit events for review, run events, check in participants, and submit receipts.

A tenant may model different organizer categories, such as main organizer and helper, through registration options.

### Participants

People who browse public/listed events, register, pay if required, attend events, transfer registrations where supported, and receive registration/check-in information.

## Core Workflows

The core product lifecycle is:

1. Create an event, usually from a template.
2. Configure participant and organizer signup settings.
3. Submit the event for review.
4. Publish the event through someone with the required capability.
5. Let eligible users register.
6. Collect payment through Stripe when required.
7. Run the event, including QR-code check-in.
8. Collect post-event data, including receipt submissions.
9. Review receipts and support reimbursements.
10. Preserve non-personal event records after the event is archived.

Other important workflows:

- browse listed events
- manage templates
- manage tenant roles and capabilities
- manage tenant branding/legal settings
- manage registrations and cancellations
- transfer/resell a registration
- use waitlists as lightweight demand indicators
- generate user/admin documentation from Playwright flows

## Event Lifecycle

Events should support this core lifecycle:

- `draft`
- `pending review`
- `published`

When an event is submitted for review, material fields should be locked. Material fields include dates/times, prices, capacity, registration options, and other fields that affect what users can sign up for or pay for.

Minor content edits may remain possible while an event is pending review, such as typo fixes in descriptions, but material changes should require returning the event to draft.

Publishing is the approval act. There is no separate "approved but not published" state for now.

Listing is separate from publishing. A published event may be:

- listed for participants
- listed for organizers
- listed for both
- unlisted for both, reachable only by direct link

Anonymous users may see events when those events have registration options available to roles that every new user receives by default in that tenant. Anonymous visibility should not show events that a user would lose access to immediately after signing in.

## Registration Model

Registration is one of the most important and complex parts of Evorto.

A sign-up event has registration options. Registration options can represent participant tickets, organizer/helper signup, ESN-card discounted access, or other tenant-defined categories. Operational or announcement-style events may have no internal registration options and may later link to an external signup.

Important rules:

- Registration options are mutually exclusive per event.
- A user cannot be both an organizer/helper and a participant for the same event.
- Registration requires an account.
- Guest spots are allowed as extra quantity attached to one logged-in buyer's registration.
- Guest spots do not need separate accounts or contact information in the first version.
- Check-in must account for guest quantities, including partial guest arrival.
- Registration options define role-based eligibility.
- Eligibility should be role-based for now.
- Special cases such as banned users, ESN-card-only access, and participation in another program should be modeled through roles and registration-option eligibility.

Registration should support:

- capacity limits
- registration start and end times
- free registrations
- paid registrations
- Stripe Checkout
- pending registration cleanup when checkout expires
- lightweight waitlists
- cancellation by participant
- cancellation by admin/organizer
- transfer/resale of a registration
- limits on how many events a person can register for in a configured time frame

## Discounts

Discounts belong to registration options.

For example, an ESN-card discount should not create a separate capacity pool unless explicitly designed that way. The discounted and regular price should usually draw from the same registration-option capacity.

ESN-card behavior should be opt-in because not every tenant is an ESN section.

## Waitlists

Waitlists should stay lightweight.

They are useful for:

- showing organizers demand for an event
- notifying interested users when capacity opens

They do not need to behave like a strict reservation queue. A simple model such as notifying the top people on the waitlist when a spot becomes available is acceptable.

Users should intentionally join a waitlist through a distinct action when an option is full. Do not silently add a user to a waitlist as a side effect of failed registration.

## Transfers and Resale

A participant should be able to transfer or resell a registration through Evorto.

The intended workflow:

1. Existing participant creates a transfer link or code.
2. New participant uses the link/code.
3. New participant completes their registration and payment.
4. Existing participant's registration is cancelled.
5. Existing participant receives a refund through Stripe.

The goal is to let users transfer spots without trusting each other directly.

## Templates

Templates are central to Evorto.

Most events repeat across semesters or are reused by different organizers. Templates should preserve reusable event knowledge so future organizers do not start from scratch.

Templates should include as much reusable information as practical, such as:

- title
- description
- location
- participant signup defaults
- organizer signup defaults
- registration options
- registration-option descriptions
- prices
- discounts
- capacity defaults
- role eligibility
- registration windows or offsets
- registration questions
- organizer notes or checklist-like internal information

An event instance is an editable copy of a template. The user should be able to change relevant details during event setup. Some duplication between templates and event instances is acceptable if it keeps event instances stable and understandable.

## Roles, Capabilities, and Eligibility

Tenants can define their own roles. There is no single system-defined default role.

Instead, roles can be marked as default by the tenant. Default roles are assigned to users by default in that tenant.

Permissions should be modeled as capabilities. Each capability should have:

- a stable internal key
- a friendly admin-facing name
- a short description
- dependency/implication notes where needed

The exact capability list may evolve with the product, but these areas are expected:

- create events
- submit events for review
- publish events
- manage event listing/visibility
- manage templates
- manage roles
- manage tenant settings
- manage registrations
- cancel registrations
- check in attendees
- review receipts
- manage financial/reimbursement workflows
- view unpublished or pending events where required by review/publishing duties

Capability dependencies matter. For example, a user who can publish events likely needs to see pending/unpublished events, including events created by other users.

Agents must not bypass capability checks or make authorization behavior more permissive for convenience.

## Payments

Stripe is the source of truth for payment state.

Evorto may duplicate relevant Stripe data locally for app behavior, reporting, and user experience, but agents should treat payment lifecycle logic, webhook handling, refunds, checkout expiry, and transfer/resale flows as high-risk areas.

Users should receive registration confirmation and QR code only after registration is successful. For paid events, that means after successful payment.

QR links behave like paper tickets: possession of the unguessable ticket URL is enough to render the QR image so it can be included in email. Check-in must validate registration status and show enough attendee identity for organizers to confirm the right person is presenting the ticket.

## Receipts and Reimbursements

Organizers may submit receipts for event-related spending before or after an event.

Receipts are used for later review and manual reimbursement tracking. The first version does not need sophisticated budget planning, receipt categories, or payout-provider integration unless a feature specifically requires them.

Receipt review should support email notification when a receipt is reviewed.

## Notifications

Email is the first notification channel.

In scope:

- successful registration confirmation, including QR code
- waitlist spot available
- event cancelled, when cancellation workflow exists
- registration cancelled by participant or admin
- transfer completed
- receipt reviewed

Not in scope for now:

- push notifications
- separate payment success/failure emails
- checkout expiry emails
- transfer-started emails
- receipt-submitted emails

## Tenant Customization

Tenants should be able to customize:

- domain
- logo
- favicon
- theme choice
- legal/imprint/privacy/terms links or text
- default roles
- available roles and capabilities
- review/publishing workflow settings
- registration limits
- enabled complexity where applicable
- email sender name, likely derived from tenant config

Stripe branding is handled in Stripe where possible.

Legal pages are tenant-specific plus platform-specific. Evorto should not provide fake fallback legal pages that pretend to cover a tenant's legal obligations. Exact legal fields and responsibility split need legal review before production rollout.

## Documentation Expectations

Essential product flows should be documented.

Generated documentation is product-facing. It should be grouped by feature area and should not mix in internal testing examples.

Important documentation areas include:

- browsing events
- registering for events
- transferring a registration
- creating an event from a template
- submitting an event for review
- publishing an event
- managing templates
- ESN-card discount behavior
- configuring roles and capabilities
- checking in participants
- submitting receipts
- reviewing receipts
- tenant branding/settings
- legal/privacy settings

Playwright-generated documentation is primarily user/admin product documentation. It also provides useful verification evidence for future agents.

## Out of Scope for Now

Avoid adding these without an explicit product decision:

- anonymous or guest registration without an account
- private invite-only events
- complex strict waitlist reservation queues
- automatic event archival
- push notifications
- sophisticated budgeting and receipt-category planning
- hard-coded ESN-only assumptions
- rigid requirements/test ID matrices

## Design Watchpoints

### Permission dependencies

Current default: permissions are capabilities with admin-facing names and descriptions. Some capabilities imply access to related data.

Raise this when: changing authorization, event review, publishing, registration management, tenant settings, or role configuration.

Do not: make authorization more permissive to unblock a UI flow.

### Event archival

Current default: build the data model so archived event records can retain non-personal event history while removing user personal data where possible.

Raise this when: changing event, registration, payment, receipt, or check-in persistence.

Do not: add automatic archival behavior without an explicit product decision.

### Legal pages

Current default: tenants provide tenant-specific legal/privacy/imprint/terms information, possibly alongside platform-provided sections.

Raise this when: changing tenant onboarding, legal page rendering, domains, privacy copy, or production readiness.

Do not: invent generic legal fallback text and treat it as production-ready.

### Registration complexity

Current default: simple UI first, flexible registration-option model underneath.

Raise this when: adding new registration modes, discounts, eligibility logic, capacity handling, guest quantities, or waitlist behavior.

Do not: add one-off flags when the concept can be modeled through roles, capabilities, or registration options.
