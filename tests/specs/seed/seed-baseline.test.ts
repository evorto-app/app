import { expect, test } from '../../support/fixtures/parallel-test';

const requireSeededEvent = <T>(event: T | undefined, handleName: string): T => {
  if (!event) {
    throw new Error(`Expected seeded scenario event "${handleName}" to exist`);
  }

  return event;
};

const requireSeededOption = <T>(
  option: T | undefined,
  handleName: string,
): T => {
  if (!option) {
    throw new Error(
      `Expected seeded scenario registration option "${handleName}" to exist`,
    );
  }

  return option;
};

// This particular test validates seeded invariants and can take longer
// due to initial database seeding. Keep the override local to this file.
test.setTimeout(120_000);

test.describe('baseline seed invariants', () => {
  test('tenant, categories, roles, templates, and events are seeded for relaunch flows', async ({
    seeded,
    tenant,
    templateCategories,
    templates,
    events,
    roles,
    registrations,
    seedDate,
  }) => {
    expect.soft(tenant.id).toBeTruthy();
    expect.soft(tenant.domain).toBeTruthy();

    expect.soft(templateCategories.length).toBeGreaterThanOrEqual(2);
    expect.soft(roles.some((role) => role.defaultUserRole)).toBeTruthy();
    expect.soft(roles.some((role) => role.defaultOrganizerRole)).toBeTruthy();

    expect
      .soft(new Set(templates.map((template) => template.seedKey)))
      .toEqual(
        new Set([
          'city-tour',
          'city-trip',
          'example-config',
          'hike',
          'sports',
          'weekend-trip',
        ]),
      );
    expect.soft(templates.every((template) => template.icon)).toBeTruthy();
    const seededAddOns = templates.flatMap((template) => template.addOns);
    expect.soft(seededAddOns.length).toBeGreaterThanOrEqual(2);
    expect.soft(seededAddOns.some((addOn) => addOn.isPaid)).toBeTruthy();
    expect.soft(seededAddOns.some((addOn) => !addOn.isPaid)).toBeTruthy();
    expect
      .soft(
        seededAddOns.every((addOn) => addOn.registrationOptionIds.length > 0),
      )
      .toBeTruthy();
    expect
      .soft(
        templates.every(
          (template) =>
            template.questions === undefined ||
            template.questions.every(Boolean),
        ),
      )
      .toBe(true);
    const seededQuestions = templates.flatMap((template) =>
      (template.questions ?? []).filter((question) => question !== undefined),
    );
    if (seededQuestions.length > 0) {
      expect
        .soft(seededQuestions.some((question) => question.required))
        .toBe(true);
      expect
        .soft(seededQuestions.some((question) => !question.required))
        .toBe(true);
      expect
        .soft(
          seededQuestions.every((question) => question.registrationOptionId),
        )
        .toBeTruthy();
      expect
        .soft(
          seededQuestions.some(
            (question) => question.registrationOptionKind === 'participant',
          ),
        )
        .toBe(true);
      expect
        .soft(
          seededQuestions.some(
            (question) => question.registrationOptionKind === 'organizer',
          ),
        )
        .toBe(true);
    }

    expect(events.length).toBeGreaterThan(0);
    const allOptions = events.flatMap((e) => e.registrationOptions);
    expect.soft(allOptions.some((o) => o.isPaid === true)).toBeTruthy();
    expect.soft(allOptions.some((o) => o.isPaid === false)).toBeTruthy();
    expect.soft(allOptions.some((o) => o.organizingRegistration)).toBeTruthy();
    expect.soft(allOptions.some((o) => !o.organizingRegistration)).toBeTruthy();
    expect
      .soft(
        allOptions
          .filter((option) => option.isPaid)
          .every((option) => option.stripeTaxRateId),
      )
      .toBeTruthy();

    expect
      .soft(events.some((event) => event.status === 'APPROVED'))
      .toBeTruthy();
    expect.soft(events.some((event) => event.status === 'DRAFT')).toBeTruthy();
    expect.soft(events.some((event) => event.unlisted)).toBeTruthy();

    const eventById = new Map(events.map((event) => [event.id, event]));
    const optionById = new Map(
      events.flatMap((event) =>
        event.registrationOptions.map((option) => [option.id, option] as const),
      ),
    );
    const scenario = seeded.scenario.events;
    const freeOpenOption = requireSeededOption(
      optionById.get(scenario.freeOpen.optionId),
      'freeOpen',
    );
    const paidOpenOption = requireSeededOption(
      optionById.get(scenario.paidOpen.optionId),
      'paidOpen',
    );
    const closedOption = requireSeededOption(
      optionById.get(scenario.closedReg.optionId),
      'closedReg',
    );
    const draftEvent = requireSeededEvent(
      eventById.get(scenario.draft.eventId),
      'draft',
    );
    const pastEvent = requireSeededEvent(
      eventById.get(scenario.past.eventId),
      'past',
    );

    expect.soft(freeOpenOption.isPaid).toBe(false);
    expect.soft(paidOpenOption.isPaid).toBe(true);
    expect.soft(paidOpenOption.stripeTaxRateId).toBeTruthy();
    expect
      .soft(closedOption.closeRegistrationTime.getTime())
      .toBeLessThan(seedDate.getTime());
    expect.soft(draftEvent.status).toBe('DRAFT');
    expect.soft(pastEvent.start.getTime()).toBeLessThan(seedDate.getTime());

    expect
      .soft(
        registrations.some(
          (registration) => registration.status === 'CONFIRMED',
        ),
      )
      .toBeTruthy();
  });
});
