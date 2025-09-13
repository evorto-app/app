# Contracts Placeholder

For this planning phase, high-level action contracts map to user journeys. Detailed API contract generation (tRPC procedures) will be validated via E2E; explicit REST/OpenAPI specs deferred because feature focuses on test baseline, not new public API surface.

## Journey → Contract Mapping (High-Level)
- Account Creation: POST /auth/signup (existing provider) + POST /profile/onboarding
- Template Management: POST /templates, GET /templates/:id
- Template Category: POST /template-categories, PATCH /template-categories/:id
- Event Creation: POST /events (from templateId)
- Event Listing: GET /events?visibility=LISTED
- Registration Free: POST /events/:id/registrations
- Registration Paid (Deferred test) : POST /events/:id/registrations (pricingType=PAID) + POST /payments/simulate (future)
- Roles & Permissions: POST /roles, PATCH /roles/:id/permissions, POST /roles/:id/assign
- Unlisted Access: GET /events/:id (enforces visibility rules)
- Scanning: GET /scanning/events/:id, POST /scanning/registrations/:id/attend

Note: Real implementation uses tRPC procedures; test harness interacts through UI except potential direct helper for seeding / permission override.
