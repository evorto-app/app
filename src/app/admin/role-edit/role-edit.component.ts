import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { form } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import { RoleFormComponent } from '../components/role-form/role-form.component';
import {
  mergeRoleFormOverrides,
  RoleFormData,
  RoleFormModel,
  RoleFormOverrides,
  roleFormSchema,
} from '../components/role-form/role-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, RouterLink, RoleFormComponent],
  selector: 'app-role-edit',
  templateUrl: './role-edit.component.html',
})
export class RoleEditComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly roleId = input.required<string>();
  private readonly trpc = injectTRPC();
  protected readonly roleQuery = injectQuery(() =>
    this.trpc.admin.roles.findOne.queryOptions({
      id: this.roleId(),
    }),
  );
  private readonly roleModel = linkedSignal<
    RoleFormOverrides | undefined,
    RoleFormModel
  >({
    computation: (data, previous) =>
      mergeRoleFormOverrides(data ?? {}, previous?.value),
    source: () => this.roleQuery.data(),
  });
  protected readonly roleForm = form(this.roleModel, roleFormSchema);
  protected readonly updateRoleMutation = injectMutation(() =>
    this.trpc.admin.roles.update.mutationOptions(),
  );

  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  onSubmit(role: RoleFormData) {
    this.updateRoleMutation.mutate(
      { ...role, id: this.roleId() },
      {
        onSuccess: async () => {
          const id = this.roleId();
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.findOne.queryKey({ id }),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.findMany.pathKey(),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.findHubRoles.pathKey(),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.admin.roles.search.pathKey(),
          });
          this.router.navigate(['admin', 'roles', id]);
        },
      },
    );
  }
}
