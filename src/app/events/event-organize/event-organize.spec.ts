import { describe, expect, it } from 'vitest';

import { computeEventOrganizeStats } from './event-organize';

describe('computeEventOrganizeStats', () => {
  it('sums capacity, confirmed registrations, and scanner-updated checked-in spots', () => {
    expect(
      computeEventOrganizeStats({
        registrationOptions: [
          {
            checkedInSpots: 3,
            confirmedSpots: 5,
            spots: 10,
          },
          {
            checkedInSpots: 2,
            confirmedSpots: 4,
            spots: 8,
          },
        ],
      }),
    ).toEqual({
      capacity: 18,
      capacityPercentage: 0.5,
      checkedIn: 5,
      registered: 9,
    });
  });

  it('keeps empty organizer stats stable before the event query resolves', () => {
    expect(computeEventOrganizeStats()).toEqual({
      capacity: 0,
      capacityPercentage: 0,
      checkedIn: 0,
      registered: 0,
    });
  });
});
