import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink, MatIconModule],
  selector: 'app-role-list',
  styles: ``,
  templateUrl: './role-list.component.html',
})
export class RoleListComponent {
  protected readonly faArrowLeft = faArrowLeft;
  private readonly rpc = AppRpc.injectClient();
  protected readonly roleQuery = injectQuery(() =>
    this.rpc.admin.roles.findMany.queryOptions({}),
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
