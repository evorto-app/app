import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatInputModule } from '@angular/material/input';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

import {
  ALL_PERMISSIONS,
  Permission,
  PERMISSION_GROUPS,
} from '../../../../shared/permissions/permissions';

export interface RoleFormData {
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: null | string;
  name: string;
  permissions: Permission[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatCheckboxModule,
    MatButtonModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: 'app-role-form',
  standalone: true,
  templateUrl: './role-form.component.html',
})
export class RoleFormComponent {
  public readonly initialData = input<Partial<RoleFormData>>({});
  public readonly isSubmitting = input(false);
  public readonly submitLabel = input('Save role');
  protected formSubmit = output<RoleFormData>();

  protected readonly permissionGroups = PERMISSION_GROUPS;
  private formBuilder = inject(NonNullableFormBuilder);

  protected permissionForm = this.formBuilder.group({
    defaultOrganizerRole: [false],
    defaultUserRole: [false],
    description: [''],
    name: [''],
    permissions: this.formBuilder.group(
      Object.fromEntries(
        ALL_PERMISSIONS.map((permission) => [permission, [false]]),
      ) as Record<Permission, [boolean]>,
    ),
  });

  private formValue = toSignal(this.permissionForm.valueChanges);

  protected readonly groupStates = computed(() => {
    const currentPermissions = this.formValue()?.permissions ?? {};
    return this.permissionGroups.map((group) => {
      const groupPermissions = group.permissions.map((p) => p.key);
      const selectedCount = groupPermissions.filter(
        (p) => currentPermissions[p],
      ).length;

      return {
        ...group,
        checked: selectedCount === groupPermissions.length,
        indeterminate:
          selectedCount > 0 && selectedCount < groupPermissions.length,
      };
    });
  });

  constructor() {
    effect(() => {
      const data = this.initialData();
      if (data) {
        // create permissions object from input
        const permissions = Object.fromEntries(
          data.permissions?.map((permission) => [permission, true]) ?? [],
        );
        this.permissionForm.patchValue(
          { ...data, description: data.description ?? '', permissions },
          { emitEvent: true },
        );
      }
    });
  }

  isPermissionSelected(permission: Permission): boolean {
    const permissions = this.formValue()?.permissions ?? {};
    return permissions[permission] ?? false;
  }

  onSubmit(): void {
    if (this.permissionForm.valid) {
      const rawValue = this.permissionForm.getRawValue();
      this.formSubmit.emit({
        ...rawValue,
        permissions: ALL_PERMISSIONS.filter(
          (p) => rawValue.permissions[p],
        ) as Permission[],
      });
    }
  }

  toggleGroup(
    group: { permissions: { key: Permission }[] },
    checked: boolean,
  ): void {
    const updates = Object.fromEntries(
      group.permissions.map((p) => [p.key, checked]),
    );

    this.permissionForm.patchValue({
      permissions: {
        ...updates,
      },
    });
  }

  togglePermission(permission: Permission, checked: boolean): void {
    this.permissionForm.patchValue({
      permissions: {
        [permission]: checked,
      },
    });
  }
}
