import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';

import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import {
  providePlatformOperation,
  type ResolvedPlatformOperation,
} from './platform-operation.service';
import { RpcAccess } from './rpc-access.service';

const authority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const targetTenant = Tenant.make({
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: {
    esnCard: { config: {}, status: 'disabled' },
  },
  domain: 'target.example.org',
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  faviconUrl: undefined,
  id: 'tenant-target',
  legalNoticeText: undefined,
  legalNoticeUrl: undefined,
  logoUrl: undefined,
  maxActiveRegistrationsPerUser: 0,
  name: 'Target tenant',
  privacyPolicyText: undefined,
  privacyPolicyUrl: undefined,
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: true,
  seoDescription: undefined,
  seoTitle: undefined,
  stripeAccountId: undefined,
  termsText: undefined,
  termsUrl: undefined,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
});

const operation: ResolvedPlatformOperation = {
  authority,
  reason: 'Correct a production configuration issue',
  requestContext: {
    authData: { sub: authority.actorId },
    authenticated: true,
    permissions: [],
    platformAuthority: authority,
    tenant: targetTenant,
    user: null,
    userAssigned: false,
  },
  targetTenant,
};

describe('providePlatformOperation', () => {
  it.effect('grants only the server-selected target capability', () =>
    providePlatformOperation(
      Effect.gen(function* () {
        const context = yield* RpcAccess.current();
        expect(context.tenant.id).toBe('tenant-target');
        expect(context.permissions).toEqual([]);
        expect(context.user).toBeNull();

        yield* RpcAccess.ensurePermission('templates:create');
        const denied = yield* RpcAccess.ensurePermission('events:create').pipe(
          Effect.flip,
        );
        expect(denied['_tag']).toBe('RpcForbiddenError');
      }),
      operation,
      ['templates:create'],
    ).pipe(Effect.provide(RpcAccess.Default)),
  );

  it('keeps administrator errors in product language', () => {
    const source = readFileSync(
      new URL('platform-operation.service.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("message: 'Enter a reason for this change.'");
    expect(source).toContain(
      "message: 'You need Evorto administrator access to do this.'",
    );
    expect(source).toContain(
      "'This organization no longer exists. No changes were made. Return to Organizations and choose an existing organization.'",
    );
    expect(source).not.toContain("message: 'Authentication required'");
    expect(source).not.toContain("message: 'Target tenant not found'");
    expect(source).not.toContain(
      "message: 'Platform administrator authority required'",
    );
  });
});
