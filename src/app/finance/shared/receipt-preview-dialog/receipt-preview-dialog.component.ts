import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

export interface ReceiptPreviewDialogData {
  attachmentFileName: string;
  mimeType: string;
  previewUrl: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  selector: 'app-receipt-preview-dialog',
  templateUrl: './receipt-preview-dialog.component.html',
})
export class ReceiptPreviewDialogComponent {
  protected readonly data = inject(MAT_DIALOG_DATA) as ReceiptPreviewDialogData;

  protected readonly isImage = computed(() =>
    this.data.mimeType.startsWith('image/'),
  );

  protected readonly isPdf = computed(
    () => this.data.mimeType === 'application/pdf',
  );

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly safePdfPreviewUrl = computed<null | SafeResourceUrl>(() => {
    if (!this.isPdf()) {
      return null;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.data.previewUrl);
  });
}
