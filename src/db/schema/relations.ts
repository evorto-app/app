import { relations } from 'drizzle-orm/relations';

import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';
import { eventRegistrations } from './event-registrations';
import { eventTemplateCategories } from './event-template-categories';
import { eventTemplates } from './event-templates';
import { icons } from './icons';
import { roles } from './roles';
import { templateEventAddons } from './template-event-addons';
import { templateRegistrationOptionDiscounts } from './template-registration-option-discounts';
import {
  addonToTemplateRegistrationOptions,
  roleToTemplateRegistrationOptions,
  templateRegistrationOptions,
} from './template-registration-options';
import { tenants } from './tenants';
import { transactions } from './transactions';
import { rolesToTenantUsers, users, usersToTenants } from './users';

export const tenantRelations = relations(tenants, ({ many }) => ({
  icons: many(icons),
  roles: many(roles),
  templateCategories: many(eventTemplateCategories),
  usersToTenants: many(usersToTenants),
}));

export const iconRelations = relations(icons, ({ one }) => ({
  tenant: one(tenants, {
    fields: [icons.tenantId],
    references: [tenants.id],
  }),
}));

export const userRelations = relations(users, ({ many }) => ({
  usersToTenants: many(usersToTenants),
}));

export const roleRelations = relations(roles, ({ many, one }) => ({
  allowedTemplateRegistrationOptions: many(roleToTemplateRegistrationOptions),
  rolesToTenantUsers: many(rolesToTenantUsers),
  tenant: one(tenants, {
    fields: [roles.tenantId],
    references: [tenants.id],
  }),
}));

export const rolesToTenantUsersRelations = relations(
  rolesToTenantUsers,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolesToTenantUsers.roleId],
      references: [roles.id],
    }),
    userTenant: one(usersToTenants, {
      fields: [rolesToTenantUsers.userTenantId],
      references: [usersToTenants.id],
    }),
  }),
);

export const usersToTenantsRelations = relations(
  usersToTenants,
  ({ many, one }) => ({
    rolesToTenantUsers: many(rolesToTenantUsers),
    tenant: one(tenants, {
      fields: [usersToTenants.tenantId],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [usersToTenants.userId],
      references: [users.id],
    }),
  }),
);

export const eventRegistrationRelations = relations(
  eventRegistrations,
  ({ many, one }) => ({
    event: one(eventInstances, {
      fields: [eventRegistrations.eventId],
      references: [eventInstances.id],
    }),
    registrationOption: one(eventRegistrationOptions, {
      fields: [eventRegistrations.registrationOptionId],
      references: [eventRegistrationOptions.id],
    }),
    transactions: many(transactions),
    user: one(users, {
      fields: [eventRegistrations.userId],
      references: [users.id],
    }),
  }),
);

export const eventRegistrationOptionRelations = relations(
  eventRegistrationOptions,
  ({ many, one }) => ({
    event: one(eventInstances, {
      fields: [eventRegistrationOptions.eventId],
      references: [eventInstances.id],
    }),
    registrations: many(eventRegistrations),
  }),
);

export const eventInstanceRelations = relations(
  eventInstances,
  ({ many, one }) => ({
    registrationOptions: many(eventRegistrationOptions),
    reviewer: one(users, {
      fields: [eventInstances.reviewedBy],
      references: [users.id],
    }),
    template: one(eventTemplates, {
      fields: [eventInstances.templateId],
      references: [eventTemplates.id],
    }),
    tenant: one(tenants, {
      fields: [eventInstances.tenantId],
      references: [tenants.id],
    }),
  }),
);

export const eventTemplateCategoryRelations = relations(
  eventTemplateCategories,
  ({ many, one }) => ({
    templates: many(eventTemplates),
    tenant: one(tenants, {
      fields: [eventTemplateCategories.tenantId],
      references: [tenants.id],
    }),
  }),
);

export const eventTemplateRelations = relations(
  eventTemplates,
  ({ many, one }) => ({
    addons: many(templateEventAddons),
    category: one(eventTemplateCategories, {
      fields: [eventTemplates.categoryId],
      references: [eventTemplateCategories.id],
    }),
    events: many(eventInstances),
    registrationOptions: many(templateRegistrationOptions),
    tenant: one(tenants, {
      fields: [eventTemplates.tenantId],
      references: [tenants.id],
    }),
  }),
);

export const templateEventAddonRelations = relations(
  templateEventAddons,
  ({ many, one }) => ({
    includedInRegistrationOptions: many(addonToTemplateRegistrationOptions),
    template: one(eventTemplates, {
      fields: [templateEventAddons.templateId],
      references: [eventTemplates.id],
    }),
  }),
);

export const templateRegistrationOptionRelations = relations(
  templateRegistrationOptions,
  ({ many, one }) => ({
    discounts: many(templateRegistrationOptionDiscounts),
    includedAddons: many(addonToTemplateRegistrationOptions),
    registrationOptionsToRoles: many(roleToTemplateRegistrationOptions),
    template: one(eventTemplates, {
      fields: [templateRegistrationOptions.templateId],
      references: [eventTemplates.id],
    }),
  }),
);

export const templateRegistrationOptionDiscountRelations = relations(
  templateRegistrationOptionDiscounts,
  ({ one }) => ({
    registrationOption: one(templateRegistrationOptions, {
      fields: [templateRegistrationOptionDiscounts.registrationOptionId],
      references: [templateRegistrationOptions.id],
    }),
  }),
);

export const roleToTemplateRegistrationOptionRelations = relations(
  roleToTemplateRegistrationOptions,
  ({ one }) => ({
    registrationOption: one(templateRegistrationOptions, {
      fields: [roleToTemplateRegistrationOptions.registrationOptionId],
      references: [templateRegistrationOptions.id],
    }),
    role: one(roles, {
      fields: [roleToTemplateRegistrationOptions.roleId],
      references: [roles.id],
    }),
  }),
);

export const addonToTemplateRegistrationOptionRelations = relations(
  addonToTemplateRegistrationOptions,
  ({ one }) => ({
    addon: one(templateEventAddons, {
      fields: [addonToTemplateRegistrationOptions.addonId],
      references: [templateEventAddons.id],
    }),
    registrationOption: one(templateRegistrationOptions, {
      fields: [addonToTemplateRegistrationOptions.registrationOptionId],
      references: [templateRegistrationOptions.id],
    }),
  }),
);

export const transactionRelations = relations(transactions, ({ one }) => ({
  event: one(eventInstances, {
    fields: [transactions.eventId],
    references: [eventInstances.id],
  }),
  eventRegistration: one(eventRegistrations, {
    fields: [transactions.eventRegistrationId],
    references: [eventRegistrations.id],
  }),
  executiveUser: one(users, {
    fields: [transactions.executiveUserId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [transactions.targetUserId],
    references: [users.id],
  }),
}));
