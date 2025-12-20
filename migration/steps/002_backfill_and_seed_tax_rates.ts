import consola from 'consola';
import { and, eq, isNull } from 'drizzle-orm';

import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import { stripe } from '../../src/server/stripe-client';

export const backfillAndSeedTaxRates = async (
  tenantId: string,
  stripeAccountId?: string | null,
) => {
  consola.info(`Backfilling legacy paid options and seeding tax rates for tenant ${tenantId}`);

  try {
    // Skip in production environment
    if (process.env.NODE_ENV === 'production') {
      consola.info('Skipping seed data in production environment');
      return;
    }

    // Get the tenant info
    const tenant = await database.query.tenants.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      consola.error(`Tenant ${tenantId} not found`);
      return;
    }

    let defaultTaxRateId: string | null = null;

    // If tenant has a stripeReducedTaxRate, try to import it
    if (tenant.stripeReducedTaxRate && stripeAccountId) {
      try {
        const taxRate = await stripe.taxRates.retrieve(tenant.stripeReducedTaxRate, undefined, {
          stripeAccount: stripeAccountId,
        });

        // Import this tax rate if not already imported
        const existing = await database.query.tenantStripeTaxRates.findFirst({
          where: {
            stripeTaxRateId: taxRate.id,
            tenantId: tenant.id,
          },
        });

        if (!existing) {
          await database.insert(schema.tenantStripeTaxRates).values({
            active: !!taxRate.active,
            country: taxRate.country ?? null,
            displayName: taxRate.display_name ?? null,
            inclusive: !!taxRate.inclusive,
            percentage: String(taxRate.percentage ?? ''),
            state: taxRate.state ?? null,
            stripeTaxRateId: taxRate.id,
            tenantId: tenant.id,
          });
          consola.info(`Imported existing tenant tax rate ${taxRate.id}`);
        }

        // Use this as the default for backfilling if it's compatible
        if (taxRate.inclusive && taxRate.active) {
          defaultTaxRateId = taxRate.id;
        }
      } catch (error) {
        consola.warn(
          `Failed to retrieve tenant.stripeReducedTaxRate ${tenant.stripeReducedTaxRate}:`,
          error,
        );
      }
    }

    // Seed sample tax rates for development (idempotent upsert)
    const sampleRates = [
      {
        stripeTaxRateId: `dev_tax_free_${tenantId}`,
        displayName: 'Tax Free',
        percentage: '0',
        inclusive: true,
        active: true,
      },
      {
        stripeTaxRateId: `dev_vat_7_${tenantId}`,
        displayName: 'VAT 7%',
        percentage: '7',
        inclusive: true,
        active: true,
      },
      {
        stripeTaxRateId: `dev_vat_19_${tenantId}`,
        displayName: 'VAT 19%',
        percentage: '19',
        inclusive: true,
        active: true,
      },
    ];

    for (const rate of sampleRates) {
      const existing = await database.query.tenantStripeTaxRates.findFirst({
        where: {
          stripeTaxRateId: rate.stripeTaxRateId,
          tenantId: tenant.id,
        },
      });

      if (!existing) {
        await database.insert(schema.tenantStripeTaxRates).values({
          ...rate,
          tenantId: tenant.id,
          country: null,
          state: null,
        });
        consola.info(`Seeded sample tax rate: ${rate.displayName}`);
      }
    }

    // Use the first sample rate as default if no stripeReducedTaxRate was available
    if (!defaultTaxRateId) {
      defaultTaxRateId = sampleRates[0].stripeTaxRateId;
    }

    // Backfill legacy paid options without tax rate
    if (defaultTaxRateId) {
      // Template registration options
      const templateOptionsToUpdate = await database.query.templateRegistrationOptions.findMany({
        where: and(
          eq(schema.templateRegistrationOptions.isPaid, true),
          isNull(schema.templateRegistrationOptions.stripeTaxRateId),
        ),
        columns: { id: true, templateId: true },
      });

      for (const option of templateOptionsToUpdate) {
        await database
          .update(schema.templateRegistrationOptions)
          .set({ stripeTaxRateId: defaultTaxRateId })
          .where(eq(schema.templateRegistrationOptions.id, option.id));

        consola.info(
          `Updated template registration option ${option.id} with tax rate ${defaultTaxRateId}`,
        );
      }

      // Event registration options
      const eventOptionsToUpdate = await database.query.eventRegistrationOptions.findMany({
        where: and(
          eq(schema.eventRegistrationOptions.isPaid, true),
          isNull(schema.eventRegistrationOptions.stripeTaxRateId),
        ),
        columns: { id: true, eventId: true },
      });

      for (const option of eventOptionsToUpdate) {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ stripeTaxRateId: defaultTaxRateId })
          .where(eq(schema.eventRegistrationOptions.id, option.id));

        consola.info(
          `Updated event registration option ${option.id} with tax rate ${defaultTaxRateId}`,
        );
      }

      consola.success(
        `Backfilled ${templateOptionsToUpdate.length} template options and ${eventOptionsToUpdate.length} event options`,
      );
    } else {
      consola.warn('No compatible default tax rate available for backfilling');
    }
  } catch (error) {
    consola.error('Failed to backfill and seed tax rates:', error);
    throw error;
  }
};
