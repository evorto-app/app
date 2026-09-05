import { describe, expect, it } from '@effect/vitest';

import {
  attachSeedKeysById,
  requireSeedTemplateOption,
  type SeedTemplate,
} from './add-templates';

const templates: Pick<SeedTemplate, 'id' | 'seedKey'>[] = [
  { id: 'hike-template', seedKey: 'hike' },
  { id: 'sports-template', seedKey: 'sports' },
  { id: 'weekend-template', seedKey: 'weekend-trip' },
];
const fixtures = [
  {
    description: 'Packed lunch add-on',
    registrationOptionId: 'hike-participant',
    seedKey: 'hike',
    templateId: 'hike-template',
  },
  {
    description: 'Equipment rental add-on',
    registrationOptionId: 'sports-participant',
    seedKey: 'sports',
    templateId: 'sports-template',
  },
  {
    description: 'Participant hiking question',
    registrationOptionId: 'hike-participant',
    seedKey: 'hike',
    templateId: 'hike-template',
  },
  {
    description: 'Organizer weekend-trip question',
    registrationOptionId: 'weekend-organizer',
    seedKey: 'weekend-trip',
    templateId: 'weekend-template',
  },
] as const;

describe('required template seed fixtures', () => {
  it.each(fixtures)('resolves the declared $description option', (fixture) => {
    expect(
      requireSeedTemplateOption({
        description: fixture.description,
        registrationOptions: new Map([
          [fixture.templateId, { id: fixture.registrationOptionId }],
        ]),
        seedKey: fixture.seedKey,
        templates,
      }),
    ).toEqual({
      registrationOptionId: fixture.registrationOptionId,
      templateId: fixture.templateId,
    });
  });

  it.each(fixtures)(
    'rejects a missing template for $description',
    (fixture) => {
      expect(() =>
        requireSeedTemplateOption({
          description: fixture.description,
          registrationOptions: new Map(),
          seedKey: fixture.seedKey,
          templates: templates.filter(
            (template) => template.id !== fixture.templateId,
          ),
        }),
      ).toThrow(
        `Missing declared seed fixture: ${fixture.description} template (${fixture.seedKey})`,
      );
    },
  );

  it.each(fixtures)(
    'rejects a missing registration option for $description',
    (fixture) => {
      expect(() =>
        requireSeedTemplateOption({
          description: fixture.description,
          registrationOptions: new Map(),
          seedKey: fixture.seedKey,
          templates,
        }),
      ).toThrow(
        `Missing declared seed fixture: ${fixture.description} registration option (${fixture.seedKey})`,
      );
    },
  );

  it('rejects an option whose generated id is missing', () => {
    expect(() =>
      requireSeedTemplateOption({
        description: 'Packed lunch add-on',
        registrationOptions: new Map([['hike-template', {}]]),
        seedKey: 'hike',
        templates,
      }),
    ).toThrow(
      'Missing declared seed fixture: Packed lunch add-on registration option (hike)',
    );
  });
});

describe('template seed metadata', () => {
  it('matches seed keys by preassigned id when inserted rows are reordered', () => {
    expect(
      attachSeedKeysById(
        [{ id: 'template-2' }, { id: 'template-1' }],
        [
          { id: 'template-1', seedKey: 'first' },
          { id: 'template-2', seedKey: 'second' },
        ],
        'test',
      ),
    ).toEqual([
      { id: 'template-2', seedKey: 'second' },
      { id: 'template-1', seedKey: 'first' },
    ]);
  });

  it('rejects incomplete and unrecognized inserted template rows', () => {
    expect(() =>
      attachSeedKeysById(
        [{ id: 'template-1' }],
        [
          { id: 'template-1', seedKey: 'first' },
          { id: 'template-2', seedKey: 'second' },
        ],
        'test',
      ),
    ).toThrow('Expected 2 created test templates, received 1');

    expect(() =>
      attachSeedKeysById(
        [{ id: 'template-other' }, { id: 'template-1' }],
        [
          { id: 'template-1', seedKey: 'first' },
          { id: 'template-2', seedKey: 'second' },
        ],
        'test',
      ),
    ).toThrow(
      'Missing declared seed fixture: seed key for test template template-other',
    );

    expect(() =>
      attachSeedKeysById(
        [{ id: 'template-1' }, { id: 'template-1' }],
        [
          { id: 'template-1', seedKey: 'first' },
          { id: 'template-2', seedKey: 'second' },
        ],
        'test',
      ),
    ).toThrow('Created test templates contain duplicate ids');
  });
});
