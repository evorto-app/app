import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const collectProductionTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectProductionTypeScriptFiles(entryPath);
    }
    if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      return [entryPath];
    }
    return [];
  });

const ledgerTables = [
  {
    physicalName: 'registration_acquisitions',
    symbol: 'registrationAcquisitions',
  },
  {
    physicalName: 'registration_acquisition_payments',
    symbol: 'registrationAcquisitionPayments',
  },
  {
    physicalName: 'registration_acquisition_components',
    symbol: 'registrationAcquisitionComponents',
  },
  {
    physicalName: 'registration_acquisition_refund_allocations',
    symbol: 'registrationAcquisitionRefundAllocations',
  },
  {
    physicalName: 'registration_transfer_refund_plan_acquisition_links',
    symbol: 'registrationTransferRefundPlanAcquisitionLinks',
  },
] as const;

const productionSources = collectProductionTypeScriptFiles(
  path.join(repositoryRoot, 'src'),
);

const findLedgerMutationViolations = (source: string): readonly string[] =>
  ledgerTables.flatMap(({ physicalName, symbol }) => {
    const tableReference = String.raw`(?:\b[A-Za-z_$][\w$]*\s*\.\s*)*\b${symbol}\b`;
    const directMutationPattern = new RegExp(
      String.raw`\.(?:delete|update)\(\s*${tableReference}`,
      'u',
    );
    const importAliasPattern = new RegExp(
      String.raw`\b${symbol}\s+as\s+[A-Za-z_$][\w$]*`,
      'u',
    );
    const assignmentAliasPattern = new RegExp(
      String.raw`(?<![=!<>])=(?!=)\s*${tableReference}`,
      'u',
    );
    const sqlRelation = String.raw`(?:"?[A-Za-z_][\w$]*"?\s*\.\s*)?"?${physicalName}"?`;
    const rawSqlMutationPattern = new RegExp(
      String.raw`\b(?:DELETE\s+FROM|UPDATE)\s+(?:ONLY\s+)?${sqlRelation}(?![\w$])`,
      'iu',
    );
    const violations: string[] = [];

    if (directMutationPattern.test(source)) {
      violations.push(`${symbol}: direct mutation`);
    }
    if (importAliasPattern.test(source)) {
      violations.push(`${symbol}: import alias`);
    }
    if (assignmentAliasPattern.test(source)) {
      violations.push(`${symbol}: assignment alias`);
    }
    if (rawSqlMutationPattern.test(source)) {
      violations.push(`${physicalName}: raw SQL mutation`);
    }

    return violations;
  });

describe('registration acquisition ledger source', () => {
  it('detects variable and member assignment aliases', () => {
    for (const { symbol } of ledgerTables) {
      expect(
        findLedgerMutationViolations(
          `const alias = ${symbol}; database.delete(alias);`,
        ),
      ).toContain(`${symbol}: assignment alias`);
      expect(
        findLedgerMutationViolations(
          `holder.current = schema.${symbol}; database.update(holder.current);`,
        ),
      ).toContain(`${symbol}: assignment alias`);
    }
  });

  it('detects raw SQL delete and update evasions', () => {
    for (const { physicalName } of ledgerTables) {
      expect(
        findLedgerMutationViolations(
          `database.execute(sql\`DELETE FROM "${physicalName}"\`);`,
        ),
      ).toContain(`${physicalName}: raw SQL mutation`);
      expect(
        findLedgerMutationViolations(
          `database.execute(sql.raw('UPDATE public.${physicalName} SET value = 1'));`,
        ),
      ).toContain(`${physicalName}: raw SQL mutation`);
    }
  });

  it('allows inserts, selects, and non-mutating SQL', () => {
    expect(
      findLedgerMutationViolations(`
        database.insert(registrationAcquisitions).values(value);
        database.select().from(schema.registrationAcquisitionPayments);
        database.execute(sql\`SELECT * FROM registration_acquisition_components\`);
      `),
    ).toEqual([]);
  });

  it('keeps production writes application-append-only', () => {
    const violations = productionSources.flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');

      return findLedgerMutationViolations(source).map(
        (violation) =>
          `${path.relative(repositoryRoot, sourcePath)}: ${violation}`,
      );
    });

    expect(violations).toEqual([]);
  });
});
