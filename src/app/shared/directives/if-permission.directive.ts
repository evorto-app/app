import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';

import { Permission } from '../../../shared/permissions/permissions';
import { PermissionsService } from '../../core/permissions.service';

@Directive({
  selector: '[appIfPermission]',
})
export class IfPermissionDirective {
  readonly appIfPermission = input.required<Permission>();
  private hasView = false;
  private readonly permissions = inject(PermissionsService);
  private readonly templateReference = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);

  constructor() {
    effect(() => {
      const allowed = this.permissions.hasPermissionSync(
        this.appIfPermission(),
      );

      if (!allowed && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      } else if (allowed && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateReference);
        this.hasView = true;
      }
    });
  }
}
