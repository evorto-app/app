import * as Rpc from '@effect/rpc/Rpc';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { Tenant } from '../../../types/custom/tenant';
import { User } from '../../../types/custom/user';
import { PermissionSchema } from '../../permissions/permissions';
import { iconSchema } from '../../types/icon';

export const PublicConfig = Schema.Struct({
  googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
  sentryDsn: Schema.NullOr(Schema.NonEmptyString),
});

export type PublicConfig = Schema.Schema.Type<typeof PublicConfig>;

export const ConfigPermissions = Schema.Array(PermissionSchema);

export type ConfigPermissions = Schema.Schema.Type<typeof ConfigPermissions>;

export const ConfigPublic = asRpcQuery(
  Rpc.make('config.public', {
    payload: Schema.Void,
    success: PublicConfig,
  }),
);

export const ConfigIsAuthenticated = asRpcQuery(
  Rpc.make('config.isAuthenticated', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

export const ConfigPermissionList = asRpcQuery(
  Rpc.make('config.permissions', {
    payload: Schema.Void,
    success: ConfigPermissions,
  }),
);

export const ConfigTenant = asRpcQuery(
  Rpc.make('config.tenant', {
    payload: Schema.Void,
    success: Tenant,
  }),
);

export const AdminRoleRpcError = Schema.Literal(
  'FORBIDDEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type AdminRoleRpcError = Schema.Schema.Type<typeof AdminRoleRpcError>;

export const AdminRoleRecord = Schema.Struct({
  collapseMembersInHup: Schema.Boolean,
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  displayInHub: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(PermissionSchema)),
  showInHub: Schema.Boolean,
  sortOrder: Schema.Number,
});

export type AdminRoleRecord = Schema.Schema.Type<typeof AdminRoleRecord>;

export const AdminRolesFindManyInput = Schema.Struct({
  defaultOrganizerRole: Schema.optional(Schema.Boolean),
  defaultUserRole: Schema.optional(Schema.Boolean),
});

export type AdminRolesFindManyInput = Schema.Schema.Type<
  typeof AdminRolesFindManyInput
>;

export const AdminRolesFindMany = asRpcQuery(
  Rpc.make('admin.roles.findMany', {
    error: AdminRoleRpcError,
    payload: AdminRolesFindManyInput,
    success: Schema.Array(AdminRoleRecord),
  }),
);

export const AdminRolesFindOne = asRpcQuery(
  Rpc.make('admin.roles.findOne', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: AdminRoleRecord,
  }),
);

export const AdminHubRoleUserRecord = Schema.Struct({
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
});

export type AdminHubRoleUserRecord = Schema.Schema.Type<
  typeof AdminHubRoleUserRecord
>;

export const AdminHubRoleRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  name: Schema.String,
  userCount: Schema.Number,
  users: Schema.Array(AdminHubRoleUserRecord),
});

export type AdminHubRoleRecord = Schema.Schema.Type<typeof AdminHubRoleRecord>;

export const AdminRolesFindHubRoles = asRpcQuery(
  Rpc.make('admin.roles.findHubRoles', {
    error: AdminRoleRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminHubRoleRecord),
  }),
);

export const AdminRolesCreateInput = Schema.Struct({
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.NonEmptyString),
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(PermissionSchema)),
});

export type AdminRolesCreateInput = Schema.Schema.Type<
  typeof AdminRolesCreateInput
>;

export const AdminRolesCreate = asRpcMutation(
  Rpc.make('admin.roles.create', {
    error: AdminRoleRpcError,
    payload: AdminRolesCreateInput,
    success: AdminRoleRecord,
  }),
);

export const AdminRolesDelete = asRpcMutation(
  Rpc.make('admin.roles.delete', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const AdminRolesSearch = asRpcQuery(
  Rpc.make('admin.roles.search', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      search: Schema.String,
    }),
    success: Schema.Array(AdminRoleRecord),
  }),
);

export const AdminRolesUpdate = asRpcMutation(
  Rpc.make('admin.roles.update', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      defaultOrganizerRole: Schema.Boolean,
      defaultUserRole: Schema.Boolean,
      description: Schema.NullOr(Schema.NonEmptyString),
      id: Schema.NonEmptyString,
      name: Schema.NonEmptyString,
      permissions: Schema.mutable(Schema.Array(PermissionSchema)),
    }),
    success: AdminRoleRecord,
  }),
);

export const AdminTenantRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'UNAUTHORIZED',
);

export type AdminTenantRpcError = Schema.Schema.Type<
  typeof AdminTenantRpcError
>;

export const AdminTenantTaxRateRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
});

export type AdminTenantTaxRateRecord = Schema.Schema.Type<
  typeof AdminTenantTaxRateRecord
>;

export const AdminTenantStripeTaxRateRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.Number),
  state: Schema.NullOr(Schema.String),
});

export type AdminTenantStripeTaxRateRecord = Schema.Schema.Type<
  typeof AdminTenantStripeTaxRateRecord
>;

