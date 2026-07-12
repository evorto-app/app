import { AdminRpcs } from './admin.rpcs';
import { ConfigRpcs } from './config.rpcs';
import { DiscountsRpcs } from './discounts.rpcs';
import { EventsRpcs } from './events.rpcs';
import { FinanceRpcs } from './finance.rpcs';
import { GlobalAdminRpcs } from './global-admin.rpcs';
import { IconsRpcs } from './icons.rpcs';
import { OnboardingRpcs } from './onboarding.rpcs';
import { PlatformEventsRpcs } from './platform-events.rpcs';
import { PlatformTenantAdminRpcs } from './platform-tenant-admin.rpcs';
import { PlatformTenantFinanceRpcs } from './platform-tenant-finance.rpcs';
import { RegistrationTransfersRpcs } from './registration-transfers.rpcs';
import { RolesRpcs } from './roles.rpcs';
import { TaxRatesRpcs } from './tax-rates.rpcs';
import { TemplateCategoriesRpcs } from './template-categories.rpcs';
import { TemplatesRpcs } from './templates.rpcs';
import { UsersRpcs } from './users.rpcs';

const AppRpcsBase = ConfigRpcs.merge(
  AdminRpcs,
  DiscountsRpcs,
  EventsRpcs,
  FinanceRpcs,
  GlobalAdminRpcs,
  IconsRpcs,
  OnboardingRpcs,
  PlatformEventsRpcs,
  PlatformTenantAdminRpcs,
  PlatformTenantFinanceRpcs,
  RegistrationTransfersRpcs,
  RolesRpcs,
  TaxRatesRpcs,
  TemplateCategoriesRpcs,
  TemplatesRpcs,
  UsersRpcs,
);

export class AppRpcs extends AppRpcsBase {}
