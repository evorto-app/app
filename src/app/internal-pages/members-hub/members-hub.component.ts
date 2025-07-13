import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectTRPC } from '@heddendorp/tanstack-angular-query';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRouter } from '../../../server/trpc/app-router';

// import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-members-hub',
  styles: ``,
  templateUrl: './members-hub.component.html',
})
export class MembersHubComponent {
  private readonly trpc = injectTRPC<AppRouter>();
  protected readonly rolesQuery = injectQuery(
    this.trpc.admin.roles.findMany.queryOptions({}),
  );
}
