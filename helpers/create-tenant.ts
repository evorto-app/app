import { init } from '@paralleldrive/cuid2';
import consola from 'consola';
import { and, inArray, InferInsertModel, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';
import { tenants } from '../src/db/schema';
import { normalizeTenantDomain } from '../src/shared/tenant-origin';
import { getId } from './get-id';
import { usersToAuthenticate } from './user-data';

const length = 4;

export const createId = init({ length });

export const createTenant = async (
  database: NodePgDatabase<typeof relations>,
  tenantData?: Partial<InferInsertModel<typeof schema.tenants>>,
) => {
  const t0 = Date.now();
  const domain = normalizeTenantDomain(tenantData?.domain ?? createId());
  const tenant = await database
    .insert(tenants)
    .values({
      ...tenantData,
      domain,
      id: getId(),
      name: tenantData?.name ?? 'ESN Murnau',
      privacyPolicyText:
        tenantData?.privacyPolicyText ??
        'Development and test tenant privacy policy. Seeded data must not be used as production legal text.',
    })
    .returning();
  consola.success(
    `Created tenant ${tenant[0].domain} (${tenant[0].id}) in ${Date.now() - t0}ms`,
  );
  // consola.debug(tenant);
  // for (const record of usersToAuthenticate
  //   .filter((data) => data.addToDb && data.addToTenant)
  //   .map((data) => ({
  //     id: getId(),
  //     tenantId: tenant[0].id,
  //     userId: data.id,
  //   }))) {
  //   consola.debug(record);
  //   await database.insert(schema.usersToTenants).values(record);
  // }
  const assignedUsers = usersToAuthenticate.filter(
    (data) => data.addToDb && data.addToTenant,
  );
  await database.insert(schema.usersToTenants).values(
    assignedUsers.map((data) => ({
      id: getId(),
      tenantId: tenant[0].id,
      userId: data.id,
    })),
  );
  const policyVersions = await database
    .insert(schema.tenantPrivacyPolicyVersions)
    .values({
      privacyPolicyText: tenant[0].privacyPolicyText,
      privacyPolicyUrl: tenant[0].privacyPolicyUrl,
      tenantId: tenant[0].id,
      version: 1,
    })
    .returning({ id: schema.tenantPrivacyPolicyVersions.id });
  const policyVersion = policyVersions[0];
  if (!policyVersion) {
    throw new Error('Seed tenant privacy policy version was not created');
  }
  if (assignedUsers.length > 0) {
    await database.insert(schema.tenantPrivacyPolicyAcceptances).values(
      assignedUsers.map((data) => ({
        policyVersionId: policyVersion.id,
        tenantId: tenant[0].id,
        userId: data.id,
      })),
    );
    await database
      .update(schema.users)
      .set({ homeTenantId: tenant[0].id })
      .where(
        and(
          inArray(
            schema.users.id,
            assignedUsers.map((user) => user.id),
          ),
          isNull(schema.users.homeTenantId),
        ),
      );
  }
  consola.info('Assigned default users to new tenant');
  return tenant[0];
};
