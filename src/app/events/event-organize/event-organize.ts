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
import { AppRpc } from '../../core/effect-rpc-angular-client';
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

  private readonly rpc = AppRpc.injectClient();
  protected readonly eventQuery = injectQuery(() =>
    this.rpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  protected readonly event = computed(() => this.eventQuery.data());
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly organizerOverviewQuery = injectQuery(() =>
    this.rpc.events.getOrganizeOverview.queryOptions({
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
  private readonly trpc = injectTRPC();
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
  private readonly receiptOriginalUploadMutation = injectMutation(() =>
    this.trpc.finance.receiptMedia.uploadOriginal.mutationOptions(),
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
      this.config.tenant.receiptSettings,
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
      const attachment = await this.prepareAttachment(
        result.file,
        result.attachmentName,
      );

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

  private async prepareAttachment(file: File, attachmentName: string) {
    const originalUpload = await this.uploadReceiptOriginal(file);

    return {
      fileName: attachmentName,
      mimeType: file.type,
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
