import { relations } from 'drizzle-orm';

import * as schema from './schema';

export const usersRelations = relations(schema.users, ({ many }) => ({
  eventRegistrations: many(schema.eventRegistrations),
  usersToTenants: many(schema.usersToTenants),
}));

export const tenantsRelations = relations(schema.tenants, ({ many }) => ({
  eventTemplates: many(schema.eventTemplates),
  eventInstances: many(schema.eventInstances),
  icons: many(schema.icons),
  roles: many(schema.roles),
  usersToTenants: many(schema.usersToTenants),
}));

export const eventTemplatesRelations = relations(schema.eventTemplates, ({ one, many }) => ({
  tenant: one(schema.tenants, {
    fields: [schema.eventTemplates.tenantId],
    references: [schema.tenants.id],
  }),
  eventInstances: many(schema.eventInstances),
  category: one(schema.eventTemplateCategories, {
    fields: [schema.eventTemplates.categoryId],
    references: [schema.eventTemplateCategories.id],
  }),
  templateRegistrationOptions: many(schema.templateRegistrationOptions),
}));

export const eventInstancesRelations = relations(schema.eventInstances, ({ one, many }) => ({
  template: one(schema.eventTemplates, {
    fields: [schema.eventInstances.templateId],
    references: [schema.eventTemplates.id],
  }),
  tenant: one(schema.tenants, {
    fields: [schema.eventInstances.tenantId],
    references: [schema.tenants.id],
  }),
  creator: one(schema.users, {
    fields: [schema.eventInstances.creatorId],
    references: [schema.users.id],
  }),
  eventRegistrationOptions: many(schema.eventRegistrationOptions),
  eventRegistrations: many(schema.eventRegistrations),
}));

export const eventRegistrationsRelations = relations(schema.eventRegistrations, ({ one }) => ({
  user: one(schema.users, {
    fields: [schema.eventRegistrations.userId],
    references: [schema.users.id],
  }),
  tenant: one(schema.tenants, {
    fields: [schema.eventRegistrations.tenantId],
    references: [schema.tenants.id],
  }),
  eventInstance: one(schema.eventInstances, {
    fields: [schema.eventRegistrations.eventInstanceId],
    references: [schema.eventInstances.id],
  }),
  registrationOption: one(schema.eventRegistrationOptions, {
    fields: [schema.eventRegistrations.registrationOptionId],
    references: [schema.eventRegistrationOptions.id],
  }),
}));

export const eventRegistrationOptionsRelations = relations(schema.eventRegistrationOptions, ({ one, many }) => ({
  eventInstance: one(schema.eventInstances, {
    fields: [schema.eventRegistrationOptions.eventInstanceId],
    references: [schema.eventInstances.id],
  }),
  eventRegistrations: many(schema.eventRegistrations),
  templateOption: one(schema.templateRegistrationOptions, {
    fields: [schema.eventRegistrationOptions.templateOptionId],
    references: [schema.templateRegistrationOptions.id],
  }),
}));

export const templateRegistrationOptionsRelations = relations(schema.templateRegistrationOptions, ({ one, many }) => ({
  template: one(schema.eventTemplates, {
    fields: [schema.templateRegistrationOptions.templateId],
    references: [schema.eventTemplates.id],
  }),
  eventRegistrationOptions: many(schema.eventRegistrationOptions),
  templateRegistrationOptionDiscounts: many(schema.templateRegistrationOptionDiscounts),
}));

export const usersToTenantsRelations = relations(schema.usersToTenants, ({ one, many }) => ({
  user: one(schema.users, {
    fields: [schema.usersToTenants.userId],
    references: [schema.users.id],
  }),
  tenant: one(schema.tenants, {
    fields: [schema.usersToTenants.tenantId],
    references: [schema.tenants.id],
  }),
  rolesToTenantUsers: many(schema.rolesToTenantUsers),
}));

export const rolesRelations = relations(schema.roles, ({ one, many }) => ({
  tenant: one(schema.tenants, {
    fields: [schema.roles.tenantId],
    references: [schema.tenants.id],
  }),
  rolesToTenantUsers: many(schema.rolesToTenantUsers),
}));

export const rolesToTenantUsersRelations = relations(schema.rolesToTenantUsers, ({ one }) => ({
  role: one(schema.roles, {
    fields: [schema.rolesToTenantUsers.roleId],
    references: [schema.roles.id],
  }),
  userTenant: one(schema.usersToTenants, {
    fields: [schema.rolesToTenantUsers.userTenantId],
    references: [schema.usersToTenants.id],
  }),
}));

export const eventTemplateCategoriesRelations = relations(schema.eventTemplateCategories, ({ one, many }) => ({
  tenant: one(schema.tenants, {
    fields: [schema.eventTemplateCategories.tenantId],
    references: [schema.tenants.id],
  }),
  eventTemplates: many(schema.eventTemplates),
}));

export const iconsRelations = relations(schema.icons, ({ one }) => ({
  tenant: one(schema.tenants, {
    fields: [schema.icons.tenantId],
    references: [schema.tenants.id],
  }),
}));

export const transactionsRelations = relations(schema.transactions, ({ one }) => ({
  tenant: one(schema.tenants, {
    fields: [schema.transactions.tenantId],
    references: [schema.tenants.id],
  }),
  user: one(schema.users, {
    fields: [schema.transactions.userId],
    references: [schema.users.id],
  }),
}));

export const templateEventAddonsRelations = relations(schema.templateEventAddons, ({ one }) => ({
  template: one(schema.eventTemplates, {
    fields: [schema.templateEventAddons.templateId],
    references: [schema.eventTemplates.id],
  }),
}));

export const templateRegistrationOptionDiscountsRelations = relations(schema.templateRegistrationOptionDiscounts, ({ one }) => ({
  templateOption: one(schema.templateRegistrationOptions, {
    fields: [schema.templateRegistrationOptionDiscounts.templateOptionId],
    references: [schema.templateRegistrationOptions.id],
  }),
}));

// Export all relations for the database client
export const allRelations = {
  users: usersRelations,
  tenants: tenantsRelations,
  eventTemplates: eventTemplatesRelations,
  eventInstances: eventInstancesRelations,
  eventRegistrations: eventRegistrationsRelations,
  eventRegistrationOptions: eventRegistrationOptionsRelations,
  templateRegistrationOptions: templateRegistrationOptionsRelations,
  usersToTenants: usersToTenantsRelations,
  roles: rolesRelations,
  rolesToTenantUsers: rolesToTenantUsersRelations,
  eventTemplateCategories: eventTemplateCategoriesRelations,
  icons: iconsRelations,
  transactions: transactionsRelations,
  templateEventAddons: templateEventAddonsRelations,
  templateRegistrationOptionDiscounts: templateRegistrationOptionDiscountsRelations,
};