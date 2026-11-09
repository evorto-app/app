# Members Hub

Role visibility follows `displayInHub`; a person can appear under several roles,
including roles with no permissions. Broad membership roles are hidden in the
local seed.

Resources are a secondary list of ordered names, links, and icons. Use the same searchable icon picker as events, storing the shared icon name/color value. Adding a catalog icon for a resource requires resource-management access, not event/template permissions. Hub readers
need `internal:viewInternalPages`; editing additionally requires
`internal:manageResources`. This is an explicit permission, not a default section
membership grant. The editor supports adding, changing, removing, and moving
links, then saving or cancelling the whole list.

Store resource links in the private `tenants.hub_resources` JSONB column. Read and
write them through authenticated, tenant-scoped hub RPCs; do not add them to
public tenant configuration or the global footer. Saves compare the previous
resource list atomically and reject a stale editor while retaining its draft.
HTTP, HTTPS, and email destinations are validated; embedded credentials and
executable schemes are rejected. Browser links use a new tab with opener isolation.

Apply the current Drizzle schema (`bun run db:push`) before starting the updated
app. The additive column defaults to an empty list and is compatible with the
previous app. Demo seeding includes shared-drive, calendar, and sample email
links; test tenants start empty.

Resource links use Angular Material navigation-list items and leading icon slots, with native spacing, focus, and interaction states.

On wide screens, Resources occupies a right-hand column. Below the desktop
breakpoint it follows the directory. Role and editor columns respond to their
container width, keeping the resource editor usable in the narrower column.
