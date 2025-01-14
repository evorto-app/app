import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import {
  RoleFormComponent,
  RoleFormData,
} from '../components/role-form/role-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    ReactiveFormsModule,
    RoleFormComponent,
  ],
  selector: 'app-role-create',
  standalone: true,
  templateUrl: './role-create.component.html',
})
export class RoleCreateComponent {
  private readonly queries = inject(QueriesService);
  protected readonly createRoleMutation = injectMutation(
    this.queries.createRole(),
  );
  protected readonly faArrowLeft = faArrowLeft;

  private readonly router = inject(Router);

  protected async onSubmit(role: RoleFormData): Promise<void> {
    this.createRoleMutation.mutate(
      { ...role },
      {
        onSuccess: (data) => this.router.navigate(['admin', 'roles', data.id]),
      },
    );
  }
}
