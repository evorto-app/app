export interface EventRegistrationsCsvOption {
  id: string;
  organizingRegistration: boolean;
  title: string;
}

export interface EventRegistrationsCsvQuestion {
  id: string;
  registrationOptionId: string;
  sortOrder: number;
  title: string;
}

export interface EventRegistrationsCsvRegistration {
  answers: readonly { answer: string; questionId: string }[];
  checkInTime: Date | null;
  email: string;
  firstName: string;
  lastName: string;
  registrationOptionId: string;
  status: 'CONFIRMED' | 'PENDING';
}

const statusLabels = {
  CONFIRMED: 'Confirmed',
  PENDING: 'Pending',
} as const satisfies Record<
  EventRegistrationsCsvRegistration['status'],
  string
>;

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** Organizer options first, then by title; id keeps equal titles stable. */
const compareOptions = (
  a: EventRegistrationsCsvOption,
  b: EventRegistrationsCsvOption,
) => {
  if (a.organizingRegistration !== b.organizingRegistration) {
    return a.organizingRegistration ? -1 : 1;
  }
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
};

/** Formats an instant as `YYYY-MM-DD HH:mm` in the given IANA time zone. */
export const formatCheckInTime = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
};

/**
 * Header row plus one row per registration. Question columns follow the fixed
 * columns, one per registration question of the event.
 */
export const buildEventRegistrationsCsvRows = ({
  options,
  questions,
  registrations,
  timeZone,
}: {
  options: readonly EventRegistrationsCsvOption[];
  questions: readonly EventRegistrationsCsvQuestion[];
  registrations: readonly EventRegistrationsCsvRegistration[];
  timeZone: string;
}): string[][] => {
  const sortedOptions = options.toSorted(compareOptions);
  const optionById = new Map(options.map((option) => [option.id, option]));
  const optionRank = new Map(
    sortedOptions.map((option, index) => [option.id, index]),
  );
  const rankOf = (optionId: string) =>
    optionRank.get(optionId) ?? Number.MAX_SAFE_INTEGER;

  const sortedQuestions = questions.toSorted(
    (a, b) =>
      rankOf(a.registrationOptionId) - rankOf(b.registrationOptionId) ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  const titleCounts = new Map<string, number>();
  for (const question of sortedQuestions) {
    titleCounts.set(question.title, (titleCounts.get(question.title) ?? 0) + 1);
  }
  const questionHeaders = sortedQuestions.map((question) => {
    if ((titleCounts.get(question.title) ?? 0) < 2) {
      return question.title;
    }
    const optionTitle = optionById.get(question.registrationOptionId)?.title;
    return optionTitle ? `${question.title} (${optionTitle})` : question.title;
  });

  const sortedRegistrations = registrations.toSorted(
    (a, b) =>
      rankOf(a.registrationOptionId) - rankOf(b.registrationOptionId) ||
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName),
  );

  const header = [
    'First name',
    'Last name',
    'Email',
    'Registration option',
    'Organizer',
    'Status',
    'Checked in',
    'Check-in time',
    ...questionHeaders,
  ];

  const rows = sortedRegistrations.map((registration) => {
    const option = optionById.get(registration.registrationOptionId);
    const answersByQuestion = new Map(
      registration.answers.map((entry) => [entry.questionId, entry.answer]),
    );
    return [
      registration.firstName,
      registration.lastName,
      registration.email,
      option?.title ?? '',
      yesNo(option?.organizingRegistration ?? false),
      statusLabels[registration.status],
      yesNo(registration.checkInTime !== null),
      registration.checkInTime
        ? formatCheckInTime(registration.checkInTime, timeZone)
        : '',
      ...sortedQuestions.map(
        (question) => answersByQuestion.get(question.id) ?? '',
      ),
    ];
  });

  return [header, ...rows];
};

/** Lowercase ASCII slug for the plain `filename=` parameter. */
export const slugifyFileName = (value: string): string => {
  const slug = value
    .normalize('NFKD')
    .replaceAll(/\p{M}+/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '');
  return slug.length > 0 ? slug : 'event';
};

/** `Content-Disposition` value for the registrations download of an event. */
export const registrationsContentDisposition = (eventTitle: string): string => {
  const asciiName = `${slugifyFileName(eventTitle)}-registrations.csv`;
  const encodedName = encodeURIComponent(
    `${eventTitle.trim() || 'event'}-registrations.csv`,
  ).replaceAll(
    /['()*]/gu,
    (character) =>
      `%${(character.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
};
