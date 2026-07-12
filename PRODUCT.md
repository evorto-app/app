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
- **Paid event activity is Stripe-only**: event registrations and add-ons may
  charge money only through the tenant's connected Stripe account. Without
  Stripe, every registration option and add-on must be free.
- **A transfer preserves one inseparable bundle**: the registration and every
  included, free, and purchased add-on move together with their quantities and
  fulfillment history. Registration guest quantities and check-in history are
  part of that same bundle. A recipient cannot omit, replace, or re-quantity its
  contents.
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

Users are global and may belong to multiple tenants. For relaunch, every user
has one home tenant and the app warns when they are browsing another tenant.
The first tenant a user joins after completing the required onboarding becomes
their home tenant. Joining another tenant must not silently replace it; a user
may change it later through an explicit profile action.

When an authenticated user reaches a tenant they have not joined, the app adds
them to that tenant automatically only after they accept the tenant's current
privacy policy and answer every required tenant-wide onboarding question.
Those acceptances and answers are tenant-scoped records, not merely client-side
form state. Every tenant privacy-policy change requires a new acceptance; the
tenant administrator making that change must be told that users will need to
re-accept it. Required onboarding questions support short text and selection
from a list. The application checks those requirements for every authenticated
tenant user and immediately requires completion when an answer or the current
policy acceptance is missing.

Communication email is user-managed and may differ from the Auth0 login email.
It is the address used for product notifications across the user's tenants.

Tenants are resolved by domain. For relaunch, each tenant has one active primary
domain. Production email and Stripe return origins use HTTPS and are derived
from the normalized primary domain. Local development uses an explicitly
configured loopback runtime origin instead; outbound URLs must never be derived
from a caller-controlled request header. Only a platform administrator may
change the saved tenant host. If a domain does not match a tenant, fail closed
or show a tenant-not-found state; do not guess a tenant.

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

### Platform administrators

Platform administrators are platform principals, not tenant roles. They may
perform any platform operation for any tenant at any time without a tenant
membership. Their access must remain explicit and auditable; it must not depend
on silently pretending to be a tenant user.

Each platform operation names its target tenant explicitly. Every platform
mutation requires an operational reason and records the Auth0 platform actor,
target tenant, action, timestamp, and typed before/after state in the same
transaction as the domain change. A platform-created event must name an active
target-tenant member as its attributed owner; that attribution does not turn
the platform actor into a tenant user.

Platform authority does not replace participant identity. Participant profile
and home views, joining or leaving a tenant, submitting personal receipts, and
self-service registration transfer or resale remain participant-owned flows.
Platform tools may operate on target-tenant records only through dedicated
target-scoped contracts; they must never merge tenant-role permissions into the
platform principal.

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

Review permission alone lets a reviewer approve or return an event to draft
with feedback. Rejection is not a separate durable event state. Review
permission does not grant event-edit permission; a reviewer may edit an event
only when they also have the relevant event-edit capability or are otherwise
authorized as its editor.

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

First-come-first-served and manual-approval (`application`) are supported
relaunch registration modes. A manual approval remains pending until an
authorized organizer approves it; a paid approval then follows the normal
Stripe Checkout lifecycle. `random` registration is not a supported relaunch
mode and must not appear as a usable stored-only configuration.

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
- Organizer/helper signup uses distinct copy and grouping from participant
  tickets, even though both use the same registration-option model.
- A role-ineligible user who follows a direct event link sees an explicit
  ineligible state and no registration action rather than a misleading empty
  registration area.
- A tenant without a connected Stripe account may configure and run only free
  registration options and free add-ons. Cash, bank-transfer, or other manual
  event-payment records are not supported payment paths.

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

Cancellation and transfer timing are tenant configuration defaults. Whether
payment fees are refunded applies to ordinary cancellation only; transfer
refunds return the source participant's exact original Stripe payments. A
registration option may explicitly override timing and cancellation-fee
defaults. New tenants seed transfer until the event starts, cancellation until
five days before the event, and cancellation fee refund enabled.

### Simple and advanced registration configuration

Simple configuration is the default for both templates and events. It presents
one organizing and one non-organizing registration option while retaining the
same flexible underlying option model. Advanced configuration presents an
individually named list of any number of registration options, including
multiple organizer/helper categories.

Templates and event instances each own their configuration mode. An event
starts as a snapshot of its template's mode and options, then remains
independently editable; later template edits never rewrite an existing event.
Moving from simple to advanced preserves the current options. Every mode change
requires an explicit warning/confirmation. Moving from advanced to simple is
allowed only after the user has saved the advanced configuration with exactly
one organizing and one non-organizing option; the mode change is a separate
save and never silently replaces option IDs. Advanced setup warns when either
category is missing but does not block saving or publishing: operational events
without registrations remain valid.

