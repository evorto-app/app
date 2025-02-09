import { relations } from "drizzle-orm/relations";
import { tumiEvent, costItem, tenant, eventOrganizer, eventRegistrationCode, eventSubmissionItem, product, lineItem, purchase, shoppingCart, user, photoShare, eventTemplateCategory, eventTemplate, productImage, eventRegistration, eventSubmission, collectedFee, usersOfTenants, stripeUserData, receipt, stripePayment, transaction, receiptToTransaction } from "./schema";

export const costItemRelations = relations(costItem, ({one, many}) => ({
	tumiEvent: one(tumiEvent, {
		fields: [costItem.eventId],
		references: [tumiEvent.id]
	}),
	receipts: many(receipt),
}));

export const tumiEventRelations = relations(tumiEvent, ({one, many}) => ({
	costItems: many(costItem),
	eventRegistrationCodes: many(eventRegistrationCode),
	eventSubmissionItems: many(eventSubmissionItem),
	photoShares: many(photoShare),
	eventRegistrations: many(eventRegistration),
	user: one(user, {
		fields: [tumiEvent.creatorId],
		references: [user.id]
	}),
	eventOrganizer: one(eventOrganizer, {
		fields: [tumiEvent.eventOrganizerId],
		references: [eventOrganizer.id]
	}),
	eventTemplate: one(eventTemplate, {
		fields: [tumiEvent.eventTemplateId],
		references: [eventTemplate.id]
	}),
}));

export const eventOrganizerRelations = relations(eventOrganizer, ({one, many}) => ({
	tenant: one(tenant, {
		fields: [eventOrganizer.tenantId],
		references: [tenant.id]
	}),
	tumiEvents: many(tumiEvent),
}));

export const tenantRelations = relations(tenant, ({many}) => ({
	eventOrganizers: many(eventOrganizer),
	products: many(product),
	eventTemplates: many(eventTemplate),
	eventTemplateCategories: many(eventTemplateCategory),
	collectedFees: many(collectedFee),
	transactions: many(transaction),
	usersOfTenants: many(usersOfTenants),
}));

export const eventRegistrationCodeRelations = relations(eventRegistrationCode, ({one, many}) => ({
	tumiEvent: one(tumiEvent, {
		fields: [eventRegistrationCode.eventId],
		references: [tumiEvent.id]
	}),
	eventRegistrations: many(eventRegistration),
}));

export const eventSubmissionItemRelations = relations(eventSubmissionItem, ({one, many}) => ({
	tumiEvent: one(tumiEvent, {
		fields: [eventSubmissionItem.eventId],
		references: [tumiEvent.id]
	}),
	product: one(product, {
		fields: [eventSubmissionItem.productId],
		references: [product.id]
	}),
	eventSubmissions: many(eventSubmission),
}));

export const productRelations = relations(product, ({one, many}) => ({
	eventSubmissionItems: many(eventSubmissionItem),
	lineItems: many(lineItem),
	tenant: one(tenant, {
		fields: [product.tenantId],
		references: [tenant.id]
	}),
	productImages: many(productImage),
}));

export const lineItemRelations = relations(lineItem, ({one, many}) => ({
	product: one(product, {
		fields: [lineItem.productId],
		references: [product.id]
	}),
	purchase: one(purchase, {
		fields: [lineItem.purchaseId],
		references: [purchase.id]
	}),
	shoppingCart: one(shoppingCart, {
		fields: [lineItem.shoppingCartId],
		references: [shoppingCart.id]
	}),
	eventSubmissions: many(eventSubmission),
}));

export const purchaseRelations = relations(purchase, ({one, many}) => ({
	lineItems: many(lineItem),
	stripePayment: one(stripePayment, {
		fields: [purchase.paymentId],
		references: [stripePayment.id]
	}),
	user: one(user, {
		fields: [purchase.userId],
		references: [user.id]
	}),
	transactions: many(transaction),
}));

export const shoppingCartRelations = relations(shoppingCart, ({one, many}) => ({
	lineItems: many(lineItem),
	usersOfTenant: one(usersOfTenants, {
		fields: [shoppingCart.usersOfTenantsTenantId],
		references: [usersOfTenants.userId]
	}),
}));

