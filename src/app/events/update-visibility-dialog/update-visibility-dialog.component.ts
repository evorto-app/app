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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import {
  type EventListingAudience,
  eventListingAudienceDescriptions,
  eventListingAudienceLabels,
  eventListingAudiences,
} from '@shared/event-listing-audience';

import { RoleSelectComponent } from '../../shared/components/controls/role-select/role-select.component';

export interface UpdateVisibilityDialogResult {
  readonly announcementRoleIds: string[];
  readonly listingAudience: EventListingAudience;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    RoleSelectComponent,
  ],
  selector: 'app-update-visibility-dialog',
  styles: ``,
  templateUrl: './update-visibility-dialog.component.html',
})
export class UpdateVisibilityDialogComponent {
  protected readonly data: {
    event: {
      announcementRoleIds: readonly string[];
      hasRegistrationOptions: boolean;
      listingAudience: EventListingAudience;
      title: string;
    };
  } = inject(MAT_DIALOG_DATA);
  protected readonly eventListingAudienceDescriptions =
    eventListingAudienceDescriptions;
  protected readonly eventListingAudienceLabels = eventListingAudienceLabels;
  protected readonly eventListingAudiences = eventListingAudiences;
  private readonly listingModel = signal({
    announcementRoleIds: this.data.event.hasRegistrationOptions
      ? []
      : [...this.data.event.announcementRoleIds],
    listingAudience: this.data.event.listingAudience,
  });
  protected readonly listingForm = form(this.listingModel);
  private readonly roleSelect = viewChild(RoleSelectComponent);
  protected readonly saveDisabled = computed(
    () =>
      this.listingForm().invalid() ||
      (!this.data.event.hasRegistrationOptions &&
        this.roleSelect()?.selectionValid() !== true),
  );
  private readonly dialogReference =
    inject<
      MatDialogRef<
        UpdateVisibilityDialogComponent,
        UpdateVisibilityDialogResult
      >
    >(MatDialogRef);

  save(): void {
    if (this.saveDisabled()) return;
    this.dialogReference.close(this.listingForm().value());
  }
}
