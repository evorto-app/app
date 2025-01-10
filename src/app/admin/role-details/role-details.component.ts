import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink],
  selector: 'app-role-details',
  styles: ``,
  templateUrl: './role-details.component.html',
})
export class RoleDetailsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEdit = faEdit;
  protected readonly roleId = input.required<string>();
  private readonly queries = inject(QueriesService);
  protected readonly roleQuery = injectQuery(this.queries.role(this.roleId));
}
