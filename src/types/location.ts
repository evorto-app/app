import { Schema } from 'effect';

const BaseLocation = Schema.Struct({
  name: Schema.String,
});

const BasePhysicalLocation = Schema.extend(
  BaseLocation,
  Schema.Struct({
    address: Schema.optional(Schema.String),
    coordinates: Schema.Struct({
      lat: Schema.Number,
      lng: Schema.Number,
    }),
  })
);

export const CoordinateLocation = Schema.extend(
  BasePhysicalLocation,
  Schema.Struct({
    type: Schema.Literal('coordinate'),
  })
);

export const GoogleLocation = Schema.extend(
  BasePhysicalLocation,
  Schema.Struct({
    placeId: Schema.String,
    type: Schema.Literal('google'),
  })
);

export const OnlineLocation = Schema.extend(
  BaseLocation,
  Schema.Struct({
    meetingInstructions: Schema.optional(Schema.String),
    meetingProvider: Schema.Union(
      Schema.Literal('googleMeet'),
      Schema.Literal('other'),
      Schema.Literal('teams'),
      Schema.Literal('zoom')
    ),
    meetingUrl: Schema.String,
    type: Schema.Literal('online'),
  })
);

export const EventLocation = Schema.Union(
  CoordinateLocation,
  GoogleLocation,
  OnlineLocation
);

export type CoordinateLocationType = typeof CoordinateLocation.Type;
export type EventLocationType = typeof EventLocation.Type;
export type GoogleLocationType = typeof GoogleLocation.Type;
export type OnlineLocationType = typeof OnlineLocation.Type;