export const AdminTenantImportStripeTaxRates = asRpcMutation(
  Rpc.make('admin.tenant.importStripeTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Struct({
      ids: Schema.Array(Schema.NonEmptyString),
    }),
    success: Schema.Void,
  }),
);

export const AdminTenantListImportedTaxRates = asRpcQuery(
  Rpc.make('admin.tenant.listImportedTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminTenantTaxRateRecord),
  }),
);

export const AdminTenantListStripeTaxRates = asRpcQuery(
  Rpc.make('admin.tenant.listStripeTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminTenantStripeTaxRateRecord),
  }),
);

export const AdminTenantUpdateSettings = asRpcMutation(
  Rpc.make('admin.tenant.updateSettings', {
    error: AdminTenantRpcError,
    payload: Schema.Struct({
      allowOther: Schema.Boolean,
      buyEsnCardUrl: Schema.optional(Schema.String),
      defaultLocation: Schema.NullOr(Schema.Any),
      esnCardEnabled: Schema.Boolean,
      receiptCountries: Schema.Array(Schema.NonEmptyString),
      theme: Schema.mutable(Schema.Literal('evorto', 'esn')),
    }),
    success: Tenant,
  }),
);

export const TaxRatesRpcError = Schema.Literal('FORBIDDEN');

export type TaxRatesRpcError = Schema.Schema.Type<typeof TaxRatesRpcError>;

export const TaxRatesListActiveRecord = Schema.Struct({
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
});

export type TaxRatesListActiveRecord = Schema.Schema.Type<
  typeof TaxRatesListActiveRecord
>;

export const TaxRatesListActive = asRpcQuery(
  Rpc.make('taxRates.listActive', {
    error: TaxRatesRpcError,
    payload: Schema.Void,
    success: Schema.Array(TaxRatesListActiveRecord),
  }),
);

export const DiscountsRpcError = Schema.Literal('UNAUTHORIZED');

export type DiscountsRpcError = Schema.Schema.Type<typeof DiscountsRpcError>;

export const DiscountProviderRecord = Schema.Struct({
  config: Schema.Struct({
    buyEsnCardUrl: Schema.optional(Schema.NonEmptyString),
  }),
  status: Schema.Literal('disabled', 'enabled'),
  type: Schema.Literal('esnCard'),
});

export type DiscountProviderRecord = Schema.Schema.Type<
  typeof DiscountProviderRecord
>;

export const DiscountsGetTenantProviders = asRpcQuery(
  Rpc.make('discounts.getTenantProviders', {
    error: DiscountsRpcError,
    payload: Schema.Void,
    success: Schema.Array(DiscountProviderRecord),
  }),
);

export const DiscountsGetMyCards = asRpcQuery(
  Rpc.make('discounts.getMyCards', {
    error: DiscountsRpcError,
    payload: Schema.Void,
    success: Schema.Array(
      Schema.Struct({
        id: Schema.NonEmptyString,
        identifier: Schema.NonEmptyString,
        status: Schema.Literal('expired', 'invalid', 'unverified', 'verified'),
        type: Schema.Literal('esnCard'),
        validTo: Schema.NullOr(Schema.String),
      }),
    ),
  }),
);

