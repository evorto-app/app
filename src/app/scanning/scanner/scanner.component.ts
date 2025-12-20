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
import { Router } from '@angular/router';
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
  protected readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoElement');
  private readonly router = inject(Router);
  private readonly scanner = signal<null | QrScanner>(null);

  constructor() {
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
          this.router.navigate(['/scan/registration', registrationId]);
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
