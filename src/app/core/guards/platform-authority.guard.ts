import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { ConfigService } from '../config.service';

export const platformAuthorityGuard: CanActivateFn = (_, state) => {
  const config = inject(ConfigService);
  if (config.platformAuthority?.kind === 'platformAdministrator') {
    return true;
  }

  return inject(Router).createUrlTree(['/403'], {
    queryParams: { originalPath: state.url },
  });
};
