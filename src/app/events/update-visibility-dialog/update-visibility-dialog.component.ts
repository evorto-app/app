import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import {
  type EventListingAudience,
  eventListingAudienceDescriptions,
  eventListingAudienceLabels,
  eventListingAudiences,
} from '@shared/event-listing-audience';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  selector: 'app-update-visibility-dialog',
  styles: ``,
  templateUrl: './update-visibility-dialog.component.html',
})
export class UpdateVisibilityDialogComponent {
  protected readonly data: {
    event: { listingAudience: EventListingAudience; title: string };
  } = inject(MAT_DIALOG_DATA);
  protected readonly eventListingAudienceDescriptions =
    eventListingAudienceDescriptions;
  protected readonly eventListingAudienceLabels = eventListingAudienceLabels;
  protected readonly eventListingAudiences = eventListingAudiences;
  private readonly listingModel = signal({
    listingAudience: this.data.event.listingAudience,
  });
  protected readonly listingForm = form(this.listingModel);
}
