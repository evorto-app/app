-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."Currency" AS ENUM('EUR', 'CZK', 'AUD');--> statement-breakpoint
CREATE TYPE "public"."EnrollmentStatus" AS ENUM('LOCAL', 'EXCHANGE', 'INTERNATIONAL', 'NONE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."HomePageStrategy" AS ENUM('LINK', 'STATIC', 'MARKDOWN', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."LogSeverity" AS ENUM('SILLY', 'DEBUG', 'INFO', 'WARNING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."MembershipStatus" AS ENUM('NONE', 'TRIAL', 'FULL', 'SPONSOR', 'ALUMNI', 'SELECTED', 'HELPER', 'BLACKLISTED');--> statement-breakpoint
CREATE TYPE "public"."PublicationState" AS ENUM('DRAFT', 'APPROVAL', 'PUBLIC', 'ORGANIZERS');--> statement-breakpoint
CREATE TYPE "public"."PurchaseStatus" AS ENUM('PENDING', 'PAID', 'SENT', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."RegistrationCodeStatus" AS ENUM('OPEN', 'PENDING', 'SUCCESSFUL', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."RegistrationMode" AS ENUM('STRIPE', 'ONLINE', 'EXTERNAL');--> statement-breakpoint
CREATE TYPE "public"."RegistrationStatus" AS ENUM('PENDING', 'SUCCESSFUL', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."RegistrationType" AS ENUM('ORGANIZER', 'PARTICIPANT', 'CALENDAR');--> statement-breakpoint
CREATE TYPE "public"."Role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."SubmissionItemType" AS ENUM('FILE', 'NUMBER', 'TEXT', 'DATE', 'RATING', 'LONGTEXT', 'BOOLEAN', 'SELECT', 'CONFIRM');--> statement-breakpoint
CREATE TYPE "public"."SubmissionTime" AS ENUM('REGISTRATION', 'BEFORE', 'DURING', 'AFTER');--> statement-breakpoint
CREATE TYPE "public"."TransactionDirection" AS ENUM('TUMI_TO_EXTERNAL', 'EXTERNAL_TO_TUMI', 'TUMI_TO_USER', 'USER_TO_TUMI', 'USER_TO_EXTERNAL', 'EXTERNAL_TO_USER', 'USER_TO_USER');--> statement-breakpoint
CREATE TYPE "public"."TransactionStatus" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."TransactionType" AS ENUM('CASH', 'STRIPE', 'TRANSFER', 'PAYPAL');--> statement-breakpoint
CREATE TABLE "ActivityLog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"oldData" jsonb,
	"involvedUser" uuid,
	"severity" "LogSeverity" NOT NULL,
	"category" text DEFAULT 'general' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CostItem" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"eventId" uuid NOT NULL,
	"name" text NOT NULL,
	"actualAmount" numeric(65, 30),
	"amount" numeric(65, 30) NOT NULL,
	"calculationInfo" text NOT NULL,
	"details" text,
	"onInvoice" boolean NOT NULL,
	"notSubsidized" boolean DEFAULT false NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EventOrganizer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"tenantId" uuid NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"link" text
);
--> statement-breakpoint
CREATE TABLE "EventRegistrationCode" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"createdById" uuid NOT NULL,
	"registrationToRemoveId" uuid,
	"registrationCreatedId" uuid,
	"isPublic" boolean DEFAULT false NOT NULL,
	"eventId" uuid NOT NULL,
	"status" "RegistrationStatus" DEFAULT 'PENDING' NOT NULL,
	"sepaAllowed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EventSubmissionItem" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"eventId" uuid,
	"required" boolean NOT NULL,
	"submissionTime" "SubmissionTime" NOT NULL,
	"instruction" text NOT NULL,
	"name" text NOT NULL,
	"type" "SubmissionItemType" NOT NULL,
	"data" jsonb,
	"productId" uuid
);
--> statement-breakpoint
CREATE TABLE "LineItem" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"cancellationReason" text,
	"cost" numeric(65, 30) NOT NULL,
	"pickupTime" timestamp(3),
	"productId" uuid NOT NULL,
	"purchaseId" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"shoppingCartId" uuid
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"availability" "MembershipStatus""[],
	"tenantId" uuid NOT NULL,
	"isESNcard" boolean DEFAULT false NOT NULL,
	"prices" jsonb NOT NULL,
	"leadImageId" uuid,
	"publicationState" "PublicationState" DEFAULT 'DRAFT' NOT NULL,
	"needsShippingAddress" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PhotoShare" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"eventId" uuid NOT NULL,
	"container" text NOT NULL,
	"creatorId" uuid NOT NULL,
	"originalBlob" text NOT NULL,
	"previewBlob" text,
	"cols" integer DEFAULT 2 NOT NULL,
	"rows" integer DEFAULT 1 NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EventTemplate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"title" text NOT NULL,
	"icon" text NOT NULL,
	"description" text NOT NULL,
	"comment" text NOT NULL,
	"location" text NOT NULL,
	"duration" numeric(65, 30) NOT NULL,
	"participantText" text NOT NULL,
	"organizerText" text NOT NULL,
	"finances" jsonb NOT NULL,
	"tenantId" uuid NOT NULL,
	"categoryId" uuid,
	"coordinates" jsonb,
	"insuranceDescription" text DEFAULT '' NOT NULL,
	"shouldBeReportedToInsurance" boolean DEFAULT true NOT NULL,
	"googlePlaceId" text,
	"googlePlaceUrl" text,
	"isVirtual" boolean DEFAULT false NOT NULL,
	"onlineMeetingUrl" text
);
--> statement-breakpoint
CREATE TABLE "EventTemplateCategory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"name" text NOT NULL,
	"icon" text NOT NULL,
	"tenantId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProductImage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"container" text NOT NULL,
	"creatorId" uuid NOT NULL,
	"originalBlob" text NOT NULL,
	"previewBlob" text,
	"type" text NOT NULL,
	"productId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EventSubmission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"submissionItemId" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"eventRegistrationId" uuid,
	"lineItemId" uuid
);
--> statement-breakpoint
CREATE TABLE "CollectedFee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"tenantId" uuid NOT NULL,
	"applicationFeeId" text NOT NULL,
	"amount" integer NOT NULL,
	"amountRefunded" integer NOT NULL,
	"month" text NOT NULL,
	"currency" text
);
--> statement-breakpoint
CREATE TABLE "EventRegistration" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"type" "RegistrationType" DEFAULT 'PARTICIPANT' NOT NULL,
	"userId" uuid NOT NULL,
	"eventId" uuid NOT NULL,
	"checkInTime" timestamp(3),
	"manualCheckin" boolean DEFAULT false NOT NULL,
	"cancellationReason" text,
	"status" "RegistrationStatus" DEFAULT 'SUCCESSFUL' NOT NULL,
	"registrationCodeId" uuid,
	"rating" integer,
	"anonymousRating" boolean DEFAULT true NOT NULL,
	"userComment" text
);
--> statement-breakpoint
CREATE TABLE "StripeUserData" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"usersOfTenantsUserId" uuid NOT NULL,
	"usersOfTenantsTenantId" uuid NOT NULL,
	"customerId" text NOT NULL,
	"paymentMethodId" text
);
--> statement-breakpoint
CREATE TABLE "Receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"userId" uuid NOT NULL,
	"costItemId" uuid NOT NULL,
	"amount" numeric(65, 30) NOT NULL,
	"blob" text NOT NULL,
	"container" text NOT NULL,
	"md5" text,
	"preview" text,
	"type" text,
	"confirmed" boolean DEFAULT false NOT NULL,
	"canBeSubsidized" boolean DEFAULT true NOT NULL,
	"countryCode" text DEFAULT 'DE' NOT NULL,
	"taxAmount" numeric(65, 30) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Purchase" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"status" "PurchaseStatus" DEFAULT 'PENDING' NOT NULL,
	"userId" uuid NOT NULL,
	"paymentId" uuid,
	"cancellationReason" text
);
--> statement-breakpoint
CREATE TABLE "ShoppingCart" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"usersOfTenantsTenantId" uuid NOT NULL,
	"usersOfTenantsUserId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StripePayment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"amount" numeric(65, 30) NOT NULL,
	"checkoutSession" text NOT NULL,
	"events" jsonb NOT NULL,
	"feeAmount" numeric(65, 30),
	"netAmount" numeric(65, 30),
	"paymentIntent" text,
	"paymentMethod" text,
	"paymentMethodType" text,
	"refundedAmount" numeric(65, 30) DEFAULT '0',
	"status" text NOT NULL,
	"shipping" jsonb,
	"checkoutUrl" text
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"authId" text NOT NULL,
	"firstName" text NOT NULL,
	"lastName" text NOT NULL,
	"email" text NOT NULL,
	"birthdate" timestamp(3),
	"email_verified" boolean NOT NULL,
	"picture" text NOT NULL,
	"calendarToken" uuid NOT NULL,
	"iban" text,
	"paypal" text,
	"phone" text,
	"esnCardOverride" boolean DEFAULT false NOT NULL,
	"university" text,
	"partyAnimals" boolean DEFAULT false NOT NULL,
	"enrolmentStatus" "EnrollmentStatus" DEFAULT 'NONE' NOT NULL,
	"bio" text,
	"country" text,
	"homeUniversity" text,
	"instagram" text,
	"studyProgram" text,
	"communicationEmail" text,
	"esnCardNumber" text,
	"esnCardValidUntil" timestamp(3),
	"acceptPhoneUsage" boolean DEFAULT false NOT NULL,
	"phoneNumberOnWhatsapp" boolean DEFAULT false NOT NULL,
	"deletedAt" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "Transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"subject" text NOT NULL,
	"isMembershipFee" boolean DEFAULT false NOT NULL,
	"userId" uuid,
	"tenantId" uuid NOT NULL,
	"comment" text,
	"creatorId" uuid NOT NULL,
	"type" "TransactionType" NOT NULL,
	"direction" "TransactionDirection" NOT NULL,
	"status" "TransactionStatus" DEFAULT 'PENDING' NOT NULL,
	"amount" numeric(65, 30) NOT NULL,
	"onSendingBalance" boolean DEFAULT false NOT NULL,
	"onReceivingBalance" boolean DEFAULT false NOT NULL,
	"eventRegistrationId" uuid,
	"purchaseId" uuid,
	"stripePaymentId" uuid
);
--> statement-breakpoint
CREATE TABLE "TumiEvent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"title" text NOT NULL,
	"icon" text NOT NULL,
	"start" timestamp(3) NOT NULL,
	"end" timestamp(3) NOT NULL,
	"description" text NOT NULL,
	"location" text NOT NULL,
	"participantText" text NOT NULL,
	"organizerText" text NOT NULL,
	"participantLimit" integer DEFAULT 0 NOT NULL,
	"organizerLimit" integer DEFAULT 0 NOT NULL,
	"publicationState" "PublicationState" DEFAULT 'DRAFT' NOT NULL,
	"participantSignup" "MembershipStatus""[],
	"organizerSignup" "MembershipStatus""[],
	"eventOrganizerId" uuid NOT NULL,
	"creatorId" uuid NOT NULL,
	"eventTemplateId" uuid NOT NULL,
	"registrationLink" text,
	"registrationMode" "RegistrationMode" NOT NULL,
	"coordinates" jsonb,
	"prices" jsonb,
	"registrationStart" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"insuranceDescription" text DEFAULT '' NOT NULL,
	"shouldBeReportedToInsurance" boolean DEFAULT true NOT NULL,
	"disableDeregistration" boolean DEFAULT false NOT NULL,
	"excludeFromStatistics" boolean DEFAULT false NOT NULL,
	"excludeFromRatings" boolean DEFAULT false NOT NULL,
	"googlePlaceId" text,
	"googlePlaceUrl" text,
	"organizerRegistrationStart" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"isVirtual" boolean DEFAULT false NOT NULL,
	"onlineMeetingUrl" text,
	"enablePhotoSharing" boolean DEFAULT true NOT NULL,
	"deRegistrationSettings" jsonb,
	"deferredPayment" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_prisma_migrations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"finished_at" timestamp with time zone,
	"migration_name" varchar(255) NOT NULL,
	"logs" text,
	"rolled_back_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_steps_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Tenant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"name" text NOT NULL,
	"shortName" text NOT NULL,
	"aboutPage" text DEFAULT '' NOT NULL,
	"faqPage" text,
	"imprintPage" text DEFAULT '' NOT NULL,
	"privacyPolicyPage" text DEFAULT '' NOT NULL,
	"tacPage" text,
	"homePageLink" text,
	"homePageStrategy" "HomePageStrategy" DEFAULT 'STATIC' NOT NULL,
	"stripeConnectAccountId" text,
	"stripeReducedTaxRate" text,
	"stripeRegularTaxRate" text,
	"settings" jsonb DEFAULT '{"socialLinks":[],"showPWAInstall":false,"sectionHubLinks":[]}'::jsonb NOT NULL,
	"communicationEmail" text DEFAULT 'questions@esn-tumi.de' NOT NULL,
	"currency" "Currency" DEFAULT 'EUR' NOT NULL,
	"credit" integer DEFAULT 0 NOT NULL,
	"contractEnd" timestamp(3) NOT NULL,
	"hardContractEnd" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_ReceiptToTransaction" (
	"A" uuid NOT NULL,
	"B" uuid NOT NULL,
	CONSTRAINT "_ReceiptToTransaction_AB_pkey" PRIMARY KEY("A","B")
);
--> statement-breakpoint
CREATE TABLE "UsersOfTenants" (
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"userId" uuid NOT NULL,
	"tenantId" uuid NOT NULL,
	"role" "Role" DEFAULT 'USER' NOT NULL,
	"status" "MembershipStatus" DEFAULT 'NONE' NOT NULL,
	"position" text,
	"additionalData" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lastPrivacyAcceptance" timestamp(3),
	CONSTRAINT "UsersOfTenants_pkey" PRIMARY KEY("userId","tenantId")
);
--> statement-breakpoint
ALTER TABLE "CostItem" ADD CONSTRAINT "CostItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TumiEvent"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventOrganizer" ADD CONSTRAINT "EventOrganizer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventRegistrationCode" ADD CONSTRAINT "EventRegistrationCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TumiEvent"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventSubmissionItem" ADD CONSTRAINT "EventSubmissionItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TumiEvent"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventSubmissionItem" ADD CONSTRAINT "EventSubmissionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "public"."Purchase"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "LineItem" ADD CONSTRAINT "LineItem_shoppingCartId_fkey" FOREIGN KEY ("shoppingCartId") REFERENCES "public"."ShoppingCart"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PhotoShare" ADD CONSTRAINT "PhotoShare_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PhotoShare" ADD CONSTRAINT "PhotoShare_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TumiEvent"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventTemplate" ADD CONSTRAINT "EventTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."EventTemplateCategory"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventTemplate" ADD CONSTRAINT "EventTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventTemplateCategory" ADD CONSTRAINT "EventTemplateCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventSubmission" ADD CONSTRAINT "EventSubmission_eventRegistrationId_fkey" FOREIGN KEY ("eventRegistrationId") REFERENCES "public"."EventRegistration"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventSubmission" ADD CONSTRAINT "EventSubmission_lineItemId_fkey" FOREIGN KEY ("lineItemId") REFERENCES "public"."LineItem"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventSubmission" ADD CONSTRAINT "EventSubmission_submissionItemId_fkey" FOREIGN KEY ("submissionItemId") REFERENCES "public"."EventSubmissionItem"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CollectedFee" ADD CONSTRAINT "CollectedFee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."TumiEvent"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_registrationCodeId_fkey" FOREIGN KEY ("registrationCodeId") REFERENCES "public"."EventRegistrationCode"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StripeUserData" ADD CONSTRAINT "StripeUserData_usersOfTenantsUserId_usersOfTenantsTenantId_fkey" FOREIGN KEY ("usersOfTenantsUserId","usersOfTenantsTenantId") REFERENCES "public"."UsersOfTenants"("userId","tenantId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "public"."CostItem"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."StripePayment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ShoppingCart" ADD CONSTRAINT "ShoppingCart_usersOfTenantsUserId_usersOfTenantsTenantId_fkey" FOREIGN KEY ("usersOfTenantsTenantId","usersOfTenantsUserId") REFERENCES "public"."UsersOfTenants"("userId","tenantId") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_eventRegistrationId_fkey" FOREIGN KEY ("eventRegistrationId") REFERENCES "public"."EventRegistration"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "public"."Purchase"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_stripePaymentId_fkey" FOREIGN KEY ("stripePaymentId") REFERENCES "public"."StripePayment"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TumiEvent" ADD CONSTRAINT "TumiEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TumiEvent" ADD CONSTRAINT "TumiEvent_eventOrganizerId_fkey" FOREIGN KEY ("eventOrganizerId") REFERENCES "public"."EventOrganizer"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TumiEvent" ADD CONSTRAINT "TumiEvent_eventTemplateId_fkey" FOREIGN KEY ("eventTemplateId") REFERENCES "public"."EventTemplate"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "_ReceiptToTransaction" ADD CONSTRAINT "_ReceiptToTransaction_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Receipt"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "_ReceiptToTransaction" ADD CONSTRAINT "_ReceiptToTransaction_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Transaction"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UsersOfTenants" ADD CONSTRAINT "UsersOfTenants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "UsersOfTenants" ADD CONSTRAINT "UsersOfTenants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "EventRegistrationCode_registrationToRemoveId_key" ON "EventRegistrationCode" USING btree ("registrationToRemoveId" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "CollectedFee_applicationFeeId_key" ON "CollectedFee" USING btree ("applicationFeeId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "StripeUserData_usersOfTenantsUserId_usersOfTenantsTenantId_key" ON "StripeUserData" USING btree ("usersOfTenantsUserId" uuid_ops,"usersOfTenantsTenantId" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Purchase_paymentId_key" ON "Purchase" USING btree ("paymentId" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ShoppingCart_usersOfTenantsUserId_usersOfTenantsTenantId_key" ON "ShoppingCart" USING btree ("usersOfTenantsUserId" uuid_ops,"usersOfTenantsTenantId" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "StripePayment_checkoutSession_key" ON "StripePayment" USING btree ("checkoutSession" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "StripePayment_paymentIntent_key" ON "StripePayment" USING btree ("paymentIntent" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "User_authId_key" ON "User" USING btree ("authId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "User_calendarToken_key" ON "User" USING btree ("calendarToken" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "User_esnCardNumber_key" ON "User" USING btree ("esnCardNumber" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Tenant_shortName_key" ON "Tenant" USING btree ("shortName" text_ops);--> statement-breakpoint
CREATE INDEX "_ReceiptToTransaction_B_index" ON "_ReceiptToTransaction" USING btree ("B" uuid_ops);
*/