import consola from 'consola';
import { and, desc, eq, isNull, type InferSelectModel } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import type { ScriptDatabaseClient } from '../../src/db/database-client';
import * as schema from '../../src/db/schema';
import type { TenantDiscountProviders } from '../../src/shared/tenant-config';

type LegacyTenantPrivacyPolicySource = Pick<
  InferSelectModel<typeof oldSchema.tenant>,
  'privacyPolicyPage'
>;

type NormalizedLegacyTenantPrivacyPolicy = {
  privacyPolicyText: null | string;
  privacyPolicyUrl: null | string;
};

type TenantPrivacyPolicyMigrationDatabase = Pick<
  ScriptDatabaseClient,
  'insert' | 'select' | 'update'
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const legacyTenantDiscountProviders = (
  settings: unknown,
): TenantDiscountProviders => {
  if (!isRecord(settings)) {
    throw new Error('Legacy tenant settings have an invalid shape.');
  }
  const rawBuyUrl = settings['esnCardLink'];
  if (rawBuyUrl === undefined || rawBuyUrl === null) {
    return { esnCard: { config: {}, status: 'enabled' } };
  }
  if (typeof rawBuyUrl !== 'string' || !rawBuyUrl.trim()) {
    throw new Error('Legacy tenant esnCardLink must be a valid HTTP URL.');
  }
  let buyUrl: URL;
  try {
    buyUrl = new URL(rawBuyUrl.trim());
  } catch {
    throw new Error('Legacy tenant esnCardLink must be a valid HTTP URL.');
  }
  if (buyUrl.protocol !== 'http:' && buyUrl.protocol !== 'https:') {
    throw new Error('Legacy tenant esnCardLink must be a valid HTTP URL.');
  }
  return {
    esnCard: {
      config: { buyEsnCardUrl: buyUrl.toString() },
      status: 'enabled',
    },
  };
};

export const normalizeLegacyTenantPrivacyPolicy = (
  privacyPolicyPage: string,
): NormalizedLegacyTenantPrivacyPolicy => {
  const trimmedPolicy = privacyPolicyPage.trim();
  if (!trimmedPolicy) {
    throw new Error(
      'Cannot migrate a tenant without a configured legacy privacy policy.',
    );
  }

  try {
    const policyUrl = new URL(trimmedPolicy);
    if (policyUrl.protocol === 'http:' || policyUrl.protocol === 'https:') {
      return {
        privacyPolicyText: null,
        privacyPolicyUrl: policyUrl.toString(),
      };
    }
  } catch {
    // Legacy privacy-policy pages also contain rich text, which is preserved.
  }

  return {
    privacyPolicyText: trimmedPolicy,
    privacyPolicyUrl: null,
  };
};

export const ensureMigratedTenantPrivacyPolicy = async (
  database: TenantPrivacyPolicyMigrationDatabase,
  tenantId: string,
  oldTenantData: LegacyTenantPrivacyPolicySource,
) => {
  const legacyPolicy = normalizeLegacyTenantPrivacyPolicy(
    oldTenantData.privacyPolicyPage,
  );
  const existingPolicies = await database
    .select({
      privacyPolicyText: schema.tenantPrivacyPolicyVersions.privacyPolicyText,
      privacyPolicyUrl: schema.tenantPrivacyPolicyVersions.privacyPolicyUrl,
    })
    .from(schema.tenantPrivacyPolicyVersions)
    .where(eq(schema.tenantPrivacyPolicyVersions.tenantId, tenantId))
    .orderBy(desc(schema.tenantPrivacyPolicyVersions.version))
    .limit(1);
  const existingPolicy = existingPolicies[0];
  const effectivePolicy = existingPolicy ?? legacyPolicy;

  if (!existingPolicy) {
    await database
      .insert(schema.tenantPrivacyPolicyVersions)
      .values({
        createdByUserId: null,
        ...legacyPolicy,
        tenantId,
        version: 1,
      })
      .onConflictDoNothing({
        target: [
          schema.tenantPrivacyPolicyVersions.tenantId,
          schema.tenantPrivacyPolicyVersions.version,
        ],
      });
  }

  await database
    .update(schema.tenants)
    .set(effectivePolicy)
    .where(
      and(
        eq(schema.tenants.id, tenantId),
        isNull(schema.tenants.privacyPolicyText),
        isNull(schema.tenants.privacyPolicyUrl),
      ),
    );
};

export const migrateTenant = async (
  database: ScriptDatabaseClient,
  normalizedDomain: string,
  oldTenantData: InferSelectModel<typeof oldSchema.tenant>,
) => {
  consola.info(`Migrating tenant`);
  const privacyPolicy = normalizeLegacyTenantPrivacyPolicy(
    oldTenantData.privacyPolicyPage,
  );
  const discountProviders = legacyTenantDiscountProviders(
    oldTenantData.settings,
  );
  const tenantReturn = await database
    .insert(schema.tenants)
    .values({
      currency: oldTenantData.currency,
      discountProviders,
      domain: normalizedDomain,
      name: oldTenantData.name,
      ...privacyPolicy,
      stripeAccountId: oldTenantData.stripeConnectAccountId?.trim() || null,
      theme: 'esn',
    })
    .onConflictDoNothing({ target: [schema.tenants.domain] })
    .returning();
  const newTenant =
    tenantReturn[0] ??
    (await database.query.tenants.findFirst({
      where: { domain: normalizedDomain },
    }));
  if (!newTenant) {
    throw new Error(`Tenant ${normalizedDomain} could not be migrated.`);
  }
  if (
    JSON.stringify(newTenant.discountProviders) !==
    JSON.stringify(discountProviders)
  ) {
    await database
      .update(schema.tenants)
      .set({ discountProviders })
      .where(eq(schema.tenants.id, newTenant.id));
  }
  return { ...newTenant, discountProviders };
};
