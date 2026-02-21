import * as RpcGroup from '@effect/rpc/RpcGroup';

import { EventsCancelPendingRegistration, EventsCanOrganize, EventsCreate, EventsEventList, EventsFindOne, EventsFindOneForEdit, EventsGetOrganizeOverview, EventsGetPendingReviews, EventsGetRegistrationStatus, EventsRegisterForEvent, EventsRegistrationScanned, EventsReviewEvent, EventsSubmitForReview, EventsUpdate, EventsUpdateListing } from './definitions';

export class EventsRpcs extends RpcGroup.make(
  EventsCancelPendingRegistration,
  EventsCanOrganize,
  EventsCreate,
  EventsEventList,
  EventsFindOne,
  EventsFindOneForEdit,
  EventsGetOrganizeOverview,
  EventsGetPendingReviews,
  EventsGetRegistrationStatus,
  EventsRegisterForEvent,
  EventsRegistrationScanned,
  EventsReviewEvent,
  EventsSubmitForReview,
  EventsUpdate,
  EventsUpdateListing,
) {}
