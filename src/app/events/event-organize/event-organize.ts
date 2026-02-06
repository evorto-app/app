import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  buildSelectableReceiptCountries,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';
import {
  ReceiptSubmitDialogComponent,
  ReceiptSubmitDialogResult,
} from './receipt-submit-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    FaDuotoneIconComponent,
    MatButtonModule,
    PercentPipe,
    RouterLink,
    MatTableModule,
  ],
  selector: 'app-event-organize',
  templateUrl: './event-organize.html',
})
export class EventOrganize {
  eventId = input.required<string>();

  private readonly trpc = injectTRPC();
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  protected readonly event = computed(() => this.eventQuery.data());
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly organizerOverviewQuery = injectQuery(() =>
    this.trpc.events.getOrganizeOverview.queryOptions({
      eventId: this.eventId(),
    }),
  );

  protected readonly organizerTableColumns = signal([
    'name',
    'email',
    'checkin',
  ]);

  protected readonly organizerTableContent = computed(() => {
    const overview = this.organizerOverviewQuery.data();
    if (!overview) return [];
    return overview
      .filter((registrationOption) => registrationOption.organizingRegistration)
      .flatMap((registrationOption) => [
        {
          title: registrationOption.registrationOptionTitle,
          type: 'Registration Option',
        },
        ...registrationOption.users,
      ]);
  });
  protected readonly receiptsByEventQuery = injectQuery(() =>
    this.trpc.finance.receipts.byEvent.queryOptions({
      eventId: this.eventId(),
    }),
  );

  // Basic stats computation
  protected readonly stats = computed(() => {
    const eventData = this.event();
    const registrationOptions = eventData?.registrationOptions || [];
    const totalCapacity = registrationOptions.reduce(
      (sum, option) => sum + option.spots,
      0,
    );
    const totalRegistered = registrationOptions.reduce(
      (sum, option) => sum + option.confirmedSpots,
      0,
    );
    const totalCheckedIn = registrationOptions.reduce(
      (sum, option) => sum + option.checkedInSpots,
      0,
    );

    return {
      capacity: totalCapacity,
      capacityPercentage:
        totalCapacity > 0 ? totalRegistered / totalCapacity : 0,
      checkedIn: totalCheckedIn,
      registered: totalRegistered,
    };
  });
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  protected readonly submitReceiptMutation = injectMutation(() =>
    this.trpc.finance.receipts.submit.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.byEvent.queryKey({
            eventId: this.eventId(),
          }),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.my.pathKey(),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.pendingApprovalGrouped.pathKey(),
        });
        this.notifications.showSuccess('Receipt submitted');
      },
    }),
  );

  private readonly config = inject(ConfigService);

  private readonly dialog = inject(MatDialog);
  private pdfWorkerConfigured = false;
  private readonly receiptOriginalUploadMutation = injectMutation(() =>
    this.trpc.finance.receiptMedia.uploadOriginal.mutationOptions(),
  );
  private readonly receiptPreviewUploadInitMutation = injectMutation(() =>
    this.trpc.finance.receiptMedia.createPreviewDirectUpload.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const event = this.event();
      if (event) {
        this.config.updateTitle(`Organize ${event.title}`);
      }
    });
  }

  protected async openReceiptDialog(): Promise<void> {
    const receiptCountrySettings = resolveReceiptCountrySettings(
      this.config.tenant.discountProviders?.financeReceipts,
    );
    const countries = buildSelectableReceiptCountries(receiptCountrySettings);

    const dialogReference = this.dialog.open<
      ReceiptSubmitDialogComponent,
      { countries: string[]; defaultCountry: string },
      ReceiptSubmitDialogResult
    >(ReceiptSubmitDialogComponent, {
      data: {
        countries,
        defaultCountry: receiptCountrySettings.receiptCountries[0] ?? 'DE',
      },
      width: '640px',
    });

    const result = await firstValueFrom(dialogReference.afterClosed());
    if (!result) {
      return;
    }

    try {
      const attachment = await this.prepareAttachment(result.file);

      this.submitReceiptMutation.mutate({
        attachment,
        eventId: this.eventId(),
        fields: result.fields,
      });
    } catch (error) {
      this.notifications.showError(
        error instanceof Error ? error.message : 'Failed to upload receipt file',
      );
    }
  }

  protected readonly showOrganizerRow = (
    index: number,
    row: { type?: string },
  ) => row?.type !== 'Registration Option';

  protected readonly showRegistrationOptionRow = (
    index: number,
    row: { type?: string },
  ) => row?.type === 'Registration Option';

  private async createPdfPreviewImage(file: File): Promise<File> {
    const pdfJs = await import('pdfjs-dist');
    if (!this.pdfWorkerConfigured) {
      pdfJs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.mjs',
        import.meta.url,
      ).toString();
      this.pdfWorkerConfigured = true;
    }

    const loadingTask = pdfJs.getDocument({ data: await file.arrayBuffer() });
    const pdfDocument = await loadingTask.promise;
    const page = await pdfDocument.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) {
      throw new Error('Failed to create PDF preview context');
    }

    await page.render({ canvas, canvasContext, viewport }).promise;
    const previewBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!previewBlob) {
      throw new Error('Failed to render PDF preview');
    }

    const baseName = file.name.replace(/\.pdf$/iu, '');
    return new File([previewBlob], `${baseName}-preview.jpg`, {
      type: 'image/jpeg',
    });
  }

  private async prepareAttachment(file: File) {
    const originalUpload = await this.uploadReceiptOriginal(file);

    let previewUpload:
      | null
      | {
          deliveryUrl: string;
          imageId: string;
        } = null;

    if (file.type.startsWith('image/')) {
      previewUpload = await this.uploadPreviewImage(file);
    } else if (file.type === 'application/pdf') {
      const previewFile = await this.createPdfPreviewImage(file);
      previewUpload = await this.uploadPreviewImage(previewFile);
    }

    return {
      fileName: file.name,
      mimeType: file.type,
      previewImageId: previewUpload?.imageId ?? null,
      previewImageUrl: previewUpload?.deliveryUrl ?? null,
      sizeBytes: originalUpload.sizeBytes,
      storageKey: originalUpload.storageKey,
      storageUrl: originalUpload.storageUrl,
    };
  }

  private async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('error', () => {
        reject(new Error('Failed to read receipt file'));
      });
      reader.addEventListener('load', () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Invalid receipt file payload'));
          return;
        }
        const commaIndex = reader.result.indexOf(',');
        if (commaIndex === -1) {
          reject(new Error('Invalid receipt data URL'));
          return;
        }
        resolve(reader.result.slice(commaIndex + 1));
      });
      reader.readAsDataURL(file);
    });
  }

  private async uploadPreviewImage(file: File): Promise<{
    deliveryUrl: string;
    imageId: string;
  }> {
    const uploadInit = await this.receiptPreviewUploadInitMutation.mutateAsync({
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type,
    });

    const uploadBody = new FormData();
    uploadBody.append('file', file);
    const uploadResponse = await fetch(uploadInit.uploadUrl, {
      body: uploadBody,
      method: 'POST',
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `Preview upload failed with status ${uploadResponse.status}`,
      );
    }

    return {
      deliveryUrl: uploadInit.deliveryUrl,
      imageId: uploadInit.imageId,
    };
  }

  private async uploadReceiptOriginal(file: File): Promise<{
    sizeBytes: number;
    storageKey: string;
    storageUrl: string;
  }> {
    return this.receiptOriginalUploadMutation.mutateAsync({
      fileBase64: await this.readFileAsBase64(file),
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type,
    });
  }
}
