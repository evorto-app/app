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

import { AppRpc } from '../../core/effect-rpc-angular-client';
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
  private readonly rpc = AppRpc.injectClient();
  protected readonly roleQuery = injectQuery(() =>
    this.rpc.admin['roles.findOne'].queryOptions({
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
    injectTRPC().admin.roles.update.mutationOptions(),
  );
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  onSubmit(role: RoleFormData) {
    this.updateRoleMutation.mutate(
      { ...role, id: this.roleId() },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.findOne']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.findMany']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.findHubRoles']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['admin', 'roles.search']),
          );
          const id = this.roleId();
          this.router.navigate(['admin', 'roles', id]);
        },
      },
    );
  }

  protected errorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message;
    }
    return 'Unknown error';
  }
}
