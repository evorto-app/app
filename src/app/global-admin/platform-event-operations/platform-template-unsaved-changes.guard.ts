import type { CanDeactivateFn } from '@angular/router';

export interface PlatformTemplateUnsavedChanges {
  canDeactivate(): boolean;
}

export const platformTemplateUnsavedChangesGuard: CanDeactivateFn<
  PlatformTemplateUnsavedChanges
> = (component) => component.canDeactivate();
