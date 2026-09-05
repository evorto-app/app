import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';

import { RoleSelectComponent } from '../../shared/components/controls/role-select/role-select.component';

export interface UpdateAnnouncementDiscoveryDialogResult {
  readonly announcementRoleIds: string[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatButtonModule, MatDialogModule, RoleSelectComponent],
  selector: 'app-update-announcement-discovery-dialog',
  templateUrl: './update-announcement-discovery-dialog.component.html',
})
export class UpdateAnnouncementDiscoveryDialogComponent {
  protected readonly data: {
    event: {
      announcementRoleIds: readonly string[];
      title: string;
    };
  } = inject(MAT_DIALOG_DATA);
  private readonly announcementModel = signal({
    announcementRoleIds: [...this.data.event.announcementRoleIds],
  });
  protected readonly announcementForm = form(this.announcementModel);
  private readonly roleSelect = viewChild(RoleSelectComponent);
  protected readonly saveDisabled = computed(
    () =>
      this.announcementForm().invalid() ||
      this.roleSelect()?.selectionValid() !== true,
  );
  private readonly dialogReference =
    inject<
      MatDialogRef<
        UpdateAnnouncementDiscoveryDialogComponent,
        UpdateAnnouncementDiscoveryDialogResult
      >
    >(MatDialogRef);

  protected save(): void {
    if (this.saveDisabled()) return;
    this.dialogReference.close(this.announcementForm().value());
  }
}
