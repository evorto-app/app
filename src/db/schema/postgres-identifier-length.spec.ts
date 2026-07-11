import { is } from 'drizzle-orm';
import {
  getMaterializedViewConfig,
  getTableConfig,
  getViewConfig,
  isPgEnum,
  isPgMaterializedView,
  isPgView,
  PgTable,
} from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import * as schema from './index';

const maxPostgresIdentifierBytes = 63;

interface ExplicitIdentifier {
  readonly identifier: string;
  readonly source: string;
}

const explicitIdentifier = (
  source: string,
  identifier: string,
): ExplicitIdentifier => ({ identifier, source });

const tableIdentifiers = (
  exportName: string,
  table: PgTable,
): ExplicitIdentifier[] => {
  const config = getTableConfig(table);

  return [
    explicitIdentifier(`${exportName} table`, config.name),
    ...(config.schema === undefined
      ? []
      : [explicitIdentifier(`${exportName} schema`, config.schema)]),
    ...config.columns.flatMap((column) => [
      ...(column.keyAsName
        ? []
        : [
            explicitIdentifier(
              `${exportName}.${column.name} column`,
              column.name,
            ),
          ]),
      ...(column.uniqueName === undefined
        ? []
        : [
            explicitIdentifier(
              `${exportName}.${column.name} column unique constraint`,
              column.uniqueName,
            ),
          ]),
    ]),
    ...config.checks.map((constraint) =>
      explicitIdentifier(`${exportName} check`, constraint.name),
    ),
    ...config.foreignKeys.flatMap((constraint) =>
      constraint.isNameExplicit()
        ? [
            explicitIdentifier(
              `${exportName} foreign key`,
              constraint.getName(),
            ),
          ]
        : [],
    ),
    ...config.indexes.flatMap((index) =>
      index.isNameExplicit && index.config.name !== undefined
        ? [explicitIdentifier(`${exportName} index`, index.config.name)]
        : [],
    ),
    ...config.primaryKeys.flatMap((constraint) =>
      constraint.isNameExplicit
        ? [
            explicitIdentifier(
              `${exportName} primary key`,
              constraint.getName(),
            ),
          ]
        : [],
    ),
    ...config.uniqueConstraints.flatMap((constraint) =>
      constraint.isNameExplicit
        ? [
            explicitIdentifier(
              `${exportName} unique constraint`,
              constraint.getName(),
            ),
          ]
        : [],
    ),
  ];
};

const viewIdentifiers = (
  exportName: string,
  kind: 'materialized view' | 'view',
  config: { readonly name: string; readonly schema: string | undefined },
): ExplicitIdentifier[] => [
  explicitIdentifier(`${exportName} ${kind}`, config.name),
  ...(config.schema === undefined
    ? []
    : [explicitIdentifier(`${exportName} schema`, config.schema)]),
];

const explicitPostgresIdentifiers = Object.entries(schema).flatMap(
  ([exportName, value]) => {
    if (is(value, PgTable)) {
      return tableIdentifiers(exportName, value);
    }

    if (isPgEnum(value)) {
      return [explicitIdentifier(`${exportName} enum`, value.enumName)];
    }

    if (isPgView(value)) {
      return viewIdentifiers(exportName, 'view', getViewConfig(value));
    }

    if (isPgMaterializedView(value)) {
      return viewIdentifiers(
        exportName,
        'materialized view',
        getMaterializedViewConfig(value),
      );
    }

    return [];
  },
);

describe('PostgreSQL schema identifiers', () => {
  it("keeps every explicit identifier within PostgreSQL's 63-byte limit", () => {
    const overLimitIdentifiers = explicitPostgresIdentifiers.flatMap(
      ({ identifier, source }) => {
        const bytes = new TextEncoder().encode(identifier).byteLength;

        return bytes > maxPostgresIdentifierBytes
          ? [{ bytes, identifier, source }]
          : [];
      },
    );

    expect(overLimitIdentifiers).toEqual([]);
  });
});
