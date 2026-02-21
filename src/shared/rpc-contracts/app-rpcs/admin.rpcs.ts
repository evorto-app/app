import * as RpcGroup from '@effect/rpc/RpcGroup';

import { AdminRolesCreate, AdminRolesDelete, AdminRolesFindHubRoles, AdminRolesFindMany, AdminRolesFindOne, AdminRolesSearch, AdminRolesUpdate, AdminTenantImportStripeTaxRates, AdminTenantListImportedTaxRates, AdminTenantListStripeTaxRates, AdminTenantUpdateSettings } from './definitions';

export class AdminRpcs extends RpcGroup.make(
  AdminRolesCreate,
  AdminRolesDelete,
  AdminRolesFindHubRoles,
  AdminRolesFindMany,
  AdminRolesFindOne,
  AdminRolesSearch,
  AdminRolesUpdate,
  AdminTenantImportStripeTaxRates,
  AdminTenantListImportedTaxRates,
  AdminTenantListStripeTaxRates,
  AdminTenantUpdateSettings,
) {}
