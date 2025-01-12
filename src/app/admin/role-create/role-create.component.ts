import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation } from '@tanstack/angular-query-experimental';

import type { Role } from '../../../shared/role';

import { QueriesService } from '../../core/queries.service';
import { RoleFormComponent } from '../components/role-form/role-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FontAwesomeModule, MatButtonModule, RoleFormComponent],
  selector: 'app-role-create',
  templateUrl: './role-create.component.html',
})
export class RoleCreateComponent {
  private readonly queries = inject(QueriesService);
  protected readonly createRoleMutation = injectMutation(
    this.queries.createRole(),
  );
  protected readonly faArrowLeft = faArrowLeft;

  private readonly router = inject(Router);

  protected async onSave(role: Role) {
    await this.createRoleMutation.mutateAsync(role);
    await this.router.navigate(['..']);
  }
}
