CREATE TYPE "registration_transfer_intent_status" AS ENUM (
  'pending',
  'completed',
  'cancelled',
  'expired'
);
--> statement-breakpoint
CREATE TABLE "registration_transfer_intents" (
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "id" varchar(20) PRIMARY KEY,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "tenantId" varchar(20) NOT NULL,
  "code" varchar(64) NOT NULL,
  "created_by_user_id" varchar(20) NOT NULL,
  "expires_at" timestamp NOT NULL,
  "replacement_registration_id" varchar(20),
  "source_registration_id" varchar(20) NOT NULL,
  "status" "registration_transfer_intent_status" DEFAULT 'pending' NOT NULL,
  CONSTRAINT "registration_transfer_intents_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "registration_transfer_intents_pending_source_registration_unique"
ON "registration_transfer_intents" ("source_registration_id")
WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "registration_transfer_intents"
ADD CONSTRAINT "registration_transfer_intents_tenantId_tenants_id_fk"
FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id")
ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_transfer_intents"
ADD CONSTRAINT "registration_transfer_intents_created_by_user_id_users_id_fk"
FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_transfer_intents"
ADD CONSTRAINT "registration_transfer_intents_replacement_registration_id_event_registrations_id_fk"
FOREIGN KEY ("replacement_registration_id") REFERENCES "public"."event_registrations"("id")
ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_transfer_intents"
ADD CONSTRAINT "registration_transfer_intents_source_registration_id_event_registrations_id_fk"
FOREIGN KEY ("source_registration_id") REFERENCES "public"."event_registrations"("id")
ON DELETE no action ON UPDATE no action;