export const photoShareRelations = relations(photoShare, ({one}) => ({
	user: one(user, {
		fields: [photoShare.creatorId],
		references: [user.id]
	}),
	tumiEvent: one(tumiEvent, {
		fields: [photoShare.eventId],
		references: [tumiEvent.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	photoShares: many(photoShare),
	productImages: many(productImage),
	eventRegistrations: many(eventRegistration),
	receipts: many(receipt),
	purchases: many(purchase),
	transactions_creatorId: many(transaction, {
		relationName: "transaction_creatorId_user_id"
	}),
	transactions_userId: many(transaction, {
		relationName: "transaction_userId_user_id"
	}),
	tumiEvents: many(tumiEvent),
	usersOfTenants: many(usersOfTenants),
}));

export const eventTemplateRelations = relations(eventTemplate, ({one, many}) => ({
	eventTemplateCategory: one(eventTemplateCategory, {
		fields: [eventTemplate.categoryId],
		references: [eventTemplateCategory.id]
	}),
	tenant: one(tenant, {
		fields: [eventTemplate.tenantId],
		references: [tenant.id]
	}),
	tumiEvents: many(tumiEvent),
}));

export const eventTemplateCategoryRelations = relations(eventTemplateCategory, ({one, many}) => ({
	eventTemplates: many(eventTemplate),
	tenant: one(tenant, {
		fields: [eventTemplateCategory.tenantId],
		references: [tenant.id]
	}),
}));

export const productImageRelations = relations(productImage, ({one}) => ({
	user: one(user, {
		fields: [productImage.creatorId],
		references: [user.id]
	}),
	product: one(product, {
		fields: [productImage.productId],
		references: [product.id]
	}),
}));

export const eventSubmissionRelations = relations(eventSubmission, ({one}) => ({
	eventRegistration: one(eventRegistration, {
		fields: [eventSubmission.eventRegistrationId],
		references: [eventRegistration.id]
	}),
	lineItem: one(lineItem, {
		fields: [eventSubmission.lineItemId],
		references: [lineItem.id]
	}),
	eventSubmissionItem: one(eventSubmissionItem, {
		fields: [eventSubmission.submissionItemId],
		references: [eventSubmissionItem.id]
	}),
}));

export const eventRegistrationRelations = relations(eventRegistration, ({one, many}) => ({
	eventSubmissions: many(eventSubmission),
	tumiEvent: one(tumiEvent, {
		fields: [eventRegistration.eventId],
		references: [tumiEvent.id]
	}),
	eventRegistrationCode: one(eventRegistrationCode, {
		fields: [eventRegistration.registrationCodeId],
		references: [eventRegistrationCode.id]
	}),
	user: one(user, {
		fields: [eventRegistration.userId],
		references: [user.id]
	}),
	transactions: many(transaction),
}));

export const collectedFeeRelations = relations(collectedFee, ({one}) => ({
	tenant: one(tenant, {
		fields: [collectedFee.tenantId],
		references: [tenant.id]
	}),
}));

export const stripeUserDataRelations = relations(stripeUserData, ({one}) => ({
	usersOfTenant: one(usersOfTenants, {
		fields: [stripeUserData.usersOfTenantsUserId],
		references: [usersOfTenants.userId]
	}),
}));

export const usersOfTenantsRelations = relations(usersOfTenants, ({one, many}) => ({
	stripeUserData: many(stripeUserData),
	shoppingCarts: many(shoppingCart),
	tenant: one(tenant, {
		fields: [usersOfTenants.tenantId],
		references: [tenant.id]
	}),
	user: one(user, {
		fields: [usersOfTenants.userId],
		references: [user.id]
	}),
}));

export const receiptRelations = relations(receipt, ({one, many}) => ({
	costItem: one(costItem, {
		fields: [receipt.costItemId],
		references: [costItem.id]
	}),
	user: one(user, {
		fields: [receipt.userId],
		references: [user.id]
	}),
	receiptToTransactions: many(receiptToTransaction),
}));

export const stripePaymentRelations = relations(stripePayment, ({many}) => ({
	purchases: many(purchase),
	transactions: many(transaction),
}));

export const transactionRelations = relations(transaction, ({one, many}) => ({
	user_creatorId: one(user, {
		fields: [transaction.creatorId],
		references: [user.id],
		relationName: "transaction_creatorId_user_id"
	}),
	eventRegistration: one(eventRegistration, {
		fields: [transaction.eventRegistrationId],
		references: [eventRegistration.id]
	}),
	purchase: one(purchase, {
		fields: [transaction.purchaseId],
		references: [purchase.id]
	}),
	stripePayment: one(stripePayment, {
		fields: [transaction.stripePaymentId],
		references: [stripePayment.id]
	}),
	tenant: one(tenant, {
		fields: [transaction.tenantId],
		references: [tenant.id]
	}),
	user_userId: one(user, {
		fields: [transaction.userId],
		references: [user.id],
		relationName: "transaction_userId_user_id"
	}),
	receiptToTransactions: many(receiptToTransaction),
}));

export const receiptToTransactionRelations = relations(receiptToTransaction, ({one}) => ({
	receipt: one(receipt, {
		fields: [receiptToTransaction.a],
		references: [receipt.id]
	}),
	transaction: one(transaction, {
		fields: [receiptToTransaction.b],
		references: [transaction.id]
	}),
}));