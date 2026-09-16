import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';

import { Context as RequestContext } from '../../../types/custom/context';
import {
  InvalidAuthSessionError,
  toAuthSession,
} from '../../auth/auth-session';
import { resolvePlatformAuthority } from '../../context/request-context-resolver';
import { MAX_TENANT_BRAND_ASSET_SIZE_BYTES } from '../../tenant-brand-assets';
import { toRpcRequestContext } from './app-rpcs.request-handler';
import { MAX_RPC_BODY_SIZE_BYTES } from './app-rpcs.web-handler';

const anonymousContext = Schema.decodeUnknownSync(RequestContext)({
  authentication: { isAuthenticated: false },
  permissions: [],
  tenant: {
    currency: 'EUR',
    domain: 'tenant.example.com',
    id: 'tenant-1',
    locale: 'en-GB',
    name: 'Tenant',
    theme: 'evorto',
    timezone: 'Europe/Berlin',
  },
});

const platformContext = Schema.decodeUnknownSync(RequestContext)({
  ...anonymousContext,
  authentication: { isAuthenticated: true },
  permissions: ['globalAdmin:manageTenants'],
  platformAuthority: {
    actorEmail: 'platform@example.org',
    actorId: 'auth0|platform-admin',
    kind: 'platformAdministrator',
  },
});

describe('RPC request context', () => {
  it('accepts the largest organization image through the RPC envelope', () => {
    const requestBody = JSON.stringify({
      _tag: 'Request',
      headers: [],
      id: 'brand-upload',
      payload: {
        fileBase64: 'A'.repeat(
          4 * Math.ceil(MAX_TENANT_BRAND_ASSET_SIZE_BYTES / 3),
        ),
        fileName: 'organization-logo.png',
        fileSizeBytes: MAX_TENANT_BRAND_ASSET_SIZE_BYTES,
        kind: 'logo',
        mimeType: 'image/png',
      },
      tag: 'admin.tenant.uploadBrandAsset',
    });

    expect(Buffer.byteLength(requestBody)).toBeLessThanOrEqual(
      MAX_RPC_BODY_SIZE_BYTES,
    );
  });

  it.effect(
    'builds an anonymous typed context without cloning the request',
    () =>
      Effect.gen(function* () {
        const context = yield* toRpcRequestContext(anonymousContext, {});
        expect(context).toEqual({
          authData: {},
          authenticated: false,
          permissions: [],
          platformAuthority: null,
          tenant: anonymousContext.tenant,
          user: null,
          userAssigned: false,
        });
      }),
  );

  it.effect(
    'retains verified platform authority independently of tenant users',
    () =>
      Effect.gen(function* () {
        const context = yield* toRpcRequestContext(platformContext, {
          email: 'platform@example.org',
          internalSecret: 'must-not-cross-rpc-context',
          sub: 'auth0|platform-admin',
        });
        expect(context.authData).toEqual({
          email: 'platform@example.org',
          sub: 'auth0|platform-admin',
        });
        expect(context.platformAuthority).toEqual(
          expect.objectContaining({
            actorId: 'auth0|platform-admin',
            kind: 'platformAdministrator',
          }),
        );
        expect(context.user).toBeNull();
        expect(context.userAssigned).toBe(false);
      }),
  );

  it.effect.each([
    { claim: 'email', value: 123 },
    { claim: 'email_verified', value: 'true' },
    { claim: 'given_name', value: false },
    { claim: 'family_name', value: ['private-profile-value'] },
  ])('rejects malformed optional profile claims: $claim', ({ claim, value }) =>
    Effect.gen(function* () {
      const authSession = yield* toAuthSession({
        tokenSets: [
          { accessToken: 'fixture-token', audience: 'default', expiresAt: 0 },
        ],
        user: { [claim]: value, sub: 'auth0|platform-admin' },
      });
      if (!authSession) throw new Error('Expected the decoded session fixture');
      const error = yield* toRpcRequestContext(
        platformContext,
        authSession.authData,
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(InvalidAuthSessionError);
      expect(error).toMatchObject({ reason: 'unusable-session-cookie' });
      expect(error.message).not.toContain('private-profile-value');
    }),
  );

  it.effect.each([
    { email: null, email_verified: null, family_name: null, given_name: null },
    { email: '', email_verified: false, family_name: '', given_name: '' },
  ])(
    'accepts optional profile values allowed by the shared contract: %j',
    (profile) =>
      Effect.gen(function* () {
        const claims = { ...profile, sub: 'auth0|platform-admin' };
        const context = yield* toRpcRequestContext(platformContext, claims);
        expect(context.authData).toEqual(claims);
      }),
  );

  it.effect(
    'keeps raw custom metadata available while projecting only public profile fields',
    () =>
      Effect.gen(function* () {
        const claims = {
          email: 'platform@example.org',
          email_verified: true,
          'evorto.app/app_metadata': {
            custom: 'keep',
            platformAdministrator: true,
          },
          'example/custom': { value: ['keep'] },
          family_name: 'Administrator',
          given_name: 'Platform',
          sub: 'auth0|platform-admin',
        };
        const authSession = yield* toAuthSession({
          tokenSets: [
            { accessToken: 'fixture-token', audience: 'default', expiresAt: 0 },
          ],
          user: claims,
        });
        if (!authSession)
          throw new Error('Expected the decoded session fixture');
        const authority = resolvePlatformAuthority(authSession.authData);
        const context = yield* toRpcRequestContext(
          platformContext,
          authSession.authData,
        );
        expect(authSession.authData).toBe(claims);
        expect(authSession.authData['evorto.app/app_metadata']).toEqual({
          custom: 'keep',
          platformAdministrator: true,
        });
        expect(authority).toEqual(platformContext.platformAuthority);
        expect(context.authData).toEqual({
          email: claims.email,
          email_verified: true,
          family_name: 'Administrator',
          given_name: 'Platform',
          sub: claims.sub,
        });
        expect(context.authData).not.toHaveProperty('evorto.app/app_metadata');
        expect(context.authData).not.toHaveProperty('example/custom');
      }),
  );
});
