import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';
import QrScanner from 'qr-scanner';

import { AppRpc } from '../../core/effect-rpc-angular-client';

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
      return 'Camera access was blocked. Allow Evorto to use the camera in your device settings, then try again.';
    }
    case 'NotReadableError':
    case 'TrackStartError': {
      return 'The camera is already in use or could not be started. Close other camera apps, then try again.';
    }
    default: {
      return 'The camera could not be started. Check camera access or scan the ticket with a phone camera.';
    }
  }
};

export const scannerNonTicketMessage =
  'This QR code is not an Evorto ticket. Scan the QR code shown on the attendee ticket when you are ready.';

export const scannerNavigationErrorMessage =
  'The ticket could not be opened. Try again or scan a different ticket.';

export const scannerViewUnavailableMessage =
  'The scanner did not start. No ticket was scanned. Open the ticket from the event page instead.';

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

export interface ScannerCamera {
  destroy(): void;
  start(): Promise<void>;
  stop(): void;
}

export type ScannerCameraFactory = (
  videoElement: HTMLVideoElement,
  handleResult: (scannedValue: string) => void,
) => ScannerCamera;

export const SCANNER_CAMERA_FACTORY = new InjectionToken<ScannerCameraFactory>(
  'SCANNER_CAMERA_FACTORY',
  {
    factory: () => (videoElement, handleResult) =>
      new QrScanner(
        videoElement,
        (result) => handleResult(String(result.data)),
        {
          highlightCodeOutline: true,
          highlightScanRegion: true,
          maxScansPerSecond: 3,
          returnDetailedScanResult: true,
        },
      ),
  },
);

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  selector: 'app-scanner',
  templateUrl: './scanner.component.html',
})
export class ScannerComponent implements OnDestroy {
  protected readonly cameraErrorMessage = signal('');
  protected readonly cameraReady = signal(false);
  protected readonly cameraStarting = signal(false);
  protected readonly navigationErrorMessage = signal('');
  protected readonly navigationPending = signal(false);
  private readonly rpc = AppRpc.injectClient();
  protected readonly scannerAccessQuery = injectQuery(() => ({
    ...this.rpc.users.canUseScanner.queryOptions(),
    refetchOnMount: 'always',
    retry: false,
  }));
  protected readonly scannerAccessChecking = computed(
    () =>
      !this.scannerAccessQuery.isFetchedAfterMount() ||
      (this.scannerAccessQuery.isFetching() &&
        !this.scannerAccessQuery.isSuccess()),
  );
  protected readonly scannerAccessGranted = computed(
    () =>
      this.scannerAccessQuery.isFetchedAfterMount() &&
      this.scannerAccessQuery.isSuccess() &&
      this.scannerAccessQuery.data() === true,
  );
  protected readonly ticketFeedbackMessage = signal('');
  protected readonly videoRef =
    viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  private readonly createCamera = inject(SCANNER_CAMERA_FACTORY);
  private pendingRegistrationId: string | undefined;
  private readonly router = inject(Router);
  private scanner: null | ScannerCamera = null;
  private scannerLifecycle = 0;
  private scannerSetupRequested = false;
  private readonly viewReady = signal(false);

  constructor() {
    effect(() => {
      const accessGranted = this.scannerAccessGranted();
      const viewReady = this.viewReady();

      if (!accessGranted) {
        untracked(() => this.destroyCamera());
        return;
      }

      if (!viewReady || this.scannerSetupRequested) {
        return;
      }

      this.scannerSetupRequested = true;
      untracked(() => void this.setupScanner());
    });
    afterNextRender(() => this.viewReady.set(true));
  }

  ngOnDestroy() {
    this.destroyCamera();
  }

  protected retryCamera(): void {
    this.ticketFeedbackMessage.set('');
    this.navigationErrorMessage.set('');
    const scanner = this.scanner;
    void (scanner
      ? this.startScanner({ clearErrorOnSuccess: true })
      : this.setupScanner());
  }

  protected retryNavigation(): void {
    void this.openRegistration();
  }