Registration questions attach to one concrete registration option. In advanced
configuration, a shared question is represented by deliberate copies rather
than an implicit organizer/participant shortcut.

### Add-ons and fulfillment

Add-ons are advanced registration-option configuration and are hidden from the
default editor. An organizer enables them for a registration option, then
associates add-ons through an explicit multi-selection. One reusable add-on may
be attached to more than one registration option.

Each add-on association separately records an included quantity and an optional
purchase quantity. Included units are granted automatically, cannot be removed
by the registrant, are priced into the registration option, and reserve their
stock when the registration becomes effective. Optional units remain a separate
purchase choice, so an option may include one shirt while still allowing extra
shirts to be bought. A free optional add-on is not the same thing as an
included add-on.

Every add-on is redeemable from a scanned registration. The organizer scan view
shows the registration's add-on overview, supports one-click quantity
redemption, and allows an immediate undo. This supports included checklist
items, such as a photo-release acknowledgement task, as well as physical items
such as shirts and purchased consumables such as drinks. A checklist item is a
fulfillment record, not a substitute for any separately required versioned
legal-consent record.

Stock remains editable for future registrations without rewriting settled
entitlements. A user with the separate cancellation capability may cancel
unredeemed add-on units with or without a refund; redeemed units stay part of
the fulfillment record. Refunds apply only to the optional purchased portion,
not to included units.

For transfer or resale, the registration and all of its add-on entitlements are
one fixed bundle. Included, free optional, and purchased quantities, together
with redemption, cancellation, and undo history, transfer unchanged. The
recipient reviews that bundle but cannot remove an add-on or change its settled
quantity as part of claiming the transfer. Registration guest quantity and
check-in history are preserved too.

Guests remain a dedicated registration feature rather than ordinary stock
add-ons. They consume the selected option's capacity, use that option's guest
price rule, and support partial guest check-in. They may share low-level
fulfillment conventions, but must not gain independent add-on stock or purchase
windows.

## Discounts

Discounts belong to registration options.

For example, an ESN-card discount should not create a separate capacity pool unless explicitly designed that way. The discounted and regular price should usually draw from the same registration-option capacity.

ESN-card behavior should be opt-in because not every tenant is an ESN section.
An ESNcard identity belongs to the global user, while each tenant decides
whether its own ESNcard program is enabled. An enabled program requires live
external active-card add, refresh, and remove verification plus a permanently
expired-card state check; it is not a credential-gated deferred integration.

During transfer, source-user discounts do not transfer. Evorto recalculates the
fixed bundle from its current base prices, then applies only discounts for which
the recipient is currently eligible.

## Waitlists

Waitlists should stay lightweight.

They are useful for:

- showing organizers demand for an event
- notifying interested users when capacity opens

They do not behave like a reservation queue. Waitlist messages are informative
only: receiving one never reserves capacity, creates a checkout hold, or
guarantees a place.

Users should intentionally join a waitlist through a distinct action when an option is full. Do not silently add a user to a waitlist as a side effect of failed registration.

## Transfers and Resale

A participant must be able to transfer or resell a registration through Evorto.
This is a production-replacement requirement for paid events, not an optional
post-launch enhancement.

The intended workflow:

1. Existing participant creates a transfer link or code.
2. New participant signs in and uses the link/code.
3. Evorto shows the registration plus every included, free, and purchased
   add-on as one fixed bundle. The recipient cannot omit add-ons, change guest
   count, or alter any quantity or fulfillment/check-in history.
4. Evorto rechecks the recipient's current eligibility and questions, prices
   the fixed bundle from current base prices, and then applies the recipient's
   current eligible discounts. The source participant's discounts never carry
   over.
5. The recipient's payment is calculated independently from the source refund.
   A transfer is database-only only when the entire bundle is free and no source
   refund is required; every other supported transfer uses Stripe.
6. After the recipient flow succeeds, the existing registration remains
   confirmed under the recipient's ownership with its identity, all bundle
   quantities, and fulfillment/check-in history unchanged.
7. The source participant no longer owns the registration and receives exact
   refunds for the original Stripe registration and purchased-add-on payments.

The goal is to let users transfer spots without trusting each other directly.

New payments for a tenant use its currently configured Stripe Connect account.
Every refund uses the persisted owning Connect account of its original Stripe
payment, even if the tenant rotated accounts afterward. The application submits
that payment-owning account with each Stripe request and adds only the platform
application fee; all other payment and cancellation configuration belongs to
the tenant, subject to the registration-option override rules. The ordinary
cancellation fee policy does not reduce a transfer refund: each source
registration or add-on payment is refunded until its total refunds equal the
exact original Stripe amount.

