import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';
import { usersOfTenants } from './schema';

export const relations = defineRelations(schema, (r) => ({
  costItem: {
    tumiEvent: r.one.tumiEvent({
      from: r.costItem.eventId,
      to: r.tumiEvent.id,
    }),
    users: r.many.user({
      from: r.costItem.id.through(r.receipt.costItemId),
      to: r.user.id.through(r.receipt.userId),
    }),
  },
  tumiEvent: {
    costItems: r.many.costItem(),
    eventRegistrationCodes: r.many.eventRegistrationCode(),
    products: r.many.product({
      from: r.tumiEvent.id.through(r.eventSubmissionItem.eventId),
      to: r.product.id.through(r.eventSubmissionItem.productId),
    }),
    users: r.many.user({
      alias: 'user_id_tumiEvent_id_via_photoShare',
    }),
    eventRegistrations: r.many.eventRegistration(),
    user: r.one.user({
      from: r.tumiEvent.creatorId,
      to: r.user.id,
      alias: 'tumiEvent_creatorId_user_id',
    }),
    eventOrganizer: r.one.eventOrganizer({
      from: r.tumiEvent.eventOrganizerId,
      to: r.eventOrganizer.id,
    }),
    eventTemplate: r.one.eventTemplate({
      from: r.tumiEvent.eventTemplateId,
      to: r.eventTemplate.id,
    }),
  },
  eventOrganizer: {
    tenant: r.one.tenant({
      from: r.eventOrganizer.tenantId,
      to: r.tenant.id,
    }),
    tumiEvents: r.many.tumiEvent(),
  },
  tenant: {
    eventOrganizers: r.many.eventOrganizer(),
    products: r.many.product(),
    eventTemplateCategoriesViaEventTemplate: r.many.eventTemplateCategory({
      alias: 'eventTemplateCategory_id_tenant_id_via_eventTemplate',
    }),
    eventTemplateCategoriesTenantId: r.many.eventTemplateCategory({
      alias: 'eventTemplateCategory_tenantId_tenant_id',
    }),
    collectedFees: r.many.collectedFee(),
    transactions: r.many.transaction(),
    users: r.many.user({
      from: r.tenant.id.through(r.usersOfTenants.tenantId),
      to: r.user.id.through(r.usersOfTenants.userId),
    }),
  },
  eventRegistrationCode: {
    tumiEvent: r.one.tumiEvent({
      from: r.eventRegistrationCode.eventId,
      to: r.tumiEvent.id,
    }),
    eventRegistrations: r.many.eventRegistration(),
  },
  product: {
    tumiEvents: r.many.tumiEvent(),
    lineItems: r.many.lineItem(),
    tenant: r.one.tenant({
      from: r.product.tenantId,
      to: r.tenant.id,
    }),
    users: r.many.user(),
  },
  lineItem: {
    product: r.one.product({
      from: r.lineItem.productId,
      to: r.product.id,
    }),
    purchase: r.one.purchase({
      from: r.lineItem.purchaseId,
      to: r.purchase.id,
    }),
    shoppingCart: r.one.shoppingCart({
      from: r.lineItem.shoppingCartId,
      to: r.shoppingCart.id,
    }),
    eventSubmissions: r.many.eventSubmission(),
  },
  purchase: {
    lineItems: r.many.lineItem(),
    transactions: r.many.transaction(),
  },
  shoppingCart: {
    lineItems: r.many.lineItem(),
    usersOfTenant: r.one.usersOfTenants({
      from: [
        r.shoppingCart.usersOfTenantsUserId,
        r.shoppingCart.usersOfTenantsTenantId,
      ],
      to: [r.usersOfTenants.userId, r.usersOfTenants.tenantId],
    }),
  },
  user: {
    tumiEventsViaPhotoShare: r.many.tumiEvent({
      from: r.user.id.through(r.photoShare.creatorId),
      to: r.tumiEvent.id.through(r.photoShare.eventId),
      alias: 'user_id_tumiEvent_id_via_photoShare',
    }),
    products: r.many.product({
      from: r.user.id.through(r.productImage.creatorId),
      to: r.product.id.through(r.productImage.productId),
    }),
    eventRegistrations: r.many.eventRegistration(),
    costItems: r.many.costItem(),
    stripePayments: r.many.stripePayment(),
    transactionsCreatorId: r.many.transaction({
      alias: 'transaction_creatorId_user_id',
    }),
    transactionsUserId: r.many.transaction({
      alias: 'transaction_userId_user_id',
    }),
    tumiEventsCreatorId: r.many.tumiEvent({
      alias: 'tumiEvent_creatorId_user_id',
    }),
    tenants: r.many.tenant(),
  },
  eventTemplateCategory: {
    tenants: r.many.tenant({
      from: r.eventTemplateCategory.id.through(r.eventTemplate.categoryId),
      to: r.tenant.id.through(r.eventTemplate.tenantId),
      alias: 'eventTemplateCategory_id_tenant_id_via_eventTemplate',
    }),
    tenant: r.one.tenant({
      from: r.eventTemplateCategory.tenantId,
      to: r.tenant.id,
      alias: 'eventTemplateCategory_tenantId_tenant_id',
    }),
  },
  eventSubmission: {
    eventRegistration: r.one.eventRegistration({
      from: r.eventSubmission.eventRegistrationId,
      to: r.eventRegistration.id,
    }),
    lineItem: r.one.lineItem({
      from: r.eventSubmission.lineItemId,
      to: r.lineItem.id,
    }),
    eventSubmissionItem: r.one.eventSubmissionItem({
      from: r.eventSubmission.submissionItemId,
      to: r.eventSubmissionItem.id,
    }),
  },
  eventRegistration: {
    eventSubmissions: r.many.eventSubmission(),
    tumiEvent: r.one.tumiEvent({
      from: r.eventRegistration.eventId,
      to: r.tumiEvent.id,
    }),
    eventRegistrationCode: r.one.eventRegistrationCode({
      from: r.eventRegistration.registrationCodeId,
      to: r.eventRegistrationCode.id,
    }),
    user: r.one.user({
      from: r.eventRegistration.userId,
      to: r.user.id,
    }),
    transactions: r.many.transaction(),
  },
  eventSubmissionItem: {
    eventSubmissions: r.many.eventSubmission(),
  },
  collectedFee: {
    tenant: r.one.tenant({
      from: r.collectedFee.tenantId,
      to: r.tenant.id,
    }),
  },
  stripeUserData: {
    usersOfTenant: r.one.usersOfTenants({
      from: [
        r.stripeUserData.usersOfTenantsUserId,
        r.stripeUserData.usersOfTenantsTenantId,
      ],
      to: [r.usersOfTenants.userId, r.usersOfTenants.tenantId],
    }),
  },
  usersOfTenants: {
    stripeUserData: r.one.stripeUserData(),
    shoppingCarts: r.one.shoppingCart(),
    user: r.one.user({
      from: r.usersOfTenants.userId,
      to: r.user.id,
    }),
  },
  stripePayment: {
    users: r.many.user({
      from: r.stripePayment.id.through(r.purchase.paymentId),
      to: r.user.id.through(r.purchase.userId),
    }),
    transactions: r.many.transaction(),
  },
  transaction: {
    userCreatorId: r.one.user({
      from: r.transaction.creatorId,
      to: r.user.id,
      alias: 'transaction_creatorId_user_id',
    }),
    eventRegistration: r.one.eventRegistration({
      from: r.transaction.eventRegistrationId,
      to: r.eventRegistration.id,
    }),
    purchase: r.one.purchase({
      from: r.transaction.purchaseId,
      to: r.purchase.id,
    }),
    stripePayment: r.one.stripePayment({
      from: r.transaction.stripePaymentId,
      to: r.stripePayment.id,
    }),
    tenant: r.one.tenant({
      from: r.transaction.tenantId,
      to: r.tenant.id,
    }),
    userUserId: r.one.user({
      from: r.transaction.userId,
      to: r.user.id,
      alias: 'transaction_userId_user_id',
    }),
    receipts: r.many.receipt(),
  },
  eventTemplate: {
    tumiEvents: r.many.tumiEvent(),
    eventTemplateCategory: r.one.eventTemplateCategory({
      from: r.eventTemplate.categoryId,
      to: r.eventTemplateCategory.id,
    }),
  },
  receipt: {
    transactions: r.many.transaction({
      from: r.receipt.id.through(r.receiptToTransaction.a),
      to: r.transaction.id.through(r.receiptToTransaction.b),
    }),
  },
}));
