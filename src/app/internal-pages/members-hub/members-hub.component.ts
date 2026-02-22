import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';

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
  private readonly rpc = AppRpc.injectClient();
  protected readonly rolesQuery = injectQuery(() =>
    this.rpc.admin.roles.findHubRoles.queryOptions(),
  );

  protected errorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message;
    }
    return 'Unknown error';
  }
}