## Check-in

Confirmed organizers/helpers and users with the tenant-wide event-organizing
capability may check attendees in. Check-in opens during a pre-start window
appropriate for entrance logistics. Duplicate scans succeed with an explicit
“already checked in” result, and organizers can check in a buyer and selected
guest quantity separately so partial arrival is supported.

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

An event instance is an editable snapshot of a template. The user should be able
to change relevant details during event setup, and later template edits must not
retroactively alter existing events. Some duplication between templates and
event instances is acceptable if it keeps event instances stable and
understandable.

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
- cancel registrations and add-on units unilaterally, with or without a refund
- check in attendees
- review receipts
- manage financial/reimbursement workflows
- view unpublished or pending events where required by review/publishing duties

Role and user management are essential tenant-admin workflows. Authorized
administrators can assign and remove existing users' roles in the current
tenant without changing the role definitions themselves. The
`users:assignRoles` capability deliberately grants unrestricted assignment of
any existing tenant role, including self-assignment, and must therefore be
treated as full tenant-administrator authority rather than limited delegation.
Tenant roles never grant platform-global permissions; those belong only to an
explicit platform principal.

Capability dependencies matter. For example, a user who can publish events likely needs to see pending/unpublished events, including events created by other users.

Dependencies are resolved with the same semantics in the client and server.
The server remains the authorization source of truth. Template-category
management and least-privilege organizer role lookup remain distinct from
general template editing and role administration.

Agents must not bypass capability checks or make authorization behavior more permissive for convenience.

## Payments

Stripe is the source of truth for payment state.

Stripe is also the only supported payment rail for event registrations and
add-ons. If a tenant has no connected Stripe account, its event registration
options and add-ons must be free. Do not introduce cash, bank-transfer, or
manually settled paid-event paths; manual finance records for other workflows
must not be presented as event-payment support.

Evorto may duplicate relevant Stripe data locally for app behavior, reporting, and user experience, but agents should treat payment lifecycle logic, webhook handling, refunds, checkout expiry, and transfer/resale flows as high-risk areas.

Each tenant owns its payments through its configured Stripe Connect account.
Checkout, customer, payment-intent, expiry, and refund calls must execute for
that connected account. Evorto adds its application fee but does not own or
silently replace the tenant's other payment configuration.

Users should receive registration confirmation and an authenticated link to
their ticket only after registration is successful. For paid events, that means
after successful payment.

Rendering a ticket QR requires the confirmed registration owner or an
authorized organizer to be signed in. The QR may encode the registration id as
an opaque locator, but that id is never a bearer credential: the scanner still
requires tenant-scoped organizer authorization and validates the registration
status before check-in.

## Receipts and Reimbursements

Organizers may submit receipts for event-related spending before or after an event.

Receipts are used for later review and manual reimbursement tracking. The first version does not need sophisticated budget planning, receipt categories, or payout-provider integration unless a feature specifically requires them.

Receipt review should support email notification when a receipt is reviewed.

## Notifications

Email is the first notification channel.

Customer-facing email templates are rendered with React Email. Rendering stays
separate from transactional delivery: templates enter the durable outbox and
retain its recipient, idempotency, retry, and failure-observability rules.

After automatic delivery exhausts its retry budget, the outbox row remains
stored and read-only for operational evidence. No exhausted-email recovery
action is required for the current product scope.

In scope:

- successful registration confirmation with an authenticated ticket link
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

## Required Production Integrations

Google Maps location search and place details are required production
functionality. Production readiness therefore requires approved configuration,
live provider verification, and fail-visible empty/error behavior.

Cloudflare Images is being removed. It is not supported production scope and is
not a release gate; removal work must not be replaced with new Cloudflare Images
test obligations.

## Tenant Customization

Tenants should be able to customize:

- primary domain
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
- Stripe Connect account and tenant payment/cancellation defaults

Evorto uses the fixed `de-DE` formatting locale for all tenants. This affects
date, number, and money formatting only; the interface, emails, generated
documentation, and tenant-authored content remain English-only.

Supported tenant currencies are `EUR`, `CZK`, and `AUD`. The business timezone
is an IANA timezone name and defaults to `Europe/Berlin`. Currency is the
default for newly configured event/finance flows, while recorded monetary
amounts keep their recorded currency. Timezone governs event scheduling,
registration and check-in windows, and tenant-facing date/time display. Both
must be applied consistently in SSR and browser rendering. A tenant
administrator cannot change either after event or payment data exists; a
platform-administrator override must be explicit and auditable. Because event
and template prices are stored as minor units under the tenant currency, an
in-place platform currency override is rejected once template, event, receipt,
or transaction data exists until a dedicated currency migration workflow is
available.

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
