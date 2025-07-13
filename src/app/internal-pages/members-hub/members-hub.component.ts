import { JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JsonPipe],
  selector: 'app-members-hub',
  styles: ``,
  templateUrl: './members-hub.component.html',
})
export class MembersHubComponent {
  private readonly trpc = injectTRPC();
  protected readonly rolesQuery = injectQuery(() =>
    this.trpc.admin.roles.findMany.queryOptions({}),
  );
}
