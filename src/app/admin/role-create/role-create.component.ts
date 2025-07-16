import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
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
  private readonly trpc = injectTRPC();
  protected readonly createRoleMutation = injectMutation(() =>
    this.trpc.admin.roles.create.mutationOptions(),
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
