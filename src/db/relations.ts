import { defineRelations } from 'drizzle-orm';

import * as schema from './schema';

export const relations = defineRelations(schema, (r) => ({
  eventInstances: {
    creator: r.one.users({
      alias: 'eventInstances_creatorId_users_id',
      from: r.eventInstances.creatorId,
      optional: false,
      to: r.users.id,
    }),
    financeReceipts: r.many.financeReceipts(),
    registrationOptions: r.many.eventRegistrationOptions(),
    registrations: r.many.eventRegistrations(),
    reviewer: r.one.users({
      alias: 'eventInstances_reviewedBy_users_id',
      from: r.eventInstances.reviewedBy,
      to: r.users.id,
    }),
    template: r.one.eventTemplates({
      from: r.eventInstances.templateId,
      optional: false,
      to: r.eventTemplates.id,
    }),
    tenant: r.one.tenants({
      from: r.eventInstances.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
    transactions: r.many.transactions(),
  },
  eventRegistrationOptions: {
    event: r.one.eventInstances({
      from: r.eventRegistrationOptions.eventId,
      optional: false,
      to: r.eventInstances.id,
    }),
    eventRegistrations: r.many.eventRegistrations(),
  },
  eventRegistrations: {
    event: r.one.eventInstances({
      from: r.eventRegistrations.eventId,
      optional: false,
      to: r.eventInstances.id,
    }),
    registrationOption: r.one.eventRegistrationOptions({
      from: r.eventRegistrations.registrationOptionId,
      optional: false,
      to: r.eventRegistrationOptions.id,
    }),
    tenant: r.one.tenants({
      from: r.eventRegistrations.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
    transactions: r.many.transactions(),
    user: r.one.users({
      from: r.eventRegistrations.userId,
      optional: false,
      to: r.users.id,
    }),
  },
  eventTemplateCategories: {
    templates: r.many.eventTemplates(),
    tenant: r.one.tenants({
      from: r.eventTemplateCategories.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
  },
  eventTemplates: {
    category: r.one.eventTemplateCategories({
      from: r.eventTemplates.categoryId,
      optional: false,
      to: r.eventTemplateCategories.id,
    }),
    eventInstances: r.many.eventInstances(),
    registrationOptions: r.many.templateRegistrationOptions(),
    templateEventAddons: r.many.templateEventAddons(),
  },
  financeReceipts: {
    event: r.one.eventInstances({
      from: r.financeReceipts.eventId,
      optional: false,
      to: r.eventInstances.id,
    }),
    refundTransaction: r.one.transactions({
      from: r.financeReceipts.refundTransactionId,
      to: r.transactions.id,
    }),
    submittedByUser: r.one.users({
      alias: 'financeReceipts_submittedByUserId_users_id',
      from: r.financeReceipts.submittedByUserId,
      optional: false,
      to: r.users.id,
    }),
    tenant: r.one.tenants({
      from: r.financeReceipts.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
    user_refundedByUserId: r.one.users({
      alias: 'financeReceipts_refundedByUserId_users_id',
      from: r.financeReceipts.refundedByUserId,
      to: r.users.id,
    }),
    user_reviewedByUserId: r.one.users({
      alias: 'financeReceipts_reviewedByUserId_users_id',
      from: r.financeReceipts.reviewedByUserId,
      to: r.users.id,
    }),
  },
  icons: {
    tenant: r.one.tenants({
      from: r.icons.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
  },
  roles: {
    // registrationOptions: r.many.templateRegistrationOptions(),
    tenant: r.one.tenants({
      from: r.roles.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
    usersToTenants: r.many.usersToTenants({
      from: r.roles.id.through(r.rolesToTenantUsers.roleId),
      to: r.usersToTenants.id.through(r.rolesToTenantUsers.userTenantId),
    }),
  },
  rolesToTenantUsers: {
    role: r.one.roles({
      from: r.rolesToTenantUsers.roleId,
      optional: false,
      to: r.roles.id,
    }),
    userTenant: r.one.usersToTenants({
      from: r.rolesToTenantUsers.userTenantId,
      optional: false,
      to: r.usersToTenants.id,
    }),
  },
  templateEventAddons: {
    eventTemplate: r.one.eventTemplates({
      from: r.templateEventAddons.templateId,
      optional: false,
      to: r.eventTemplates.id,
    }),
    templateRegistrationOptions: r.many.templateRegistrationOptions({
      from: r.templateEventAddons.id.through(
        r.addonToTemplateRegistrationOptions.addonId,
      ),
      to: r.templateRegistrationOptions.id.through(
        r.addonToTemplateRegistrationOptions.registrationOptionId,
      ),
    }),
  },
  templateRegistrationOptions: {
    eventTemplate: r.one.eventTemplates({
      from: r.templateRegistrationOptions.templateId,
      optional: false,
      to: r.eventTemplates.id,
    }),
    templateEventAddons: r.many.templateEventAddons(),
  },
  tenants: {
    eventRegistrations: r.many.eventRegistrations(),
    events: r.many.eventInstances(),
    financeReceipts: r.many.financeReceipts(),
    icons: r.many.icons(),
    roles: r.many.roles(),
    stripeTaxRates: r.many.tenantStripeTaxRates(),
    templateCategories: r.many.eventTemplateCategories(),
    transactions: r.many.transactions(),
    users: r.many.users({
      from: r.tenants.id.through(r.usersToTenants.tenantId),
      to: r.users.id.through(r.usersToTenants.userId),
    }),
  },
  tenantStripeTaxRates: {
    tenant: r.one.tenants({
      from: r.tenantStripeTaxRates.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
  },
  transactions: {
    event: r.one.eventInstances({
      from: r.transactions.eventId,
      to: r.eventInstances.id,
    }),
    eventRegistration: r.one.eventRegistrations({
      from: r.transactions.eventRegistrationId,
      to: r.eventRegistrations.id,
    }),
    refundedFinanceReceipts: r.many.financeReceipts(),
    tenant: r.one.tenants({
      from: r.transactions.tenantId,
      optional: false,
      to: r.tenants.id,
    }),
    user_executiveUserId: r.one.users({
      alias: 'transactions_executiveUserId_users_id',
      from: r.transactions.executiveUserId,
      to: r.users.id,
    }),
    user_targetUserId: r.one.users({
      alias: 'transactions_targetUserId_users_id',
      from: r.transactions.targetUserId,
      to: r.users.id,
    }),
  },
  users: {
    eventInstances_creatorId: r.many.eventInstances({
      alias: 'eventInstances_creatorId_users_id',
    }),
    eventInstances_reviewedBy: r.many.eventInstances({
      alias: 'eventInstances_reviewedBy_users_id',
    }),
    eventRegistrations: r.many.eventRegistrations(),
    financeReceipts_refundedByUserId: r.many.financeReceipts({
      alias: 'financeReceipts_refundedByUserId_users_id',
    }),
    financeReceipts_reviewedByUserId: r.many.financeReceipts({
      alias: 'financeReceipts_reviewedByUserId_users_id',
    }),
    financeReceipts_submittedByUserId: r.many.financeReceipts({
      alias: 'financeReceipts_submittedByUserId_users_id',
    }),
    tenantAssignments: r.many.usersToTenants(),
    tenants: r.many.tenants(),
    transactions_executiveUserId: r.many.transactions({
      alias: 'transactions_executiveUserId_users_id',
    }),
    transactions_targetUserId: r.many.transactions({
      alias: 'transactions_targetUserId_users_id',
    }),
  },
  usersToTenants: {
    roles: r.many.roles(),
    rolesToTenantUsers: r.many.rolesToTenantUsers(),
    user: r.one.users({
      from: r.usersToTenants.userId,
      to: r.users.id,
    }),
  },
}));
