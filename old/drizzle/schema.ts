import {
  pgTable,
  uuid,
  timestamp,
  text,
  jsonb,
  foreignKey,
  numeric,
  boolean,
  uniqueIndex,
  integer,
  index,
  varchar,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const currency = pgEnum('Currency', ['EUR', 'CZK', 'AUD']);
export const enrollmentStatus = pgEnum('EnrollmentStatus', [
  'LOCAL',
  'EXCHANGE',
  'INTERNATIONAL',
  'NONE',
  'OTHER',
]);
export const homePageStrategy = pgEnum('HomePageStrategy', [
  'LINK',
  'STATIC',
  'MARKDOWN',
  'NONE',
]);
export const logSeverity = pgEnum('LogSeverity', [
  'SILLY',
  'DEBUG',
  'INFO',
  'WARNING',
  'ERROR',
]);
export const membershipStatus = pgEnum('MembershipStatus', [
  'NONE',
  'TRIAL',
  'FULL',
  'SPONSOR',
  'ALUMNI',
  'SELECTED',
  'HELPER',
  'BLACKLISTED',
]);
export const publicationState = pgEnum('PublicationState', [
  'DRAFT',
  'APPROVAL',
  'PUBLIC',
  'ORGANIZERS',
]);
export const purchaseStatus = pgEnum('PurchaseStatus', [
  'PENDING',
  'PAID',
  'SENT',
  'CANCELLED',
]);
export const registrationCodeStatus = pgEnum('RegistrationCodeStatus', [
  'OPEN',
  'PENDING',
  'SUCCESSFUL',
  'CANCELLED',
]);
export const registrationMode = pgEnum('RegistrationMode', [
  'STRIPE',
  'ONLINE',
  'EXTERNAL',
]);
export const registrationStatus = pgEnum('RegistrationStatus', [
  'PENDING',
  'SUCCESSFUL',
  'CANCELLED',
]);
export const registrationType = pgEnum('RegistrationType', [
  'ORGANIZER',
  'PARTICIPANT',
  'CALENDAR',
]);
export const role = pgEnum('Role', ['USER', 'ADMIN']);
export const submissionItemType = pgEnum('SubmissionItemType', [
  'FILE',
  'NUMBER',
  'TEXT',
  'DATE',
  'RATING',
  'LONGTEXT',
  'BOOLEAN',
  'SELECT',
  'CONFIRM',
]);
export const submissionTime = pgEnum('SubmissionTime', [
  'REGISTRATION',
  'BEFORE',
  'DURING',
  'AFTER',
]);
export const transactionDirection = pgEnum('TransactionDirection', [
  'TUMI_TO_EXTERNAL',
  'EXTERNAL_TO_TUMI',
  'TUMI_TO_USER',
  'USER_TO_TUMI',
  'USER_TO_EXTERNAL',
  'EXTERNAL_TO_USER',
  'USER_TO_USER',
]);
export const transactionStatus = pgEnum('TransactionStatus', [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
]);
export const transactionType = pgEnum('TransactionType', [
  'CASH',
  'STRIPE',
  'TRANSFER',
  'PAYPAL',
]);

export const activityLog = pgTable('ActivityLog', {
  id: uuid().notNull(),
  createdAt: timestamp({ precision: 3, mode: 'string' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  message: text().notNull(),
  data: jsonb(),
  oldData: jsonb(),
  involvedUser: uuid(),
  severity: logSeverity().notNull(),
  category: text().default('general').notNull(),
});

export const costItem = pgTable(
  'CostItem',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    eventId: uuid().notNull(),
    name: text().notNull(),
    actualAmount: numeric({ precision: 65, scale: 30 }),
    amount: numeric({ precision: 65, scale: 30 }).notNull(),
    calculationInfo: text().notNull(),
    details: text(),
    onInvoice: boolean().notNull(),
    notSubsidized: boolean().default(false).notNull(),
    complete: boolean().default(false).notNull(),
    completed: boolean().default(false).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [tumiEvent.id],
      name: 'CostItem_eventId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const eventOrganizer = pgTable(
  'EventOrganizer',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    tenantId: uuid().notNull(),
    name: text().notNull(),
    text: text().notNull(),
    link: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'EventOrganizer_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const eventRegistrationCode = pgTable(
  'EventRegistrationCode',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    createdById: uuid().notNull(),
    registrationToRemoveId: uuid(),
    registrationCreatedId: uuid(),
    isPublic: boolean().default(false).notNull(),
    eventId: uuid().notNull(),
    status: registrationStatus().default('PENDING').notNull(),
    sepaAllowed: boolean().default(false).notNull(),
  },
  (table) => [
    uniqueIndex('EventRegistrationCode_registrationToRemoveId_key').using(
      'btree',
      table.registrationToRemoveId.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [tumiEvent.id],
      name: 'EventRegistrationCode_eventId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
);

export const eventSubmissionItem = pgTable(
  'EventSubmissionItem',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    eventId: uuid(),
    required: boolean().notNull(),
    submissionTime: submissionTime().notNull(),
    instruction: text().notNull(),
    name: text().notNull(),
    type: submissionItemType().notNull(),
    data: jsonb(),
    productId: uuid(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [tumiEvent.id],
      name: 'EventSubmissionItem_eventId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [product.id],
      name: 'EventSubmissionItem_productId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
  ],
);

export const lineItem = pgTable(
  'LineItem',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    cancellationReason: text(),
    cost: numeric({ precision: 65, scale: 30 }).notNull(),
    pickupTime: timestamp({ precision: 3, mode: 'string' }),
    productId: uuid().notNull(),
    purchaseId: uuid(),
    quantity: integer().default(1).notNull(),
    shoppingCartId: uuid(),
  },
  (table) => [
    foreignKey({
      columns: [table.productId],
      foreignColumns: [product.id],
      name: 'LineItem_productId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.purchaseId],
      foreignColumns: [purchase.id],
      name: 'LineItem_purchaseId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.shoppingCartId],
      foreignColumns: [shoppingCart.id],
      name: 'LineItem_shoppingCartId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
  ],
);

export const product = pgTable(
  'Product',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    title: text().notNull(),
    description: text().notNull(),
    // TODO: failed to parse database type 'MembershipStatus"[]'
    availability: membershipStatus().array(),
    tenantId: uuid().notNull(),
    isESNcard: boolean().default(false).notNull(),
    prices: jsonb().notNull(),
    leadImageId: uuid(),
    publicationState: publicationState().default('DRAFT').notNull(),
    needsShippingAddress: boolean().default(false).notNull(),
    isActive: boolean().default(true).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'Product_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const photoShare = pgTable(
  'PhotoShare',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    eventId: uuid().notNull(),
    container: text().notNull(),
    creatorId: uuid().notNull(),
    originalBlob: text().notNull(),
    previewBlob: text(),
    cols: integer().default(2).notNull(),
    rows: integer().default(1).notNull(),
    type: text().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.creatorId],
      foreignColumns: [user.id],
      name: 'PhotoShare_creatorId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [tumiEvent.id],
      name: 'PhotoShare_eventId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const eventTemplate = pgTable(
  'EventTemplate',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    title: text().notNull(),
    icon: text().notNull(),
    description: text().notNull(),
    comment: text().notNull(),
    location: text().notNull(),
    duration: numeric({ precision: 65, scale: 30 }).notNull(),
    participantText: text().notNull(),
    organizerText: text().notNull(),
    finances: jsonb().notNull(),
    tenantId: uuid().notNull(),
    categoryId: uuid(),
    coordinates: jsonb(),
    insuranceDescription: text().default('').notNull(),
    shouldBeReportedToInsurance: boolean().default(true).notNull(),
    googlePlaceId: text(),
    googlePlaceUrl: text(),
    isVirtual: boolean().default(false).notNull(),
    onlineMeetingUrl: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [eventTemplateCategory.id],
      name: 'EventTemplate_categoryId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'EventTemplate_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const eventTemplateCategory = pgTable(
  'EventTemplateCategory',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    name: text().notNull(),
    icon: text().notNull(),
    tenantId: uuid().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'EventTemplateCategory_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const productImage = pgTable(
  'ProductImage',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    container: text().notNull(),
    creatorId: uuid().notNull(),
    originalBlob: text().notNull(),
    previewBlob: text(),
    type: text().notNull(),
    productId: uuid().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.creatorId],
      foreignColumns: [user.id],
      name: 'ProductImage_creatorId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [product.id],
      name: 'ProductImage_productId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const eventSubmission = pgTable(
  'EventSubmission',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    submissionItemId: uuid().notNull(),
    data: jsonb().notNull(),
    eventRegistrationId: uuid(),
    lineItemId: uuid(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventRegistrationId],
      foreignColumns: [eventRegistration.id],
      name: 'EventSubmission_eventRegistrationId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.lineItemId],
      foreignColumns: [lineItem.id],
      name: 'EventSubmission_lineItemId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.submissionItemId],
      foreignColumns: [eventSubmissionItem.id],
      name: 'EventSubmission_submissionItemId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const collectedFee = pgTable(
  'CollectedFee',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    tenantId: uuid().notNull(),
    applicationFeeId: text().notNull(),
    amount: integer().notNull(),
    amountRefunded: integer().notNull(),
    month: text().notNull(),
    currency: text(),
  },
  (table) => [
    uniqueIndex('CollectedFee_applicationFeeId_key').using(
      'btree',
      table.applicationFeeId.asc().nullsLast().op('text_ops'),
    ),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'CollectedFee_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const eventRegistration = pgTable(
  'EventRegistration',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    type: registrationType().default('PARTICIPANT').notNull(),
    userId: uuid().notNull(),
    eventId: uuid().notNull(),
    checkInTime: timestamp({ precision: 3, mode: 'string' }),
    manualCheckin: boolean().default(false).notNull(),
    cancellationReason: text(),
    status: registrationStatus().default('SUCCESSFUL').notNull(),
    registrationCodeId: uuid(),
    rating: integer(),
    anonymousRating: boolean().default(true).notNull(),
    userComment: text(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [tumiEvent.id],
      name: 'EventRegistration_eventId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.registrationCodeId],
      foreignColumns: [eventRegistrationCode.id],
      name: 'EventRegistration_registrationCodeId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'EventRegistration_userId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const stripeUserData = pgTable(
  'StripeUserData',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    usersOfTenantsUserId: uuid().notNull(),
    usersOfTenantsTenantId: uuid().notNull(),
    customerId: text().notNull(),
    paymentMethodId: text(),
  },
  (table) => [
    uniqueIndex(
      'StripeUserData_usersOfTenantsUserId_usersOfTenantsTenantId_key',
    ).using(
      'btree',
      table.usersOfTenantsUserId.asc().nullsLast().op('uuid_ops'),
      table.usersOfTenantsTenantId.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.usersOfTenantsUserId, table.usersOfTenantsTenantId],
      foreignColumns: [usersOfTenants.userId, usersOfTenants.tenantId],
      name: 'StripeUserData_usersOfTenantsUserId_usersOfTenantsTenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const receipt = pgTable(
  'Receipt',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    userId: uuid().notNull(),
    costItemId: uuid().notNull(),
    amount: numeric({ precision: 65, scale: 30 }).notNull(),
    blob: text().notNull(),
    container: text().notNull(),
    md5: text(),
    preview: text(),
    type: text(),
    confirmed: boolean().default(false).notNull(),
    canBeSubsidized: boolean().default(true).notNull(),
    countryCode: text().default('DE').notNull(),
    taxAmount: numeric({ precision: 65, scale: 30 }).default('0').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.costItemId],
      foreignColumns: [costItem.id],
      name: 'Receipt_costItemId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'Receipt_userId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const purchase = pgTable(
  'Purchase',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    status: purchaseStatus().default('PENDING').notNull(),
    userId: uuid().notNull(),
    paymentId: uuid(),
    cancellationReason: text(),
  },
  (table) => [
    uniqueIndex('Purchase_paymentId_key').using(
      'btree',
      table.paymentId.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [stripePayment.id],
      name: 'Purchase_paymentId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'Purchase_userId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const shoppingCart = pgTable(
  'ShoppingCart',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    usersOfTenantsTenantId: uuid().notNull(),
    usersOfTenantsUserId: uuid().notNull(),
  },
  (table) => [
    uniqueIndex(
      'ShoppingCart_usersOfTenantsUserId_usersOfTenantsTenantId_key',
    ).using(
      'btree',
      table.usersOfTenantsUserId.asc().nullsLast().op('uuid_ops'),
      table.usersOfTenantsTenantId.asc().nullsLast().op('uuid_ops'),
    ),
    foreignKey({
      columns: [table.usersOfTenantsUserId, table.usersOfTenantsTenantId],
      foreignColumns: [usersOfTenants.userId, usersOfTenants.tenantId],
      name: 'ShoppingCart_usersOfTenantsUserId_usersOfTenantsTenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const stripePayment = pgTable(
  'StripePayment',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    amount: numeric({ precision: 65, scale: 30 }).notNull(),
    checkoutSession: text().notNull(),
    events: jsonb().notNull(),
    feeAmount: numeric({ precision: 65, scale: 30 }),
    netAmount: numeric({ precision: 65, scale: 30 }),
    paymentIntent: text(),
    paymentMethod: text(),
    paymentMethodType: text(),
    refundedAmount: numeric({ precision: 65, scale: 30 }).default('0'),
    status: text().notNull(),
    shipping: jsonb(),
    checkoutUrl: text(),
  },
  (table) => [
    uniqueIndex('StripePayment_checkoutSession_key').using(
      'btree',
      table.checkoutSession.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('StripePayment_paymentIntent_key').using(
      'btree',
      table.paymentIntent.asc().nullsLast().op('text_ops'),
    ),
  ],
);

export const transaction = pgTable(
  'Transaction',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    subject: text().notNull(),
    isMembershipFee: boolean().default(false).notNull(),
    userId: uuid(),
    tenantId: uuid().notNull(),
    comment: text(),
    creatorId: uuid().notNull(),
    type: transactionType().notNull(),
    direction: transactionDirection().notNull(),
    status: transactionStatus().default('PENDING').notNull(),
    amount: numeric({ precision: 65, scale: 30 }).notNull(),
    onSendingBalance: boolean().default(false).notNull(),
    onReceivingBalance: boolean().default(false).notNull(),
    eventRegistrationId: uuid(),
    purchaseId: uuid(),
    stripePaymentId: uuid(),
  },
  (table) => [
    foreignKey({
      columns: [table.creatorId],
      foreignColumns: [user.id],
      name: 'Transaction_creatorId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.eventRegistrationId],
      foreignColumns: [eventRegistration.id],
      name: 'Transaction_eventRegistrationId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.purchaseId],
      foreignColumns: [purchase.id],
      name: 'Transaction_purchaseId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.stripePaymentId],
      foreignColumns: [stripePayment.id],
      name: 'Transaction_stripePaymentId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'Transaction_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'Transaction_userId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('set null'),
  ],
);

export const tumiEvent = pgTable(
  'TumiEvent',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    title: text().notNull(),
    icon: text().notNull(),
    start: timestamp({ precision: 3, mode: 'string' }).notNull(),
    end: timestamp({ precision: 3, mode: 'string' }).notNull(),
    description: text().notNull(),
    location: text().notNull(),
    participantText: text().notNull(),
    organizerText: text().notNull(),
    participantLimit: integer().default(0).notNull(),
    organizerLimit: integer().default(0).notNull(),
    publicationState: publicationState().default('DRAFT').notNull(),
    // TODO: failed to parse database type 'MembershipStatus"[]'
    participantSignup: membershipStatus().array(),
    // TODO: failed to parse database type 'MembershipStatus"[]'
    organizerSignup: membershipStatus().array(),
    eventOrganizerId: uuid().notNull(),
    creatorId: uuid().notNull(),
    eventTemplateId: uuid().notNull(),
    registrationLink: text(),
    registrationMode: registrationMode().notNull(),
    coordinates: jsonb(),
    prices: jsonb(),
    registrationStart: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    insuranceDescription: text().default('').notNull(),
    shouldBeReportedToInsurance: boolean().default(true).notNull(),
    disableDeregistration: boolean().default(false).notNull(),
    excludeFromStatistics: boolean().default(false).notNull(),
    excludeFromRatings: boolean().default(false).notNull(),
    googlePlaceId: text(),
    googlePlaceUrl: text(),
    organizerRegistrationStart: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    isVirtual: boolean().default(false).notNull(),
    onlineMeetingUrl: text(),
    enablePhotoSharing: boolean().default(true).notNull(),
    deRegistrationSettings: jsonb(),
    deferredPayment: boolean().default(false).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.creatorId],
      foreignColumns: [user.id],
      name: 'TumiEvent_creatorId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.eventOrganizerId],
      foreignColumns: [eventOrganizer.id],
      name: 'TumiEvent_eventOrganizerId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.eventTemplateId],
      foreignColumns: [eventTemplate.id],
      name: 'TumiEvent_eventTemplateId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const user = pgTable(
  'User',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    authId: text().notNull(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    email: text().notNull(),
    birthdate: timestamp({ precision: 3, mode: 'string' }),
    emailVerified: boolean('email_verified').notNull(),
    picture: text().notNull(),
    calendarToken: uuid().notNull(),
    iban: text(),
    paypal: text(),
    phone: text(),
    esnCardOverride: boolean().default(false).notNull(),
    university: text(),
    partyAnimals: boolean().default(false).notNull(),
    enrolmentStatus: enrollmentStatus().default('NONE').notNull(),
    bio: text(),
    country: text(),
    homeUniversity: text(),
    instagram: text(),
    studyProgram: text(),
    communicationEmail: text(),
    esnCardNumber: text(),
    esnCardValidUntil: timestamp({ precision: 3, mode: 'string' }),
    acceptPhoneUsage: boolean().default(false).notNull(),
    phoneNumberOnWhatsapp: boolean().default(false).notNull(),
    deletedAt: timestamp({ precision: 3, mode: 'string' }),
    telegramUsername: text(),
  },
  (table) => [
    uniqueIndex('User_authId_key').using(
      'btree',
      table.authId.asc().nullsLast().op('text_ops'),
    ),
    uniqueIndex('User_calendarToken_key').using(
      'btree',
      table.calendarToken.asc().nullsLast().op('uuid_ops'),
    ),
    uniqueIndex('User_esnCardNumber_key').using(
      'btree',
      table.esnCardNumber.asc().nullsLast().op('text_ops'),
    ),
  ],
);

export const receiptToTransaction = pgTable(
  '_ReceiptToTransaction',
  {
    a: uuid('A').notNull(),
    b: uuid('B').notNull(),
  },
  (table) => [
    index().using('btree', table.b.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.a],
      foreignColumns: [receipt.id],
      name: '_ReceiptToTransaction_A_fkey',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
    foreignKey({
      columns: [table.b],
      foreignColumns: [transaction.id],
      name: '_ReceiptToTransaction_B_fkey',
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
);

export const prismaMigrations = pgTable('_prisma_migrations', {
  id: varchar({ length: 36 }).notNull(),
  checksum: varchar({ length: 64 }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'string' }),
  migrationName: varchar('migration_name', { length: 255 }).notNull(),
  logs: text(),
  rolledBackAt: timestamp('rolled_back_at', {
    withTimezone: true,
    mode: 'string',
  }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' })
    .defaultNow()
    .notNull(),
  appliedStepsCount: integer('applied_steps_count').default(0).notNull(),
});

export const usersOfTenants = pgTable(
  'UsersOfTenants',
  {
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    userId: uuid().notNull(),
    tenantId: uuid().notNull(),
    role: role().default('USER').notNull(),
    status: membershipStatus().default('NONE').notNull(),
    position: text(),
    additionalData: jsonb().default({}).notNull(),
    lastPrivacyAcceptance: timestamp({ precision: 3, mode: 'string' }),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId],
      foreignColumns: [tenant.id],
      name: 'UsersOfTenants_tenantId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: 'UsersOfTenants_userId_fkey',
    })
      .onUpdate('cascade')
      .onDelete('restrict'),
  ],
);

export const tenant = pgTable(
  'Tenant',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ precision: 3, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    name: text().notNull(),
    shortName: text().notNull(),
    aboutPage: text().default('').notNull(),
    faqPage: text(),
    imprintPage: text().default('').notNull(),
    privacyPolicyPage: text().default('').notNull(),
    tacPage: text(),
    homePageLink: text(),
    homePageStrategy: homePageStrategy().default('STATIC').notNull(),
    stripeConnectAccountId: text(),
    stripeReducedTaxRate: text(),
    stripeRegularTaxRate: text(),
    settings: jsonb()
      .default({ socialLinks: [], showPWAInstall: false, sectionHubLinks: [] })
      .notNull(),
    communicationEmail: text().default('questions@esn-tumi.de').notNull(),
    currency: currency().default('EUR').notNull(),
    credit: integer().default(0).notNull(),
    contractEnd: timestamp({ precision: 3, mode: 'string' }).notNull(),
    hardContractEnd: boolean().default(false).notNull(),
    seoDescription: text()
      .default(
        'Here you can find events for international students around the city',
      )
      .notNull(),
    seoTitle: text().default('ESN App').notNull(),
  },
  (table) => [
    uniqueIndex('Tenant_shortName_key').using(
      'btree',
      table.shortName.asc().nullsLast().op('text_ops'),
    ),
  ],
);
