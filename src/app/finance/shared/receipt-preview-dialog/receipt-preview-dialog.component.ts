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

const trustedReceiptPreviewHost = (hostname: string): boolean =>
  hostname === globalThis.location?.hostname ||
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname.endsWith('.amazonaws.com') ||
  hostname.endsWith('.r2.cloudflarestorage.com');

export function isSafeReceiptPreviewUrl(
  previewUrl: null | string,
): previewUrl is string {
  if (!previewUrl) {
    return false;
  }

  try {
    const baseUrl = globalThis.location?.origin ?? 'http://localhost';
    const url = new URL(previewUrl, baseUrl);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      trustedReceiptPreviewHost(url.hostname)
    );
  } catch {
    return false;
  }
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

  protected readonly previewUrl = computed(() =>
    isSafeReceiptPreviewUrl(this.data.previewUrl) ? this.data.previewUrl : null,
  );

  protected readonly isImage = computed(
    () => Boolean(this.previewUrl()) && this.data.mimeType.startsWith('image/'),
  );

  protected readonly isPdf = computed(
    () =>
      Boolean(this.previewUrl()) && this.data.mimeType === 'application/pdf',
  );

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly safePdfPreviewUrl = computed<null | SafeResourceUrl>(
    () => {
      if (!this.isPdf()) {
        return null;
      }
      const previewUrl = this.previewUrl();
      if (!previewUrl) {
        return null;
      }
      return this.sanitizer.bypassSecurityTrustResourceUrl(previewUrl);
    },
  );
}
