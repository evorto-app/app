import { Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';

import { Permission } from '../../../shared/permissions/permissions';
import { PermissionsService } from '../../core/permissions.service';

@Directive({
  selector: '[appIfPermission]',
})
export class IfPermissionDirective {
  @Input() set appIfPermission(permission: Permission) {
    const allowed = this.permissions.hasPermissionSync(permission);

    if (!allowed && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    } else if (allowed && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateReference);
      this.hasView = true;
    }
  }

  private hasView = false;

  constructor(
    private templateReference: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private permissions: PermissionsService,
  ) {}
}
