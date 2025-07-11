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
import { ActivatedRoute, Router } from '@angular/router';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import consola from 'consola/browser';
import QrScanner from 'qr-scanner';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-scanner',
  styles: ``,
  templateUrl: './scanner.component.html',
})
export class ScannerComponent implements OnDestroy {
  protected readonly errorMessage = signal('');
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly videoRef =
    viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly scanner = signal<null | QrScanner>(null);
  
  // Get eventId from query params if present - make it protected so template can access
  protected readonly eventId = signal<string | null>(null);

  constructor() {
    // Check for eventId in query params
    this.route.queryParamMap.subscribe(params => {
      const eventId = params.get('eventId');
      this.eventId.set(eventId);
    });

    afterNextRender(() => {
      const videoElement = this.videoRef();
      if (!videoElement) {
        consola.error('videoElement not found');
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
      qrScanner.start();
    });
  }

  ngOnDestroy() {
    this.scanner()?.destroy();
  }

  private handleScanResult(result: QrScanner.ScanResult) {
    const scannedLink = result.data as string;
    try {
      const url = new URL(scannedLink);
      if (url.pathname.startsWith('/scan/registration/')) {
        const registrationId = url.pathname.split('/').pop();
        if (registrationId) {
          // Include eventId in navigation if present
          const eventId = this.eventId();
          const navigationExtras = eventId ? { queryParams: { eventId } } : {};
          this.router.navigate(['/scan/registration', registrationId], navigationExtras);
          return;
        }
      } else {
        this.errorMessage.set(`Unknown link structure: ${scannedLink}`);
        this.scanner()?.start();
      }
    } catch {
      this.errorMessage.set('Invalid QR code');
      this.scanner()?.start();
    }
  }
}
