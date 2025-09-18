import { sql, is } from 'drizzle-orm';
import { PgTable, getTableConfig, type PgDatabase } from 'drizzle-orm/pg-core';

/**
 * Drops all data from every Postgres table declared in the provided schema.
 * Matches the behavior of drizzle-seed's reset helper without depending on it
 * so Playwright ESM runs avoid instanceof issues.
 */
export async function resetDatabaseSchema(
  database: PgDatabase<any, any>,
  schema: Record<string, unknown>,
) {
  const tables = Object.values(schema).filter(
    (value): value is PgTable<any, any, any, any, any> => {
      return is(value, PgTable);
    },
  );

  if (tables.length === 0) {
    return;
  }

  const qualifiedTableNames = tables.map((table) => {
    const config = getTableConfig(table);
    const schemaName = config.schema ?? 'public';
    return `"${schemaName}"."${config.name}"`;
  });

  await database.execute(
    sql.raw(`truncate ${qualifiedTableNames.join(', ')} restart identity cascade;`),
  );
}
