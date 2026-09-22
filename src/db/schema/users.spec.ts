import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  userCommunicationEmailCanonicalCheckName,
  userIbanCanonicalShapeCheckName,
  userPaypalEmailCanonicalCheckName,
  users,
} from './users';

const constraintSql = (name: string): string => {
  const constraint = getTableConfig(users).checks.find(
    (candidate) => candidate.name === name,
  );
  if (!constraint) {
    throw new Error(`Missing user constraint: ${name}`);
  }
  return new PgDialect().sqlToQuery(constraint.value).sql;
};

describe('user profile persistence', () => {
  it('requires canonical communication and PayPal email shapes', () => {
    const communicationEmailSql = constraintSql(
      userCommunicationEmailCanonicalCheckName,
    );
    const paypalEmailSql = constraintSql(userPaypalEmailCanonicalCheckName);

    expect(communicationEmailSql).toContain(
      '"users"."communicationEmail" = lower(btrim("users"."communicationEmail"))',
    );
    expect(communicationEmailSql).toContain('char_length');
    expect(communicationEmailSql).toContain(
      "'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'",
    );
    expect(paypalEmailSql).toContain('"users"."paypalEmail" is null');
    expect(paypalEmailSql).toContain(
      '"users"."paypalEmail" = lower(btrim("users"."paypalEmail"))',
    );
  });

  it('allows only null or canonical electronic IBAN shapes', () => {
    const ibanSql = constraintSql(userIbanCanonicalShapeCheckName);

    expect(ibanSql).toContain('"users"."iban" is null');
    expect(ibanSql).toContain(
      '"users"."iban" ~ \'^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$\'',
    );
  });
});