  protected retryScannerAccess(): void {
    void this.scannerAccessQuery.refetch();
  }

  protected scanAnotherTicket(): void {
    this.navigationErrorMessage.set('');
    this.pendingRegistrationId = undefined;
    this.ticketFeedbackMessage.set('');
    void this.startScanner({ clearErrorOnSuccess: true });
  }

  private destroyCamera(): void {
    const scanner = this.scanner;
    if (!scanner && !this.scannerSetupRequested) {
      this.cameraReady.set(false);
      return;
    }

    this.scannerLifecycle += 1;
    this.scanner = null;
    this.scannerSetupRequested = false;
    this.cameraReady.set(false);
    this.cameraStarting.set(false);
    scanner?.destroy();
  }

  private handleScanResult(scannedLink: string) {
    const registrationId = registrationIdFromScannedTicketUrl(scannedLink);
    if (!registrationId) {
      this.navigationErrorMessage.set('');
      this.pendingRegistrationId = undefined;
      this.ticketFeedbackMessage.set(scannerNonTicketMessage);
      return;
    }

    this.ticketFeedbackMessage.set('');
    this.navigationErrorMessage.set('');
    this.pendingRegistrationId = registrationId;
    void this.openRegistration();
  }

  private async openRegistration(): Promise<void> {
    const registrationId = this.pendingRegistrationId;
    if (!registrationId || this.navigationPending()) {
      return;
    }

    this.navigationErrorMessage.set('');
    this.navigationPending.set(true);
    try {
      const navigated = await this.router.navigate([
        '/scan/registration',
        registrationId,
      ]);
      if (!navigated) {
        this.navigationErrorMessage.set(scannerNavigationErrorMessage);
      }
    } catch (error) {
      consola.warn('Failed to open scanned registration', error);
      this.navigationErrorMessage.set(scannerNavigationErrorMessage);
    } finally {
      this.navigationPending.set(false);
    }
  }

  private async setupScanner(): Promise<void> {
    const videoElement = this.videoRef();
    if (!videoElement) {
      consola.error('videoElement not found');
      this.ticketFeedbackMessage.set('');
      this.cameraErrorMessage.set(scannerViewUnavailableMessage);
      return;
    }
    try {
      const scanner = this.createCamera(
        videoElement.nativeElement,
        (scannedValue) => {
          scanner.stop();
          this.cameraReady.set(false);
          this.handleScanResult(scannedValue);
        },
      );
      this.scanner = scanner;
      await this.startScanner({ clearErrorOnSuccess: true });
    } catch (error) {
      consola.warn('Failed to initialize QR scanner camera', error);
      this.cameraReady.set(false);
      this.ticketFeedbackMessage.set('');
      this.cameraErrorMessage.set(scannerCameraErrorMessage(error));
    }
  }

  private async startScanner(
    options: { clearErrorOnSuccess?: boolean } = {},
  ): Promise<void> {
    const scanner = this.scanner;
    if (!scanner || this.cameraStarting()) {
      return;
    }

    const scannerLifecycle = this.scannerLifecycle;
    this.cameraStarting.set(true);
    this.cameraReady.set(false);
    try {
      await scanner.start();
      if (
        this.scanner !== scanner ||
        this.scannerLifecycle !== scannerLifecycle ||
        !this.scannerAccessGranted()
      ) {
        return;
      }
      this.cameraReady.set(true);
      if (options.clearErrorOnSuccess) {
        this.cameraErrorMessage.set('');
      }
    } catch (error) {
      if (
        this.scanner !== scanner ||
        this.scannerLifecycle !== scannerLifecycle ||
        !this.scannerAccessGranted()
      ) {
        return;
      }
      consola.warn('Failed to start QR scanner camera', error);
      this.cameraReady.set(false);
      this.ticketFeedbackMessage.set('');
      this.cameraErrorMessage.set(scannerCameraErrorMessage(error));
    } finally {
      if (
        this.scanner === scanner &&
        this.scannerLifecycle === scannerLifecycle
      ) {
        this.cameraStarting.set(false);
      }
    }
  }
}
