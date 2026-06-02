CREATE TYPE "tenant_event_review_policy" AS ENUM (
  'review_required',
  'organizer_self_publish'
);
--> statement-breakpoint
CREATE TYPE "tenant_stripe_account_management" AS ENUM (
  'platform_managed',
  'tenant_admin_managed'
);
--> statement-breakpoint
ALTER TABLE "tenants"
ADD COLUMN "event_review_policy" "tenant_event_review_policy" DEFAULT 'review_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants"
ADD COLUMN "stripe_account_management" "tenant_stripe_account_management" DEFAULT 'platform_managed' NOT NULL;
