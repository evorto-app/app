import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { RoleFormComponent } from '../components/role-form/role-form.component';
import {
  createRoleFormModel,
  RoleFormData,
  roleFormSchema,
} from '../components/role-form/role-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink, RoleFormComponent],
  selector: 'app-role-create',
  standalone: true,
  templateUrl: './role-create.component.html',
})
export class RoleCreateComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly createRoleMutation = injectMutation(() =>
    this.rpc.admin['roles.create'].mutationOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly roleForm = form(signal(createRoleFormModel()), roleFormSchema);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  protected async onSubmit(role: RoleFormData): Promise<void> {
    this.createRoleMutation.mutate(
      { ...role },
      {
        onSuccess: async (data) => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.findMany']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.findHubRoles']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.search']),
          );
          this.router.navigate(['admin', 'roles', data.id]);
        },
      },
    );
  }
}
