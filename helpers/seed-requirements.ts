export type RequiredSeedUserRole = 'admin' | 'organizer' | 'user';

export interface SeedRole {
  readonly defaultOrganizerRole: boolean;
  readonly defaultUserRole: boolean;
  readonly id: string;
  readonly name: string;
}

export interface SeedStripeTaxRate {
  readonly active: boolean;
  readonly percentage: null | string;
  readonly stripeTaxRateId: string;
}

export const requireSeedFixture = <T>(
  value: null | T | undefined,
  description: string,
): T => {
  if (value === null || value === undefined) {
    throw new Error(`Missing declared seed fixture: ${description}`);
  }
  return value;
};

export const requireSeedStripeTaxRates = <TRate extends SeedStripeTaxRate>(
  rates: readonly TRate[],
): {
  readonly vat7: TRate;
  readonly vat19: TRate;
} => {
  const requireUniqueActiveRate = (percentage: '19' | '7'): TRate => {
    const matches = rates.filter(
      (rate) => rate.active && rate.percentage === percentage,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one active ${percentage}% Stripe tax rate for paid seed fixtures; found ${matches.length}`,
      );
    }

    const rate = matches[0];
    if (!rate || rate.stripeTaxRateId.trim().length === 0) {
      throw new Error(
        `Active ${percentage}% Stripe tax rate is missing its provider id`,
      );
    }
    return rate;
  };

  return {
    vat7: requireUniqueActiveRate('7'),
    vat19: requireUniqueActiveRate('19'),
  };
};

export const requireSeedUserId = (
  users: readonly { readonly id: string; readonly roles: string }[],
  role: RequiredSeedUserRole,
): string => {
  const user = users.find((candidate) => candidate.roles === role);
  if (!user?.id) {
    throw new Error(`Missing required seed user with role "${role}"`);
  }
  return user.id;
};

export const requireSeedRoles = <TRole extends SeedRole>(
  roles: readonly TRole[],
): {
  readonly adminRole: TRole;
  readonly defaultOrganizerRoles: TRole[];
  readonly defaultUserRoles: TRole[];
} => {
  const adminRole = roles.find((role) => role.name === 'Admin');
  if (!adminRole) {
    throw new Error('Missing required Admin seed role');
  }

  const defaultOrganizerRoles = roles.filter(
    (role) => role.defaultOrganizerRole,
  );
  if (defaultOrganizerRoles.length === 0) {
    throw new Error('Missing required default organizer seed role');
  }

  const defaultUserRoles = roles.filter((role) => role.defaultUserRole);
  if (defaultUserRoles.length === 0) {
    throw new Error('Missing required default user seed role');
  }

  return { adminRole, defaultOrganizerRoles, defaultUserRoles };
};
