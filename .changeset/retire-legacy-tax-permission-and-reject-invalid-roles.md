---
default: patch
---

Reject invalid saved organization-role permissions before resolving member
access, including platform-wide grants, retired permissions and unknown values.
Use `admin:tax` for tax authority and stop accepting `admin:manageTaxes`.
Preserve role IDs, permission dependencies and valid organization wildcards;
revoking one wildcard capability keeps the other grants, including payment
management. Role editing and audit details use the current tax permission.

Event edit and organizer routes distinguish unavailable events, denied access,
and unexpected failures while preserving their existing access checks.

Keep internal failure details out of public RPC responses while retaining safe
server diagnostics for registration notification-link failures.
