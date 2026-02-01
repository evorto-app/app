import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import { RoleFormComponent } from '../components/role-form/role-form.component';
import {
  createRoleFormModel,
  roleFormSchema,
  RoleFormData,
} from '../components/role-form/role-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    RoleFormComponent,
  ],
  selector: 'app-role-create',
  standalone: true,
  templateUrl: './role-create.component.html',
})
export class RoleCreateComponent {
  private readonly trpc = injectTRPC();
  private readonly roleModel = signal(createRoleFormModel());
  protected readonly roleForm = form(this.roleModel, roleFormSchema);
  protected readonly createRoleMutation = injectMutation(() =>
    this.trpc.admin.roles.create.mutationOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;

  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  protected async onSubmit(role: RoleFormData): Promise<void> {
    this.createRoleMutation.mutate(
      { ...role },
      {
        onSuccess: async (data) => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.findMany.pathKey(),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.findHubRoles.pathKey(),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.search.pathKey(),
          });
          this.router.navigate(['admin', 'roles', data.id]);
        },
      },
    );
  }
}
