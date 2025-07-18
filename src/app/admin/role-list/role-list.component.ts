import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink, MatIconModule],
  selector: 'app-role-list',
  styles: ``,
  templateUrl: './role-list.component.html',
})
export class RoleListComponent {
  protected readonly faArrowLeft = faArrowLeft;
  private readonly trpc = injectTRPC();
  protected readonly roleQuery = injectQuery(() =>
    this.trpc.admin.roles.findMany.queryOptions({}),
  );
}
