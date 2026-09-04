import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { Context as RequestContext } from '../../../types/custom/context';
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

  it('builds an anonymous typed context without cloning the request', () => {
    expect(toRpcRequestContext(anonymousContext, {})).toEqual({
      authData: {},
      authenticated: false,
      permissions: [],
      platformAuthority: null,
      tenant: anonymousContext.tenant,
      user: null,
      userAssigned: false,
    });
  });

  it('retains verified platform authority independently of tenant users', () => {
    const context = toRpcRequestContext(platformContext, {
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
  });
});