export const DiscountsCardMutationError = Schema.Literal(
  'BAD_REQUEST',
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type DiscountsCardMutationError = Schema.Schema.Type<
  typeof DiscountsCardMutationError
>;

const DiscountsCardTypeInput = Schema.Struct({
  type: Schema.Literal('esnCard'),
});

export const DiscountsDeleteMyCard = asRpcMutation(
  Rpc.make('discounts.deleteMyCard', {
    error: DiscountsCardMutationError,
    payload: DiscountsCardTypeInput,
    success: Schema.Void,
  }),
);

export const DiscountsRefreshMyCard = asRpcMutation(
  Rpc.make('discounts.refreshMyCard', {
    error: DiscountsCardMutationError,
    payload: DiscountsCardTypeInput,
    success: Schema.Struct({
      id: Schema.NonEmptyString,
      identifier: Schema.NonEmptyString,
      status: Schema.Literal('expired', 'invalid', 'unverified', 'verified'),
      type: Schema.Literal('esnCard'),
      validTo: Schema.NullOr(Schema.String),
    }),
  }),
);

export const DiscountsUpsertMyCard = asRpcMutation(
  Rpc.make('discounts.upsertMyCard', {
    error: DiscountsCardMutationError,
    payload: Schema.Struct({
      identifier: Schema.NonEmptyString,
      type: Schema.Literal('esnCard'),
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
      identifier: Schema.NonEmptyString,
      status: Schema.Literal('expired', 'invalid', 'unverified', 'verified'),
      type: Schema.Literal('esnCard'),
      validTo: Schema.NullOr(Schema.String),
    }),
  }),
);

export const EditorMediaRpcError = Schema.Literal(
  'BAD_REQUEST',
  'INTERNAL_SERVER_ERROR',
  'UNAUTHORIZED',
);

export type EditorMediaRpcError = Schema.Schema.Type<
  typeof EditorMediaRpcError
>;

export const EditorMediaCreateImageDirectUpload = asRpcMutation(
  Rpc.make('editorMedia.createImageDirectUpload', {
    error: EditorMediaRpcError,
    payload: Schema.Struct({
      fileName: Schema.NonEmptyString,
      fileSizeBytes: Schema.Number.pipe(Schema.nonNegative()),
      mimeType: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      deliveryUrl: Schema.NonEmptyString,
      imageId: Schema.NonEmptyString,
      uploadUrl: Schema.NonEmptyString,
    }),
  }),
);

export const GlobalAdminRpcError = Schema.Literal('UNAUTHORIZED');

export type GlobalAdminRpcError = Schema.Schema.Type<
  typeof GlobalAdminRpcError
>;

export const GlobalAdminTenantRecord = Schema.Struct({
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export type GlobalAdminTenantRecord = Schema.Schema.Type<
  typeof GlobalAdminTenantRecord
>;

export const GlobalAdminTenantsFindMany = asRpcQuery(
  Rpc.make('globalAdmin.tenants.findMany', {
    error: GlobalAdminRpcError,
    payload: Schema.Void,
    success: Schema.Array(GlobalAdminTenantRecord),
  }),
);

export const EventsRpcError = Schema.Literal('UNAUTHORIZED');

export type EventsRpcError = Schema.Schema.Type<typeof EventsRpcError>;

export const EventsReviewRpcError = Schema.Literal('FORBIDDEN', 'UNAUTHORIZED');

export type EventsReviewRpcError = Schema.Schema.Type<
  typeof EventsReviewRpcError
>;

export const EventReviewStatus = Schema.Literal(
  'APPROVED',
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
);

export type EventReviewStatus = Schema.Schema.Type<typeof EventReviewStatus>;

export const EventsCanOrganize = asRpcQuery(
  Rpc.make('events.canOrganize', {
    error: EventsRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Boolean,
  }),
);

export const EventsCancelPendingRegistrationError = Schema.Literal(
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsCancelPendingRegistrationError = Schema.Schema.Type<
  typeof EventsCancelPendingRegistrationError
>;

export const EventsCancelPendingRegistration = asRpcMutation(
  Rpc.make('events.cancelPendingRegistration', {
    error: EventsCancelPendingRegistrationError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsCreateRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'UNAUTHORIZED',
);

export type EventsCreateRpcError = Schema.Schema.Type<
  typeof EventsCreateRpcError
>;

export const EventsCreateRegistrationOptionInput = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number.pipe(Schema.nonNegative()),
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: Schema.Literal('application', 'fcfs', 'random'),
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number.pipe(Schema.nonNegative()),
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
});

export const EventsCreate = asRpcMutation(
  Rpc.make('events.create', {
    error: EventsCreateRpcError,
    payload: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      registrationOptions: Schema.Array(EventsCreateRegistrationOptionInput),
      start: Schema.NonEmptyString,
      templateId: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const EventsEventListRpcError = Schema.Literal('FORBIDDEN');

export type EventsEventListRpcError = Schema.Schema.Type<
  typeof EventsEventListRpcError
>;

export const EventsEventListInput = Schema.Struct({
  includeUnlisted: Schema.optional(Schema.Boolean),
  limit: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
    default: () => 100,
  }),
  offset: Schema.optionalWith(Schema.Number.pipe(Schema.nonNegative()), {
    default: () => 0,
  }),
  startAfter: Schema.optionalWith(Schema.NonEmptyString, {
    default: () => new Date().toISOString(),
  }),
  status: Schema.optionalWith(Schema.Array(EventReviewStatus), {
    default: () => [],
  }),
  userId: Schema.optional(Schema.NonEmptyString),
});

export type EventsEventListInput = Schema.Schema.Type<
  typeof EventsEventListInput
>;

export const EventsEventListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  start: Schema.NonEmptyString,
  status: EventReviewStatus,
  title: Schema.NonEmptyString,
  unlisted: Schema.Boolean,
  userIsCreator: Schema.Boolean,
  userRegistered: Schema.Boolean,
});

export type EventsEventListRecord = Schema.Schema.Type<
  typeof EventsEventListRecord
>;

export const EventsEventListDayRecord = Schema.Struct({
  day: Schema.NonEmptyString,
  events: Schema.Array(EventsEventListRecord),
});

export type EventsEventListDayRecord = Schema.Schema.Type<
  typeof EventsEventListDayRecord
>;

export const EventsEventList = asRpcQuery(
  Rpc.make('events.eventList', {
    error: EventsEventListRpcError,
    payload: EventsEventListInput,
    success: Schema.Array(EventsEventListDayRecord),
  }),
);

export const EventsFindOneForEditRpcError = Schema.Literal(
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsFindOneForEditRpcError = Schema.Schema.Type<
  typeof EventsFindOneForEditRpcError
>;

export const EventsFindOneForEditRegistrationMode = Schema.Literal(
  'application',
  'fcfs',
  'random',
);

export const EventsFindOneForEditRegistrationOption = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.String),
  esnCardDiscountedPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: EventsFindOneForEditRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
});

export const EventsFindOneForEdit = asRpcQuery(
  Rpc.make('events.findOneForEdit', {
    error: EventsFindOneForEditRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      id: Schema.NonEmptyString,
      location: Schema.NullOr(Schema.Any),
      registrationOptions: Schema.Array(EventsFindOneForEditRegistrationOption),
      start: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
  }),
);

export const EventsFindOneRpcError = Schema.Literal('NOT_FOUND');

export type EventsFindOneRpcError = Schema.Schema.Type<
  typeof EventsFindOneRpcError
>;

export const EventsFindOneRegistrationOption = Schema.Struct({
  appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
  checkedInSpots: Schema.Number,
  closeRegistrationTime: Schema.NonEmptyString,
  confirmedSpots: Schema.Number,
  description: Schema.NullOr(Schema.String),
  discountApplied: Schema.Boolean,
  effectivePrice: Schema.Number,
  esnCardDiscountedPrice: Schema.NullOr(Schema.Number),
  eventId: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: EventsFindOneForEditRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.String),
  title: Schema.NonEmptyString,
});

