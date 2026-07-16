import type { EventLocationType } from '../src/types/location';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const legacyEventLocation = ({
  coordinates,
  googlePlaceId,
  googlePlaceUrl,
  isVirtual,
  name,
  onlineMeetingUrl,
}: {
  readonly coordinates: unknown;
  readonly googlePlaceId: null | string;
  readonly googlePlaceUrl?: null | string;
  readonly isVirtual: boolean;
  readonly name: string;
  readonly onlineMeetingUrl: null | string;
}): EventLocationType | null => {
  const normalizedMeetingUrl = onlineMeetingUrl?.trim();
  const normalizedPlaceId = googlePlaceId?.trim();
  const normalizedPlaceUrl = googlePlaceUrl?.trim();
  if (isVirtual) {
    const hasPhysicalCoordinates =
      coordinates !== null &&
      (!isRecord(coordinates) || Object.keys(coordinates).length > 0);
    if (hasPhysicalCoordinates) {
      throw new Error(
        `Legacy virtual location "${name}" also has physical coordinates.`,
      );
    }
    if (normalizedPlaceId || normalizedPlaceUrl) {
      throw new Error(
        `Legacy virtual location "${name}" also has Google place metadata.`,
      );
    }
    if (!normalizedMeetingUrl) {
      throw new Error(`Legacy virtual location "${name}" has no meeting URL.`);
    }
    let meetingUrl: URL;
    try {
      meetingUrl = new URL(normalizedMeetingUrl);
    } catch {
      throw new Error(
        `Legacy virtual location "${name}" has an invalid meeting URL.`,
      );
    }
    if (meetingUrl.protocol !== 'http:' && meetingUrl.protocol !== 'https:') {
      throw new Error(
        `Legacy virtual location "${name}" has an invalid meeting URL.`,
      );
    }
    return {
      meetingProvider: 'other',
      meetingUrl: meetingUrl.toString(),
      name,
      type: 'online',
    };
  }
  if (normalizedMeetingUrl) {
    throw new Error(
      `Legacy physical location "${name}" also has an online meeting URL.`,
    );
  }
  if (coordinates === null) {
    if (name.trim() || normalizedPlaceId || normalizedPlaceUrl) {
      throw new Error(
        `Legacy physical location "${name}" has no target coordinates.`,
      );
    }
    return null;
  }
  if (
    !isRecord(coordinates) ||
    typeof coordinates['lat'] !== 'number' ||
    !Number.isFinite(coordinates['lat']) ||
    typeof coordinates['lng'] !== 'number' ||
    !Number.isFinite(coordinates['lng'])
  ) {
    throw new Error(`Legacy location "${name}" has invalid coordinates.`);
  }

  const normalizedCoordinates = {
    lat: coordinates['lat'],
    lng: coordinates['lng'],
  };
  if (normalizedPlaceUrl && !normalizedPlaceId) {
    throw new Error(
      `Legacy physical location "${name}" has a Google URL without a place ID.`,
    );
  }
  return normalizedPlaceId
    ? {
        coordinates: normalizedCoordinates,
        name,
        placeId: normalizedPlaceId,
        type: 'google',
      }
    : { coordinates: normalizedCoordinates, name, type: 'coordinate' };
};
