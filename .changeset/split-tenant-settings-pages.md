---
default: patch
---

# Split organization settings into focused pages

Replace the single large settings form with five independently saved pages for
organization details, sign-up rules, payments and discounts, appearance, and
legal information. Payment and discount settings are available only to people
who can manage payments; the other pages remain available to people who can
manage organization settings.

Each page keeps unsaved edits when new information arrives and asks before
discarding them during navigation. Appearance settings also wait for logo and
site-icon uploads to finish before saving their new addresses.

New organization image uploads are recorded before storage writes. Saving appearance settings attaches selected uploads atomically and retains replaced images for 24 hours before cleanup. The `/tenant-assets/` route is reserved for ready, organization-owned uploads: newly selected URLs use their app-relative path; absolute URLs using that route are rejected. Exactly unchanged existing image URLs and external URLs using other paths remain supported without being adopted into cleanup.

Apply the updated Drizzle schema to the isolated development database (`bun run db:push`, or `bun run db:reset` for a disposable reset). The upload ledger uses a non-cascading organization foreign key. Unknown or interrupted storage-write outcomes retain durable metadata and become eligible for another bounded indexed cleanup after 5 minutes, including after an earlier successful deletion; this recurring metadata/cleanup cost is intentional until successful write settlement is known. Local workers poll every 5 minutes; hosted workers use the existing private receipt-cleanup trigger (hourly at minute 15). Brand cleanup passes have a 30-second deadline and retain their claim on interruption or failure. No locks span storage requests. Future organization deletion must drain owned assets before removing the organization. No bucket scan or historical image backfill is performed.
