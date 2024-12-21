import { drizzle } from 'drizzle-orm/neon-http';
import * as globalEnums from './schema/globalEnums';
import * as tenantTables from './schema/tenantTables';
import * as eventTemplates from './schema/eventTemplates';
import * as eventTemplateCategories from './schema/eventTemplateCategories';
import * as relations from './schema/relations';
import * as userTables from './schema/userTables';
import * as roles from './schema/roles';
import * as icons from './schema/icons';
import * as templateEventAddons from './schema/templateEventAddons';
import * as templateRegistrationOptions from './schema/templateRegistrationOptions';
import * as templateRegistrationOptionDiscounts from './schema/templateRegistrationOptionDiscounts';

export const db = drizzle(process.env['DATABASE_URL']!, {
  schema: {
    ...globalEnums,
    ...tenantTables,
    ...eventTemplates,
    ...eventTemplateCategories,
    ...relations,
    ...userTables,
    ...roles,
    ...icons,
    ...templateEventAddons,
    ...templateRegistrationOptions,
    ...templateRegistrationOptionDiscounts,
  },
});
