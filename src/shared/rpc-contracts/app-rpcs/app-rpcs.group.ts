import { AdminRpcs } from './admin.rpcs';
import { ConfigRpcs } from './config.rpcs';
import { DiscountsRpcs } from './discounts.rpcs';
import { EditorMediaRpcs } from './editor-media.rpcs';
import { EventsRpcs } from './events.rpcs';
import { FinanceRpcs } from './finance.rpcs';
import { GlobalAdminRpcs } from './global-admin.rpcs';
import { IconsRpcs } from './icons.rpcs';
import { TaxRatesRpcs } from './tax-rates.rpcs';
import { TemplateCategoriesRpcs } from './template-categories.rpcs';
import { TemplatesRpcs } from './templates.rpcs';
import { UsersRpcs } from './users.rpcs';

const AppRpcsBase = ConfigRpcs.merge(
  AdminRpcs,
  DiscountsRpcs,
  EditorMediaRpcs,
  EventsRpcs,
  FinanceRpcs,
  GlobalAdminRpcs,
  IconsRpcs,
  TaxRatesRpcs,
  TemplateCategoriesRpcs,
  TemplatesRpcs,
  UsersRpcs,
);

export class AppRpcs extends AppRpcsBase {}
