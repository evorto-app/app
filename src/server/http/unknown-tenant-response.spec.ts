import { describe, expect, it } from 'vitest';

import {
  createUnknownTenantResponse,
  unknownTenantDocument,
} from './unknown-tenant-response';

describe('unknown tenant response', () => {
  it('gives a person safe recovery guidance without reflecting the unknown host', () => {
    const visibleCopy = unknownTenantDocument.replaceAll(/\s+/g, ' ');

    expect(visibleCopy).toContain(
      'This link does not match an Evorto organization',
    );
    expect(visibleCopy).toContain(
      'Your account and registrations have not been changed.',
    );
    expect(visibleCopy).toContain(
      'do not edit its address or create a new registration',
    );
    expect(unknownTenantDocument).not.toContain('window.location');
    expect(unknownTenantDocument).not.toContain('document.referrer');
  });

  it('returns non-cacheable, non-indexable HTML with a real 404 status', () => {
    const response = createUnknownTenantResponse('GET');

    expect(response.status).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