export const EventsFindOne = asRpcQuery(
  Rpc.make('events.findOne', {
    error: EventsFindOneRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      creatorId: Schema.NonEmptyString,
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      icon: iconSchema,
      id: Schema.NonEmptyString,
      location: Schema.NullOr(Schema.Any),
      registrationOptions: Schema.Array(EventsFindOneRegistrationOption),
      reviewer: Schema.NullOr(
        Schema.Struct({
          firstName: Schema.String,
          lastName: Schema.String,
        }),
      ),
      start: Schema.NonEmptyString,
      status: EventReviewStatus,
      statusComment: Schema.NullOr(Schema.String),
      title: Schema.NonEmptyString,
      unlisted: Schema.Boolean,
    }),
  }),
);

export const EventsGetOrganizeOverviewUser = Schema.Struct({
  appliedDiscountedPrice: Schema.NullOr(Schema.Number),
  appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
  basePriceAtRegistration: Schema.NullOr(Schema.Number),
  checkedIn: Schema.Boolean,
  checkInTime: Schema.NullOr(Schema.String),
  discountAmount: Schema.NullOr(Schema.Number),
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  userId: Schema.NonEmptyString,
});

export const EventsGetOrganizeOverviewOption = Schema.Struct({
  organizingRegistration: Schema.Boolean,
  registrationOptionId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  users: Schema.Array(EventsGetOrganizeOverviewUser),
});

export const EventsGetOrganizeOverview = asRpcQuery(
  Rpc.make('events.getOrganizeOverview', {
    error: EventsRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Array(EventsGetOrganizeOverviewOption),
  }),
);

export const EventsRegistrationStatusRecord = Schema.Struct({
  appliedDiscountedPrice: Schema.optional(Schema.NullOr(Schema.Number)),
  appliedDiscountType: Schema.optional(
    Schema.NullOr(Schema.Literal('esnCard')),
  ),
  basePriceAtRegistration: Schema.optional(Schema.NullOr(Schema.Number)),
  checkoutUrl: Schema.optional(Schema.NullOr(Schema.String)),
  discountAmount: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.NonEmptyString,
  paymentPending: Schema.Boolean,
  registeredDescription: Schema.optional(Schema.NullOr(Schema.String)),
  registrationOptionId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  status: Schema.String,
});

export type EventsRegistrationStatusRecord = Schema.Schema.Type<
  typeof EventsRegistrationStatusRecord
>;

export const EventsGetRegistrationStatus = asRpcQuery(
  Rpc.make('events.getRegistrationStatus', {
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      isRegistered: Schema.Boolean,
      registrations: Schema.Array(EventsRegistrationStatusRecord),
    }),
  }),
);

export const EventsPendingReviewRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  start: Schema.String,
  title: Schema.NonEmptyString,
});

export type EventsPendingReviewRecord = Schema.Schema.Type<
  typeof EventsPendingReviewRecord
>;

export const EventsGetPendingReviews = asRpcQuery(
  Rpc.make('events.getPendingReviews', {
    error: EventsReviewRpcError,
    payload: Schema.Void,
    success: Schema.Array(EventsPendingReviewRecord),
  }),
);

