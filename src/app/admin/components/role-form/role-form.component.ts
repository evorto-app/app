import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

import {
  ALL_PERMISSIONS,
  Permission,
  PERMISSION_DEPENDENCIES,
  PERMISSION_GROUPS,
} from '../../../../shared/permissions/permissions';
import { RoleFormData, RoleFormModel } from './role-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatCheckboxModule,
    MatButtonModule,
    MatInputModule,
    MatTooltipModule,
    FormField,
  ],
  selector: 'app-role-form',
  standalone: true,
  templateUrl: './role-form.component.html',
})
export class RoleFormComponent {
  public readonly isSubmitting = input(false);
  public readonly roleForm = input.required<FieldTree<RoleFormModel>>();
  public readonly submitLabel = input('Save role');
  protected formSubmit = output<RoleFormData>();

  protected readonly permissionGroups = PERMISSION_GROUPS;

  protected readonly groupStates = computed(() => {
    const form = this.roleForm();
    return this.permissionGroups.map((group) => {
      const groupPermissions = group.permissions.map((p) => p.key);
      const selectedCount = groupPermissions.filter(
        (permission) => form.permissions[permission]().value(),
      ).length;

      return {
        ...group,
        checked: selectedCount === groupPermissions.length,
        indeterminate:
          selectedCount > 0 && selectedCount < groupPermissions.length,
      };
    });
  });

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.roleForm(), async (formState) => {
      const formValue = formState().value();
      this.formSubmit.emit({
        ...formValue,
        description: formValue.description || null,
        permissions: ALL_PERMISSIONS.filter(
          (permission) => formValue.permissions[permission],
        ) as Permission[],
      });
    });
  }

  toggleGroup(
    group: { permissions: { key: Permission }[] },
    checked: boolean,
  ): void {
    const form = this.roleForm();
    for (const permission of group.permissions) {
      const field = form.permissions[permission.key]();
      field.value.set(checked);
      field.markAsDirty();
    }
  }

  protected getDependentPermissions(permission: Permission): Permission[] {
    return PERMISSION_DEPENDENCIES[permission] || [];
  }

  protected getPermissionTooltip(permission: Permission): string {
    const form = this.roleForm();
    return form.permissions[permission]().disabledReasons()[0]?.message ?? '';
  }
}
