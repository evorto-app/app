export interface CoordinateLocation extends BasePhysicalLocation {
  type: 'coordinate';
}

export type EventLocation =
  | CoordinateLocation
  | GoogleLocation
  | OnlineLocation;

export interface GoogleLocation extends BasePhysicalLocation {
  placeId: string;
  type: 'google';
}

export interface OnlineLocation extends BaseLocation {
  meetingInstructions?: string;
  meetingProvider: 'googleMeet' | 'other' | 'teams' | 'zoom';
  meetingUrl: string;
  type: 'online';
}

interface BaseLocation {
  name: string;
}

interface BasePhysicalLocation extends BaseLocation {
  address?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}