export const EventsReviewEventRpcError = Schema.Literal(
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsReviewEventRpcError = Schema.Schema.Type<
  typeof EventsReviewEventRpcError
>;

export const EventsReviewEvent = asRpcMutation(
  Rpc.make('events.reviewEvent', {
    error: EventsReviewEventRpcError,
    payload: Schema.Struct({
      approved: Schema.Boolean,
      comment: Schema.optional(Schema.NonEmptyString),
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsRegisterForEventError = Schema.Literal(
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsRegisterForEventError = Schema.Schema.Type<
  typeof EventsRegisterForEventError
>;

export const EventsRegisterForEvent = asRpcMutation(
  Rpc.make('events.registerForEvent', {
    error: EventsRegisterForEventError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      registrationOptionId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsRegistrationScannedError = Schema.Literal(
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsRegistrationScannedError = Schema.Schema.Type<
  typeof EventsRegistrationScannedError
>;

export const EventsRegistrationScanned = asRpcQuery(
  Rpc.make('events.registrationScanned', {
    error: EventsRegistrationScannedError,
    payload: Schema.Struct({
      registrationId: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      allowCheckin: Schema.Boolean,
      appliedDiscountType: Schema.NullOr(Schema.Literal('esnCard')),
      event: Schema.Struct({
        start: Schema.NonEmptyString,
        title: Schema.NonEmptyString,
      }),
      registrationOption: Schema.Struct({
        title: Schema.NonEmptyString,
      }),
      registrationStatusIssue: Schema.Boolean,
      sameUserIssue: Schema.Boolean,
      user: Schema.Struct({
        firstName: Schema.NonEmptyString,
        lastName: Schema.NonEmptyString,
      }),
    }),
  }),
);

export const EventsSubmitForReviewRpcError = Schema.Literal(
  'CONFLICT',
  'FORBIDDEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsSubmitForReviewRpcError = Schema.Schema.Type<
  typeof EventsSubmitForReviewRpcError
>;

export const EventsSubmitForReview = asRpcMutation(
  Rpc.make('events.submitForReview', {
    error: EventsSubmitForReviewRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const EventsUpdateListingRpcError = Schema.Literal(
  'FORBIDDEN',
  'UNAUTHORIZED',
);

export type EventsUpdateListingRpcError = Schema.Schema.Type<
  typeof EventsUpdateListingRpcError
>;

export const EventsUpdateListing = asRpcMutation(
  Rpc.make('events.updateListing', {
    error: EventsUpdateListingRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
      unlisted: Schema.Boolean,
    }),
    success: Schema.Void,
  }),
);

export const EventsUpdateRpcError = Schema.Literal(
  'BAD_REQUEST',
  'CONFLICT',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type EventsUpdateRpcError = Schema.Schema.Type<
  typeof EventsUpdateRpcError
>;

export const EventsUpdateRegistrationOptionInput = Schema.Struct({
  closeRegistrationTime: Schema.NonEmptyString,
  description: Schema.NullOr(Schema.NonEmptyString),
  esnCardDiscountedPrice: Schema.optional(
    Schema.NullOr(Schema.Number.pipe(Schema.nonNegative())),
  ),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationTime: Schema.NonEmptyString,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number.pipe(Schema.nonNegative()),
  registeredDescription: Schema.NullOr(Schema.NonEmptyString),
  registrationMode: Schema.Literal('application', 'fcfs', 'random'),
  roleIds: Schema.Array(Schema.NonEmptyString),
  spots: Schema.Number.pipe(Schema.nonNegative()),
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  title: Schema.NonEmptyString,
});

export const EventsUpdate = asRpcMutation(
  Rpc.make('events.update', {
    error: EventsUpdateRpcError,
    payload: Schema.Struct({
      description: Schema.NonEmptyString,
      end: Schema.NonEmptyString,
      eventId: Schema.NonEmptyString,
      icon: iconSchema,
      location: Schema.NullOr(Schema.Any),
      registrationOptions: Schema.Array(EventsUpdateRegistrationOptionInput),
      start: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const FinanceRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type FinanceRpcError = Schema.Schema.Type<typeof FinanceRpcError>;

export const FinanceReceiptStatus = Schema.Literal(
  'approved',
  'refunded',
  'rejected',
  'submitted',
);

export const FinanceReceiptAttachmentInput = Schema.Struct({
  fileName: Schema.NonEmptyString,
  mimeType: Schema.NonEmptyString,
  sizeBytes: Schema.Number.pipe(Schema.positive()),
  storageKey: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  storageUrl: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export const FinanceReceiptFieldsInput = Schema.Struct({
  alcoholAmount: Schema.Number.pipe(Schema.nonNegative()),
  depositAmount: Schema.Number.pipe(Schema.nonNegative()),
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.NonEmptyString,
  taxAmount: Schema.Number.pipe(Schema.nonNegative()),
  totalAmount: Schema.Number.pipe(Schema.nonNegative()),
});

export const FinanceReceiptBaseRecord = Schema.Struct({
  alcoholAmount: Schema.Number,
  attachmentFileName: Schema.NonEmptyString,
  attachmentMimeType: Schema.NonEmptyString,
  attachmentStorageKey: Schema.NullOr(Schema.NonEmptyString),
  createdAt: Schema.NonEmptyString,
  depositAmount: Schema.Number,
  eventId: Schema.NonEmptyString,
  hasAlcohol: Schema.Boolean,
  hasDeposit: Schema.Boolean,
  id: Schema.NonEmptyString,
  previewImageUrl: Schema.NullOr(Schema.NonEmptyString),
  purchaseCountry: Schema.NonEmptyString,
  receiptDate: Schema.NonEmptyString,
  refundedAt: Schema.NullOr(Schema.NonEmptyString),
  refundTransactionId: Schema.NullOr(Schema.NonEmptyString),
  rejectionReason: Schema.NullOr(Schema.String),
  reviewedAt: Schema.NullOr(Schema.NonEmptyString),
  status: FinanceReceiptStatus,
  submittedByUserId: Schema.NonEmptyString,
  taxAmount: Schema.Number,
  totalAmount: Schema.Number,
  updatedAt: Schema.NonEmptyString,
});

export const FinanceReceiptWithSubmitterRecord = Schema.extend(
  FinanceReceiptBaseRecord,
  Schema.Struct({
    submittedByEmail: Schema.NonEmptyString,
    submittedByFirstName: Schema.NonEmptyString,
    submittedByLastName: Schema.NonEmptyString,
  }),
);

export const FinanceReceiptWithEventRecord = Schema.extend(
  FinanceReceiptBaseRecord,
  Schema.Struct({
    eventStart: Schema.NonEmptyString,
    eventTitle: Schema.NonEmptyString,
  }),
);

export const FinanceReceiptForApprovalRecord = Schema.extend(
  FinanceReceiptWithSubmitterRecord,
  Schema.Struct({
    eventStart: Schema.NonEmptyString,
    eventTitle: Schema.NonEmptyString,
  }),
);

export const FinanceReceiptPendingGroupRecord = Schema.Struct({
  eventId: Schema.NonEmptyString,
  eventStart: Schema.NonEmptyString,
  eventTitle: Schema.NonEmptyString,
  receipts: Schema.Array(FinanceReceiptWithSubmitterRecord),
});

export const FinanceReceiptRefundableRecord = Schema.extend(
  FinanceReceiptWithSubmitterRecord,
  Schema.Struct({
    eventStart: Schema.NonEmptyString,
    eventTitle: Schema.NonEmptyString,
    recipientIban: Schema.NullOr(Schema.NonEmptyString),
    recipientPaypalEmail: Schema.NullOr(Schema.NonEmptyString),
  }),
);

export const FinanceReceiptRefundGroupRecord = Schema.Struct({
  payout: Schema.Struct({
    iban: Schema.NullOr(Schema.NonEmptyString),
    paypalEmail: Schema.NullOr(Schema.NonEmptyString),
  }),
  receipts: Schema.Array(FinanceReceiptRefundableRecord),
  submittedByEmail: Schema.NonEmptyString,
  submittedByFirstName: Schema.NonEmptyString,
  submittedByLastName: Schema.NonEmptyString,
  submittedByUserId: Schema.NonEmptyString,
  totalAmount: Schema.Number,
});

export const FinanceReceiptsByEvent = asRpcQuery(
  Rpc.make('finance.receipts.byEvent', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      eventId: Schema.NonEmptyString,
    }),
    success: Schema.Array(FinanceReceiptWithSubmitterRecord),
  }),
);

export const FinanceReceiptsCreateRefund = asRpcMutation(
  Rpc.make('finance.receipts.createRefund', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      payoutReference: Schema.NonEmptyString,
      payoutType: Schema.Literal('iban', 'paypal'),
      receiptIds: Schema.NonEmptyArray(Schema.NonEmptyString),
    }),
    success: Schema.Struct({
      receiptCount: Schema.Number,
      totalAmount: Schema.Number,
      transactionId: Schema.NonEmptyString,
    }),
  }),
);

export const FinanceReceiptsFindOneForApproval = asRpcQuery(
  Rpc.make('finance.receipts.findOneForApproval', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: FinanceReceiptForApprovalRecord,
  }),
);

export const FinanceReceiptsMy = asRpcQuery(
  Rpc.make('finance.receipts.my', {
    error: FinanceRpcError,
    payload: Schema.Void,
    success: Schema.Array(FinanceReceiptWithEventRecord),
  }),
);

export const FinanceReceiptsPendingApprovalGrouped = asRpcQuery(
  Rpc.make('finance.receipts.pendingApprovalGrouped', {
    error: FinanceRpcError,
    payload: Schema.Void,
    success: Schema.Array(FinanceReceiptPendingGroupRecord),
  }),
);

export const FinanceReceiptsRefundableGroupedByRecipient = asRpcQuery(
  Rpc.make('finance.receipts.refundableGroupedByRecipient', {
    error: FinanceRpcError,
    payload: Schema.Void,
    success: Schema.Array(FinanceReceiptRefundGroupRecord),
  }),
);

export const FinanceReceiptsReview = asRpcMutation(
  Rpc.make('finance.receipts.review', {
    error: FinanceRpcError,
    payload: Schema.extend(
      Schema.Struct({
        id: Schema.NonEmptyString,
        rejectionReason: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
        status: Schema.Literal('approved', 'rejected'),
      }),
      FinanceReceiptFieldsInput,
    ),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
      status: FinanceReceiptStatus,
    }),
  }),
);

export const FinanceReceiptsSubmit = asRpcMutation(
  Rpc.make('finance.receipts.submit', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      attachment: FinanceReceiptAttachmentInput,
      eventId: Schema.NonEmptyString,
      fields: FinanceReceiptFieldsInput,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const FinanceReceiptMediaUploadOriginal = asRpcMutation(
  Rpc.make('finance.receiptMedia.uploadOriginal', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      fileBase64: Schema.NonEmptyString,
      fileName: Schema.NonEmptyString,
      fileSizeBytes: Schema.Number.pipe(Schema.positive()),
      mimeType: Schema.NonEmptyString,
    }),
    success: Schema.Struct({
      sizeBytes: Schema.Number.pipe(Schema.positive()),
      storageKey: Schema.NonEmptyString,
      storageUrl: Schema.NonEmptyString,
    }),
  }),
);

export const FinanceTransactionRecord = Schema.Struct({
  amount: Schema.Number,
  appFee: Schema.NullOr(Schema.Number),
  comment: Schema.NullOr(Schema.String),
  createdAt: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  method: Schema.Literal('cash', 'paypal', 'stripe', 'transfer'),
  status: Schema.Literal('cancelled', 'pending', 'successful'),
  stripeFee: Schema.NullOr(Schema.Number),
});

export const FinanceTransactionsFindMany = asRpcQuery(
  Rpc.make('finance.transactions.findMany', {
    error: FinanceRpcError,
    payload: Schema.Struct({
      limit: Schema.Number,
      offset: Schema.Number,
    }),
    success: Schema.Struct({
      data: Schema.Array(FinanceTransactionRecord),
      total: Schema.Number,
    }),
  }),
);

export const UsersUserAssigned = asRpcQuery(
  Rpc.make('users.userAssigned', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

export const UserRpcError = Schema.Literal('UNAUTHORIZED');

export type UserRpcError = Schema.Schema.Type<typeof UserRpcError>;

export const UsersAuthData = Schema.Struct({
  email: Schema.optional(Schema.NullOr(Schema.String)),
  email_verified: Schema.optional(Schema.NullOr(Schema.Boolean)),
  family_name: Schema.optional(Schema.NullOr(Schema.String)),
  given_name: Schema.optional(Schema.NullOr(Schema.String)),
  sub: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UsersAuthData = Schema.Schema.Type<typeof UsersAuthData>;

export const UsersAuthDataFind = asRpcQuery(
  Rpc.make('users.authData', {
    payload: Schema.Void,
    success: UsersAuthData,
  }),
);

export const UsersCreateAccountInput = Schema.Struct({
  communicationEmail: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
});

export type UsersCreateAccountInput = Schema.Schema.Type<
  typeof UsersCreateAccountInput
>;

export const UsersCreateAccountError = Schema.Literal(
  'CONFLICT',
  'UNAUTHORIZED',
);

export type UsersCreateAccountError = Schema.Schema.Type<
  typeof UsersCreateAccountError
>;

export const UsersCreateAccount = asRpcMutation(
  Rpc.make('users.createAccount', {
    error: UsersCreateAccountError,
    payload: UsersCreateAccountInput,
    success: Schema.Void,
  }),
);

export const UsersFindManyInput = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  search: Schema.optional(Schema.NonEmptyString),
});

export type UsersFindManyInput = Schema.Schema.Type<typeof UsersFindManyInput>;

export const UsersFindManyRecord = Schema.Struct({
  email: Schema.String,
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
  roles: Schema.Array(Schema.String),
});

export type UsersFindManyRecord = Schema.Schema.Type<
  typeof UsersFindManyRecord
>;

export const UsersFindManyResult = Schema.Struct({
  users: Schema.Array(UsersFindManyRecord),
  usersCount: Schema.Number,
});

export type UsersFindManyResult = Schema.Schema.Type<
  typeof UsersFindManyResult
>;

export const UsersFindManyError = Schema.Literal('FORBIDDEN', 'UNAUTHORIZED');

export type UsersFindManyError = Schema.Schema.Type<typeof UsersFindManyError>;

export const UsersFindMany = asRpcQuery(
  Rpc.make('users.findMany', {
    error: UsersFindManyError,
    payload: UsersFindManyInput,
    success: UsersFindManyResult,
  }),
);

export const UsersMaybeSelf = asRpcQuery(
  Rpc.make('users.maybeSelf', {
    payload: Schema.Void,
    success: Schema.NullOr(User),
  }),
);

export const UsersSelf = asRpcQuery(
  Rpc.make('users.self', {
    error: UserRpcError,
    payload: Schema.Void,
    success: User,
  }),
);

export const UsersUpdateProfileInput = Schema.Struct({
  firstName: Schema.NonEmptyString,
  iban: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  lastName: Schema.NonEmptyString,
  paypalEmail: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export type UsersUpdateProfileInput = Schema.Schema.Type<
  typeof UsersUpdateProfileInput
>;

export const UsersUpdateProfile = asRpcMutation(
  Rpc.make('users.updateProfile', {
    error: UserRpcError,
    payload: UsersUpdateProfileInput,
    success: Schema.Void,
  }),
);

export const UsersEventSummaryRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  end: Schema.String,
  id: Schema.NonEmptyString,
  start: Schema.String,
  title: Schema.NonEmptyString,
});

export type UsersEventSummaryRecord = Schema.Schema.Type<
  typeof UsersEventSummaryRecord
>;

export const UsersEventsFindMany = asRpcQuery(
  Rpc.make('users.events', {
    error: UserRpcError,
    payload: Schema.Void,
    success: Schema.Array(UsersEventSummaryRecord),
  }),
);

export const IconRpcError = Schema.Literal('INVALID_ICON_NAME', 'UNAUTHORIZED');

export type IconRpcError = Schema.Schema.Type<typeof IconRpcError>;

export const IconRecord = Schema.Struct({
  commonName: Schema.NonEmptyString,
  friendlyName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  sourceColor: Schema.NullOr(Schema.Number),
});

export type IconRecord = Schema.Schema.Type<typeof IconRecord>;

export const IconsSearch = asRpcQuery(
  Rpc.make('icons.search', {
    error: IconRpcError,
    payload: Schema.Struct({ search: Schema.String }),
    success: Schema.Array(IconRecord),
  }),
);

export const IconsAdd = asRpcMutation(
  Rpc.make('icons.add', {
    error: IconRpcError,
    payload: Schema.Struct({ icon: Schema.NonEmptyString }),
    success: Schema.Array(IconRecord),
  }),
);

export const TemplateCategoryRpcError = Schema.Literal(
  'FORBIDDEN',
  'UNAUTHORIZED',
);

export type TemplateCategoryRpcError = Schema.Schema.Type<
  typeof TemplateCategoryRpcError
>;

export const TemplateCategoryRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateCategoryRecord = Schema.Schema.Type<
  typeof TemplateCategoryRecord
>;

export const TemplateCategoriesFindMany = asRpcQuery(
  Rpc.make('templateCategories.findMany', {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplateCategoryRecord),
  }),
);

export const TemplateCategoriesCreate = asRpcMutation(
  Rpc.make('templateCategories.create', {
    error: TemplateCategoryRpcError,
    payload: Schema.Struct({
      icon: iconSchema,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const TemplateCategoriesUpdate = asRpcMutation(
  Rpc.make('templateCategories.update', {
    error: TemplateCategoryRpcError,
    payload: Schema.Struct({
      icon: iconSchema,
      id: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: TemplateCategoryRecord,
  }),
);

export const TemplateListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateListRecord = Schema.Schema.Type<typeof TemplateListRecord>;

export const TemplateSimpleRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'INTERNAL_SERVER_ERROR',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type TemplateSimpleRpcError = Schema.Schema.Type<
  typeof TemplateSimpleRpcError
>;

export const TemplateRegistrationMode = Schema.Literal(
  'application',
  'fcfs',
  'random',
);

export const TemplateSimpleRegistrationInput = Schema.Struct({
  closeRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number.pipe(Schema.nonNegative()),
  price: Schema.Number.pipe(Schema.nonNegative()),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.mutable(Schema.Array(Schema.NonEmptyString)),
  spots: Schema.Positive,
  stripeTaxRateId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export const TemplateSimpleInput = Schema.Struct({
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  location: Schema.NullOr(Schema.Any),
  organizerRegistration: TemplateSimpleRegistrationInput,
  participantRegistration: TemplateSimpleRegistrationInput,
  title: Schema.NonEmptyString,
});

export const TemplateRoleRecord = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export const TemplateRegistrationOptionRecord = Schema.Struct({
  closeRegistrationOffset: Schema.Number,
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  isPaid: Schema.Boolean,
  openRegistrationOffset: Schema.Number,
  organizingRegistration: Schema.Boolean,
  price: Schema.Number,
  registeredDescription: Schema.NullOr(Schema.String),
  registrationMode: TemplateRegistrationMode,
  roleIds: Schema.Array(Schema.NonEmptyString),
  roles: Schema.Array(TemplateRoleRecord),
  spots: Schema.Number,
  stripeTaxRateId: Schema.NullOr(Schema.NonEmptyString),
  title: Schema.NonEmptyString,
});

export const TemplateFindOneRecord = Schema.Struct({
  categoryId: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  icon: iconSchema,
  id: Schema.NonEmptyString,
  location: Schema.NullOr(Schema.Any),
  registrationOptions: Schema.Array(TemplateRegistrationOptionRecord),
  title: Schema.NonEmptyString,
});

export const TemplatesCreateSimpleTemplate = asRpcMutation(
  Rpc.make('templates.createSimpleTemplate', {
    error: TemplateSimpleRpcError,
    payload: TemplateSimpleInput,
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const TemplatesFindOne = asRpcQuery(
  Rpc.make('templates.findOne', {
    error: TemplateSimpleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: TemplateFindOneRecord,
  }),
);

export const TemplatesUpdateSimpleTemplate = asRpcMutation(
  Rpc.make('templates.updateSimpleTemplate', {
    error: TemplateSimpleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
      ...TemplateSimpleInput.fields,
    }),
    success: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
  }),
);

export const TemplatesByCategoryRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  templates: Schema.Array(TemplateListRecord),
  title: Schema.NonEmptyString,
});

export type TemplatesByCategoryRecord = Schema.Schema.Type<
  typeof TemplatesByCategoryRecord
>;

export const TemplatesGroupedByCategory = asRpcQuery(
  Rpc.make('templates.groupedByCategory', {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplatesByCategoryRecord),
  }),
);
