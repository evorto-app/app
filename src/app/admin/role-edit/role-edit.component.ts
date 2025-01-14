import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import {
  RoleFormComponent,
  RoleFormData,
} from '../components/role-form/role-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink, RoleFormComponent],
  selector: 'app-role-edit',
  templateUrl: './role-edit.component.html',
})
export class RoleEditComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly roleId = input.required<string>();
  private readonly queries = inject(QueriesService);
  protected readonly roleQuery = injectQuery(this.queries.role(this.roleId));
  protected readonly updateRoleMutation = injectMutation(
    this.queries.updateRole(),
  );

  private readonly router = inject(Router);
  onSubmit(role: RoleFormData) {
    this.updateRoleMutation.mutate(
      { ...role, id: this.roleId() },
      {
        onSuccess: () =>
          this.router.navigate(['admin', 'roles', this.roleId()]),
      },
    );
  }
}
