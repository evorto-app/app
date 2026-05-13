import { extendStruct, literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';

const BaseLocation = Schema.Struct({
  name: Schema.String,
});

const BasePhysicalLocation = extendStruct(
  BaseLocation,
  Schema.Struct({
    address: Schema.optional(Schema.String),
    coordinates: Schema.Struct({
      lat: Schema.Number,
      lng: Schema.Number,
    }),
  }),
);

export const CoordinateLocation = extendStruct(
  BasePhysicalLocation,
  Schema.Struct({
    type: Schema.Literal('coordinate'),
  }),
);

export const GoogleLocation = extendStruct(
  BasePhysicalLocation,
  Schema.Struct({
    placeId: Schema.String,
    type: Schema.Literal('google'),
  }),
);

export const OnlineLocation = extendStruct(
  BaseLocation,
  Schema.Struct({
    meetingInstructions: Schema.optional(Schema.String),
    meetingProvider: literalUnion('googleMeet', 'other', 'teams', 'zoom'),
    meetingUrl: Schema.String,
    type: Schema.Literal('online'),
  }),
);

export const EventLocation = Schema.Union([
  CoordinateLocation,
  GoogleLocation,
  OnlineLocation,
]);

export type CoordinateLocationType = typeof CoordinateLocation.Type;
export type EventLocationType = typeof EventLocation.Type;
export type GoogleLocationType = typeof GoogleLocation.Type;
export type OnlineLocationType = typeof OnlineLocation.Type;
