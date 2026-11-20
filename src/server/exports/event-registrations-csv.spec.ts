import { describe, expect, it } from '@effect/vitest';

import {
  buildEventRegistrationsCsvRows,
  type EventRegistrationsCsvOption,
  type EventRegistrationsCsvQuestion,
  type EventRegistrationsCsvRegistration,
  formatCheckInTime,
  registrationsContentDisposition,
  slugifyFileName,
} from './event-registrations-csv';

const options: EventRegistrationsCsvOption[] = [
  { id: 'o-part-b', organizingRegistration: false, title: 'Participant B' },
  { id: 'o-part-a', organizingRegistration: false, title: 'Participant A' },
  { id: 'o-org', organizingRegistration: true, title: 'Zeta organizers' },
];

const registration = (
  overrides: Partial<EventRegistrationsCsvRegistration>,
): EventRegistrationsCsvRegistration => ({
  answers: [],
  checkInTime: null,
  email: 'a@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  registrationOptionId: 'o-part-a',
  status: 'CONFIRMED',
  ...overrides,
});

const build = (
  input: Partial<Parameters<typeof buildEventRegistrationsCsvRows>[0]> = {},
) =>
  buildEventRegistrationsCsvRows({
    options,
    questions: [],
    registrations: [],
    timeZone: 'Europe/Berlin',
    ...input,
  });

describe('buildEventRegistrationsCsvRows', () => {
  it('emits only the fixed header without registrations or questions', () => {
    expect(build()).toEqual([
      [
        'First name',
        'Last name',
        'Email',
        'Registration option',
        'Organizer',
        'Status',
        'Checked in',
        'Check-in time',
      ],
    ]);
  });

  it('renders labels, Yes/No flags and the tenant-timezone check-in time', () => {
    const rows = build({
      registrations: [
        registration({
          checkInTime: new Date('2026-09-15T10:05:00Z'),
          registrationOptionId: 'o-org',
        }),
        registration({
          firstName: 'Bob',
          status: 'PENDING',
        }),
      ],
    });
    expect(rows[1]).toEqual([
      'Ada',
      'Lovelace',
      'a@example.com',
      'Zeta organizers',
      'Yes',
      'Confirmed',
      'Yes',
      '2026-09-15 12:05',
    ]);
    expect(rows[2]).toEqual([
      'Bob',
      'Lovelace',
      'a@example.com',
      'Participant A',
      'No',
      'Pending',
      'No',
      '',
    ]);
  });

  it('orders organizer options first, then option title, last name, first name', () => {
    const rows = build({
      registrations: [
        registration({
          firstName: 'Z',
          lastName: 'Same',
          registrationOptionId: 'o-part-b',
        }),
        registration({
          firstName: 'B',
          lastName: 'Same',
          registrationOptionId: 'o-part-a',
        }),
        registration({
          firstName: 'A',
          lastName: 'Same',
          registrationOptionId: 'o-part-a',
        }),
        registration({
          firstName: 'M',
          lastName: 'Aardvark',
          registrationOptionId: 'o-part-a',
        }),
        registration({
          firstName: 'O',
          lastName: 'Zzz',
          registrationOptionId: 'o-org',
        }),
      ],
    });
    expect(rows.slice(1).map((row) => `${row[0]} ${row[1]}`)).toEqual([
      'O Zzz',
      'M Aardvark',
      'A Same',
      'B Same',
      'Z Same',
    ]);
  });

  it('adds one column per question in option, sortOrder, title order with answers', () => {
    const questions: EventRegistrationsCsvQuestion[] = [
      {
        id: 'q-b2',
        registrationOptionId: 'o-part-b',
        sortOrder: 0,
        title: 'Diet',
      },
      {
        id: 'q-a2',
        registrationOptionId: 'o-part-a',
        sortOrder: 2,
        title: 'Shirt',
      },
      {
        id: 'q-a1',
        registrationOptionId: 'o-part-a',
        sortOrder: 1,
        title: 'Allergies',
      },
      {
        id: 'q-org',
        registrationOptionId: 'o-org',
        sortOrder: 0,
        title: 'Role',
      },
    ];
    const rows = build({
      questions,
      registrations: [
        registration({
          answers: [
            { answer: 'Peanuts', questionId: 'q-a1' },
            { answer: 'M', questionId: 'q-a2' },
          ],
        }),
        registration({
          answers: [{ answer: 'Vegan', questionId: 'q-b2' }],
          firstName: 'Bea',
          registrationOptionId: 'o-part-b',
        }),
      ],
    });
    expect(rows[0]?.slice(8)).toEqual(['Role', 'Allergies', 'Shirt', 'Diet']);
    expect(rows[1]?.slice(8)).toEqual(['', 'Peanuts', 'M', '']);
    expect(rows[2]?.slice(8)).toEqual(['', '', '', 'Vegan']);
  });

  it('disambiguates duplicate question titles with the option title', () => {
    const rows = build({
      questions: [
        {
          id: 'q1',
          registrationOptionId: 'o-part-a',
          sortOrder: 0,
          title: 'Diet',
        },
        {
          id: 'q2',
          registrationOptionId: 'o-part-b',
          sortOrder: 0,
          title: 'Diet',
        },
        {
          id: 'q3',
          registrationOptionId: 'o-part-b',
          sortOrder: 1,
          title: 'Shirt',
        },
      ],
    });
    expect(rows[0]?.slice(8)).toEqual([
      'Diet (Participant A)',
      'Diet (Participant B)',
      'Shirt',
    ]);
  });
});

describe('formatCheckInTime', () => {
  it('uses the given time zone including DST and midnight', () => {
    expect(
      formatCheckInTime(new Date('2026-09-15T10:05:00Z'), 'Europe/Berlin'),
    ).toBe('2026-09-15 12:05');
    expect(
      formatCheckInTime(new Date('2026-01-15T10:05:00Z'), 'Europe/Berlin'),
    ).toBe('2026-01-15 11:05');
    expect(
      formatCheckInTime(new Date('2026-09-14T22:00:00Z'), 'Europe/Berlin'),
    ).toBe('2026-09-15 00:00');
  });
});

describe('file names', () => {
  it('slugifies to lowercase ASCII with a fallback', () => {
    expect(slugifyFileName("Müller's Café Night #3!")).toBe(
      'muller-s-cafe-night-3',
    );
    expect(slugifyFileName('  --  ')).toBe('event');
    expect(slugifyFileName('日本語')).toBe('event');
  });

  it('builds an attachment disposition with ASCII and UTF-8 names', () => {
    expect(registrationsContentDisposition('Erstsemester Käse-Abend')).toBe(
      `attachment; filename="erstsemester-kase-abend-registrations.csv"; filename*=UTF-8''Erstsemester%20K%C3%A4se-Abend-registrations.csv`,
    );
  });

  it('encodes characters that are not allowed in RFC 5987 values', () => {
    const header = registrationsContentDisposition(`Bob's "Party" (*)\r\n`);
    expect(header).not.toMatch(/[\r\n]/u);
    expect(header).toContain(
      `filename*=UTF-8''Bob%27s%20%22Party%22%20%28%2A%29-registrations.csv`,
    );
  });
});
