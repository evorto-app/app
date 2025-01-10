import { ChangeDetectionStrategy, Component } from '@angular/core';
import { inject } from '@angular/core';
import { input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, RouterLink, FontAwesomeModule],
  selector: 'app-role-edit',
  styles: ``,
  templateUrl: './role-edit.component.html',
})
export class RoleEditComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly roleId = input.required<string>();
  private readonly queries = inject(QueriesService);
  protected readonly roleQuery = injectQuery(this.queries.role(this.roleId));
}
