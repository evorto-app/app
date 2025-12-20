# Data Model: Evorto Living E2E Baseline

Derived from spec requirements FR-001..FR-042 and research decisions.

## Entities

### Tenant

| Field     | Type                 | Notes                           |
| --------- | -------------------- | ------------------------------- |
| id        | string (uuid/nanoid) | Primary key                     |
| name      | string               | Deterministic base + run suffix |
| createdAt | datetime             | For audit                       |

### User

| Field | Type | Notes |
| id | string | Auth provider id or internal mapping |
| email | string | Unique per tenant |
| displayName | string | Captured/confirmed during onboarding |
| roles | Role[] | Many-to-many |
| createdAt | datetime | |
| onboardedAt | datetime? | Set after first-time journey (FR-005) |

### Role

| Field | Type | Notes |
| id | string | |
| name | string | e.g., admin, organizer, user or custom |
| permissions | string[] | Stable identifiers; override harness may inject |
| createdAt | datetime | |

### Permission Configuration (Run-Scoped)

| Field | Type | Notes |
| id | string | ephemeral key |
| targetRoleId | string | Applies to role |
| addedPermissions | string[] | Additional ephemeral permissions |
| removedPermissions | string[] | Removed for test scope |

### TemplateCategory

| Field | Type | Notes |
| id | string | |
| name | string | Deterministic ordering baseline (FR-034) |
| position | number | Optional explicit ordering |
| createdAt | datetime | |

### Template

| Field | Type | Notes |
| id | string | |
| categoryId | string (fk TemplateCategory) | |
| name | string | |
| description | string | |
| pricingType | enum('FREE','PAID') | Drives event inheritance |
| registrationDefaults | json | Window offsets, capacity |
| visibilityDefault | enum('LISTED','UNLISTED') | |
| createdAt | datetime | |

### Event

| Field | Type | Notes |
| id | string | |
| templateId | string (fk Template) | |
| tenantId | string (fk Tenant) | |
| name | string | Derived from template or overridden |
| visibility | enum('LISTED','UNLISTED') | FR-013, FR-021..FR-023 |
| pricingType | enum('FREE','PAID') | Inherited (FR-012) |
| capacity | number | |
| registrationOpensAt | datetime | Relative seeding ensures open (FR-003) |
| startsAt | datetime | Future or past depending event kind |
| endsAt | datetime | After startsAt |
| createdAt | datetime | |

### Registration

| Field | Type | Notes |
| id | string | |
| eventId | string (fk Event) | |
| userId | string (fk User) | |
| state | enum('PENDING','CONFIRMED') | Distinct states (FR-032) |
| createdAt | datetime | |
| confirmedAt | datetime? | When state becomes CONFIRMED |
| paymentIntentId | string? | Future finance scope (excluded) |

### ScanningRecord (Attendance)

| Field | Type | Notes |
| id | string | |
| registrationId | string (fk Registration) | |
| scannedAt | datetime | |
| status | enum('ATTENDED') | Future states possible |

### DocumentationArtifact (Generated)

Not persisted in app DB; file system output.
| Field | Type | Notes |
| journeyId | string | Slug/filename base |
| title | string | Front matter only (FR-040) |
| permissions | string[]? | Optional callout (FR-041) |
| images | string[] | Relative paths under journey folder |

## Relationships Diagram (Textual)

Tenant 1--_ User
User _--_ Role (through join table)  
Role 1--_ Permission (as string identifiers; or inline array)  
TemplateCategory 1--_ Template  
Template 1--_ Event  
Event 1--\* Registration  
Registration 0..1--1 ScanningRecord

## State Transitions

Registration: PENDING -> CONFIRMED (payment simulation or immediate for free).  
ScanningRecord: (absent) -> ATTENDED (upon scan).

## Validation & Invariants

- registrationOpensAt <= now <= startsAt (for upcoming open events).
- endsAt > startsAt.
- capacity > 0.
- Unique (userId, eventId).
- TemplateCategory ordering stable (name or explicit position).

## Open Items / Deferred

- PaymentIntent details deferred (finance scope).
- Additional registration states (CANCELED, REFUNDED) deferred.
