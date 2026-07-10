import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { describe, expect, it } from 'vitest';

import { PlatformAdministratorAuthority } from '../../../types/custom/platform-authority';
import { ConfigService } from '../config.service';
import { platformAuthorityGuard } from './platform-authority.guard';

const route = {} as ActivatedRouteSnapshot;
const state = { url: '/global-admin/tenants' } as RouterStateSnapshot;

const configure = (platformAuthority: null | PlatformAdministratorAuthority) =>
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ConfigService,
        useValue: { platformAuthority } satisfies Pick<
          ConfigService,
          'platformAuthority'
        >,
      },
    ],
  });

describe('platformAuthorityGuard', () => {
  it('allows an explicit platform administrator principal', () => {
    configure(
      PlatformAdministratorAuthority.make({
        actorEmail: 'platform@example.org',
        actorId: 'auth0|platform-admin',
        kind: 'platformAdministrator',
      }),
    );

    const result = TestBed.runInInjectionContext(() =>
      platformAuthorityGuard(route, state),
    );

    expect(result).toBe(true);
  });

  it('fails closed without explicit platform authority', () => {
    configure(null);

    const result = TestBed.runInInjectionContext(() =>
      platformAuthorityGuard(route, state),
    );

    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(
      '/403?originalPath=%2Fglobal-admin%2Ftenants',
    );
  });
});
