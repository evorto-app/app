import { relations } from 'drizzle-orm/relations';
import { icons } from './icons';
import { eventTemplateCategories } from './eventTemplateCategories';
import { rolesToTenantUsers, users, usersToTenants } from './userTables';
import { tenants } from './tenantTables';
import { roles } from './roles';
import {
  addonToTemplateRegistrationOptions,
  roleToTemplateRegistrationOptions,
  templateRegistrationOptions,
} from './templateRegistrationOptions';
import { eventTemplates } from './eventTemplates';
import { templateEventAddons } from './templateEventAddons';
import { templateRegistrationOptionDiscounts } from './templateRegistrationOptionDiscounts';

export const tenantRelations = relations(tenants, ({ many }) => ({
  templateCategories: many(eventTemplateCategories),
  usersToTenants: many(usersToTenants),
  roles: many(roles),
  icons: many(icons),
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
  rolesToTenantUsers: many(rolesToTenantUsers),
  allowedTemplateRegistrationOptions: many(roleToTemplateRegistrationOptions),
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
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [usersToTenants.tenantId],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [usersToTenants.userId],
      references: [users.id],
    }),
    rolesToTenantUsers: many(rolesToTenantUsers),
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
  ({ one, many }) => ({
    category: one(eventTemplateCategories, {
      fields: [eventTemplates.categoryId],
      references: [eventTemplateCategories.id],
    }),
    addons: many(templateEventAddons),
    registrationOptions: many(templateRegistrationOptions),
  }),
);

export const templateEventAddonRelations = relations(
  templateEventAddons,
  ({ one, many }) => ({
    includedInRegistrationOptions: many(addonToTemplateRegistrationOptions),
    template: one(eventTemplates, {
      fields: [templateEventAddons.templateId],
      references: [eventTemplates.id],
    }),
  }),
);

export const templateRegistrationOptionRelations = relations(
  templateRegistrationOptions,
  ({ one, many }) => ({
    includedAddons: many(addonToTemplateRegistrationOptions),
    discounts: many(templateRegistrationOptionDiscounts),
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
    role: one(roles, {
      fields: [roleToTemplateRegistrationOptions.roleId],
      references: [roles.id],
    }),
    registrationOption: one(templateRegistrationOptions, {
      fields: [roleToTemplateRegistrationOptions.registrationOptionId],
      references: [templateRegistrationOptions.id],
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
