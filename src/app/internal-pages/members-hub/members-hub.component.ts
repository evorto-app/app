import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
} from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

@Injectable({ providedIn: 'root' })
export class MembersHubQueries {
  private readonly rpc = AppRpc.injectClient();

  hubRoles() {
    return this.rpc.admin.roles.findHubRoles.queryOptions();
  }
}

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
  private readonly queries = inject(MembersHubQueries);
  protected readonly rolesQuery = injectQuery(() => this.queries.hubRoles());

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Unknown error');
  }
}
