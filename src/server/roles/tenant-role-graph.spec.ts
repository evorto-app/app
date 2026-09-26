import { Database } from '@db/index';
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { createRegistrationDatabaseTestLayer } from '../testing/registration-database';
import {
  ensureTenantRoleIsUnreferenced,
  uniqueTenantRoleIds,
} from './tenant-role-graph';

describe('tenant role graph concurrency boundary', () => {
  it('deduplicates role IDs before tenant-scoped validation', () => {
    expect(uniqueTenantRoleIds(['role-b', 'role-a', 'role-b'])).toEqual([
      'role-a',
      'role-b',
    ]);
  });
});

describe('tenant role announcement references', () => {
  it.effect(
    'blocks deletion when a current-tenant announcement still references the role',
    () =>
      Effect.gen(function* () {
        const reads: string[] = [];
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              if (statement.includes('from "roles_to_tenant_users"')) {
                expect(statement).toContain(
                  '"roles_to_tenant_users"."roleId" = $1',
                );
                expect(statement).toContain(
                  '"roles_to_tenant_users"."tenantId" = $2',
                );
                expect(parameters).toEqual(['role-1', 'tenant-1', 1]);
                reads.push('assignments');
                return [];
              }
              expect(statement).toContain('from "event_instances"');
              expect(statement).toContain('"event_instances"."tenantId" = $1');
              expect(statement).toContain(
                '"event_instances"."announcementRoleIds" @> $2',
              );
              expect(statement).toContain(' limit $3');
              expect(parameters).toEqual(['tenant-1', '{"role-1"}', 1]);
              reads.push('announcements');
              return [['announcement-1']];
            }),
        });
        const error = yield* Database.use((database) =>
          ensureTenantRoleIsUnreferenced(database, 'tenant-1', 'role-1'),
        ).pipe(Effect.flip, Effect.provide(databaseLayer));
        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          message:
            'This role is still used to show an information-only event. Remove it from that event before deleting the role.',
          reason: 'roleInUseByEventAnnouncement',
        });
        expect(reads).toEqual(['assignments', 'announcements']);
      }),
  );

  it.effect(
    'continues checking event and template choices when no tenant announcement matches',
    () =>
      Effect.gen(function* () {
        const reads: string[] = [];
        const databaseLayer = createRegistrationDatabaseTestLayer({
          executeValues: (statement, parameters) =>
            Effect.sync(() => {
              if (statement.includes('from "roles_to_tenant_users"')) {
                expect(statement).toContain(
                  '"roles_to_tenant_users"."tenantId" = $2',
                );
                expect(parameters).toEqual(['role-1', 'tenant-1', 1]);
                reads.push('assignments');
                return [];
              }
              expect(parameters).toEqual(['tenant-1', '{"role-1"}', 1]);
              expect(statement).toContain(' limit $3');
              if (statement.includes('from "event_instances"')) {
                expect(statement).toContain(
                  '"event_instances"."tenantId" = $1',
                );
                expect(statement).toContain(
                  '"event_instances"."announcementRoleIds" @> $2',
                );
                reads.push('announcements');
              } else if (
                statement.includes('from "event_registration_options"')
              ) {
                expect(statement).toContain('inner join "event_instances"');
                expect(statement).toContain(
                  '"event_instances"."tenantId" = $1',
                );
                expect(statement).toContain(
                  '"event_registration_options"."roleIds" @> $2',
                );
                reads.push('event choices');
              } else {
                expect(statement).toContain(
                  'from "template_registration_options"',
                );
                expect(statement).toContain('inner join "event_templates"');
                expect(statement).toContain(
                  '"event_templates"."tenantId" = $1',
                );
                expect(statement).toContain(
                  '"template_registration_options"."roleIds" @> $2',
                );
                reads.push('template choices');
              }
              return [];
            }),
        });
        yield* Database.use((database) =>
          ensureTenantRoleIsUnreferenced(database, 'tenant-1', 'role-1'),
        ).pipe(Effect.provide(databaseLayer));
        expect(reads).toEqual([
          'assignments',
          'announcements',
          'event choices',
          'template choices',
        ]);
      }),
  );
});
