import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';

import { Database } from '../../../../../db';
import { createRegistrationDatabaseTestLayer } from '../../../../testing/registration-database';
import {
  getRequiredTemplateRole,
  loadTemplateGraphDetail,
  templateGraphNotFoundError,
} from './template-graph.query';

const readSource = (file: string) =>
  readFileSync(new URL(file, import.meta.url), 'utf8');

describe('tenant template graph query source guards', () => {
  it('scopes the root and every child query through the target tenant', () => {
    const source = readSource('template-graph.query.ts');

    expect(source).toContain('eq(eventTemplates.tenantId, tenantId)');
    expect(source).toContain('eq(roles.tenantId, tenantId)');
    expect(
      source.match(/eq\(eventTemplates\.tenantId, tenantId\)/g),
    ).toHaveLength(6);
    expect(source).not.toContain('targetTenantId');
  });

  it('is the single graph loader used by ordinary and platform handlers', () => {
    const ordinarySource = readSource('../templates.handlers.ts');
    const platformEventSource = readSource(
      '../platform/platform-events.handlers.ts',
    );
    const platformTemplateSource = readSource(
      '../platform/platform-templates.handlers.ts',
    );

    expect(ordinarySource).toContain('loadTemplateGraphDetail');
    expect(platformEventSource).toContain('loadTemplateGraphDetail');
    expect(platformTemplateSource).toContain('loadTemplateGraphDetail');
    expect(platformTemplateSource).not.toContain('loadPlatformTemplateDetail');
  });

  it('surfaces an unresolved persisted role instead of dropping it', () => {
    const rolesById = new Map([
      ['role-found', { id: 'role-found', name: 'Found role' }],
    ]);

    expect(
      getRequiredTemplateRole({
        optionId: 'option-1',
        roleId: 'role-found',
        rolesById,
        templateId: 'template-1',
      }),
    ).toEqual({ id: 'role-found', name: 'Found role' });
    expect(() =>
      getRequiredTemplateRole({
        optionId: 'option-1',
        roleId: 'role-missing',
        rolesById,
        templateId: 'template-1',
      }),
    ).toThrowError(
      'Persisted template template-1 registration option option-1 references missing tenant role role-missing',
    );
  });

  it('does not expose template identifiers or storage scope when a template is missing', () => {
    const error = templateGraphNotFoundError();

    expect(templateGraphNotFoundError).toHaveLength(0);
    expect(error.message).toBe(
      'This template no longer exists in this organization. No changes were made. Return to Templates and choose an existing template.',
    );
    expect(error.message).not.toMatch(/\b(?:id|tenant|target)\b/iu);
  });
});

describe('template graph rich-text reads', () => {
  it.effect(
    'removes persisted tracking images before ordinary or platform clients receive HTML',
    () => {
      const image =
        '<img src="https://tracking.example/pixel" onerror="alert(1)">';
      const database = createRegistrationDatabaseTestLayer({
        executeValues: (statement) =>
          Effect.sync(() => {
            if (statement.includes(' from "event_templates"')) {
              return [
                [
                  'category-1',
                  `<p>Template details</p>${image}`,
                  JSON.stringify({ iconColor: 0, iconName: 'ticket' }),
                  'template-1',
                  null,
                  null,
                  false,
                  'Trip',
                ],
              ];
            }
            if (statement.includes(' from "template_registration_options"')) {
              return [
                [
                  null,
                  0,
                  `<p>Choice details</p>${image}`,
                  'option-1',
                  false,
                  48,
                  false,
                  0,
                  false,
                  `<p>Ticket details</p>${image}`,
                  'fcfs',
                  [],
                  10,
                  null,
                  'Attendee',
                  null,
                ],
                [
                  null,
                  0,
                  image,
                  'option-2',
                  false,
                  48,
                  true,
                  0,
                  false,
                  null,
                  'fcfs',
                  [],
                  10,
                  null,
                  'Organizer',
                  null,
                ],
              ];
            }
            if (
              [
                'template_registration_option_discounts',
                'template_registration_questions',
                'template_event_addons',
              ].some((table) => statement.includes(` from "${table}"`))
            )
              return [];
            throw new Error(`Unexpected template query: ${statement}`);
          }),
      });
      return Database.use((connection) =>
        loadTemplateGraphDetail(connection, 'tenant-1', 'template-1'),
      ).pipe(
        Effect.provide(database),
        Effect.tap((template) =>
          Effect.sync(() => {
            expect(template.description).toBe('<p>Template details</p>');
            expect(template.registrationOptions[0]).toMatchObject({
              description: '<p>Choice details</p>',
              registeredDescription: '<p>Ticket details</p>',
            });
            expect(template.registrationOptions[1]).toMatchObject({
              description: null,
              registeredDescription: null,
            });
            expect(JSON.stringify(template)).not.toContain('tracking.example');
          }),
        ),
      );
    },
  );
});
