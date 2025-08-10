import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col p-4',
  },
  imports: [],
  selector: 'app-members-hub',
  templateUrl: './members-hub.component.html',
})
export class MembersHubComponent {
  private readonly trpc = injectTRPC();
  protected readonly rolesQuery = injectQuery(() =>
    this.trpc.admin.roles.findHubRoles.queryOptions(),
  );
}
