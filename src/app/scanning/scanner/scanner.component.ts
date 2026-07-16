import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import consola from 'consola/browser';
import QrScanner from 'qr-scanner';

export const scannerCameraErrorMessage = (error: unknown): string => {
  const errorName =
    error instanceof DOMException
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String(error.name)
        : '';

  switch (errorName) {
    case 'DevicesNotFoundError':
    case 'NotFoundError': {
      return 'No camera was found on this device. Use another device or scan the ticket with a phone camera.';
    }
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError': {
      return 'Camera access was blocked. Allow camera access in your browser settings, then try again.';
    }
    case 'NotReadableError':
    case 'TrackStartError': {
      return 'The camera is already in use or could not be started. Close other camera apps, then try again.';
    }
    default: {
      return 'The camera could not be started. Check camera permissions or scan the ticket with a phone camera.';
    }
  }
};

export const scannerNonTicketMessage =
  'This QR code is not an Evorto ticket. Keep the camera open and scan the QR code shown on the attendee ticket.';

export const registrationIdFromScannedTicketUrl = (
  scannedLink: string,
): string | undefined => {
  try {
    const url = new URL(scannedLink);
    const match = /^\/scan\/registration\/([^/]+)$/.exec(url.pathname);
    return match?.[1];
  } catch {
    return;
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  selector: 'app-scanner',
  styles: ``,
  templateUrl: './scanner.component.html',
})
export class ScannerComponent implements OnDestroy {
  protected readonly cameraErrorMessage = signal('');
  protected readonly cameraReady = signal(false);
  protected readonly cameraStarting = signal(false);
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly ticketFeedbackMessage = signal('');
  protected readonly videoRef =
    viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  private readonly router = inject(Router);
  private readonly scanner = signal<null | QrScanner>(null);

  constructor() {
    afterNextRender(() => {
      void this.setupScanner();
    });
  }

  ngOnDestroy() {
    this.cameraReady.set(false);
    this.scanner()?.destroy();
  }

  protected retryCamera(): void {
    this.ticketFeedbackMessage.set('');
    void this.startScanner({ clearErrorOnSuccess: true });
  }

  private handleScanResult(result: QrScanner.ScanResult) {
    const scannedLink = result.data as string;
    const registrationId = registrationIdFromScannedTicketUrl(scannedLink);
    if (!registrationId) {
      this.ticketFeedbackMessage.set(scannerNonTicketMessage);
      void this.startScanner();
      return;
    }

    this.ticketFeedbackMessage.set('');
    void this.router.navigate(['/scan/registration', registrationId]);
  }

  private async setupScanner(): Promise<void> {
    const videoElement = this.videoRef();
    if (!videoElement) {
      consola.error('videoElement not found');
      this.ticketFeedbackMessage.set('');
      this.cameraErrorMessage.set(
        'The scanner view could not be initialized. Refresh the page and try again.',
      );
      return;
    }
    const qrScanner = new QrScanner(
      videoElement.nativeElement,
      (result) => {
        qrScanner.stop();
        this.handleScanResult(result);
      },
      {
        highlightCodeOutline: true,
        highlightScanRegion: true,
        maxScansPerSecond: 3,
        returnDetailedScanResult: true,
      },
    );
    this.scanner.set(qrScanner);
    await this.startScanner({ clearErrorOnSuccess: true });
  }

  private async startScanner(
    options: { clearErrorOnSuccess?: boolean } = {},
  ): Promise<void> {
    const scanner = this.scanner();
    if (!scanner || this.cameraStarting()) {
      return;
    }

    this.cameraStarting.set(true);
    this.cameraReady.set(false);
    try {
      await scanner.start();
      this.cameraReady.set(true);
      if (options.clearErrorOnSuccess) {
        this.cameraErrorMessage.set('');
      }
    } catch (error) {
      consola.warn('Failed to start QR scanner camera', error);
      this.cameraReady.set(false);
      this.ticketFeedbackMessage.set('');
      this.cameraErrorMessage.set(scannerCameraErrorMessage(error));
    } finally {
      this.cameraStarting.set(false);
    }
  }
}
