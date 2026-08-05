import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import {
  registrationIdFromScannedTicketUrl,
  SCANNER_CAMERA_FACTORY,
  type ScannerCamera,
  scannerCameraErrorMessage,
  ScannerComponent,
  scannerNavigationErrorMessage,
  scannerNonTicketMessage,
  scannerViewUnavailableMessage,
} from './scanner.component';

describe('scannerCameraErrorMessage', () => {
  it('maps denied camera access to a retryable access message', () => {
    expect(
      scannerCameraErrorMessage(new DOMException('', 'NotAllowedError')),
    ).toBe(
      'Camera access was blocked. Allow Evorto to use the camera in your device settings, then try again.',
    );
  });

  it('maps missing camera devices to a device message', () => {
    expect(
      scannerCameraErrorMessage(new DOMException('', 'NotFoundError')),
    ).toContain('No camera was found');
  });

  it('maps busy camera devices to a recoverable message', () => {
    expect(
      scannerCameraErrorMessage(new DOMException('', 'NotReadableError')),
    ).toContain('already in use');
  });

  it('keeps unknown camera errors readable', () => {
    expect(scannerCameraErrorMessage(new Error('boom'))).toBe(
      'The camera could not be started. Check camera access or scan the ticket with a phone camera.',
    );
  });
});

describe('registrationIdFromScannedTicketUrl', () => {
  it('accepts a scan URL from the current app origin', () => {
    expect(
      registrationIdFromScannedTicketUrl(
        'https://tenant.example.com/scan/registration/registration-1',
      ),
    ).toBe('registration-1');
  });

  it('accepts a scan URL from another tenant/domain origin by product decision', () => {
    expect(
      registrationIdFromScannedTicketUrl(
        'https://custom-tenant.example.org/scan/registration/registration-1',
      ),
    ).toBe('registration-1');
  });

  it('rejects invalid QR code payloads', () => {
    expect(registrationIdFromScannedTicketUrl('not a url')).toBeUndefined();
  });

  it('rejects URLs outside the exact scan registration path', () => {
    expect(
      registrationIdFromScannedTicketUrl(
        'https://tenant.example.com/scan/registration/registration-1/extra',
      ),
    ).toBeUndefined();
    expect(
      registrationIdFromScannedTicketUrl(
        'https://tenant.example.com/not-scan/registration/registration-1',
      ),
    ).toBeUndefined();
  });
});

describe('scanner ticket feedback', () => {
  it('keeps non-ticket QR feedback in an explicit retry state', () => {
    expect(scannerNonTicketMessage).toContain('not an Evorto ticket');
    expect(scannerNonTicketMessage).toContain('when you are ready');
    expect(scannerNonTicketMessage).not.toContain('camera could not');
  });

  it('explains a missing scanner view without promising that a reload will fix it', () => {
    expect(scannerViewUnavailableMessage).toBe(
      'The scanner did not start. No ticket was scanned. Open the ticket from the event page instead.',
    );
  });
});

const normalizedText = (fixture: ComponentFixture<ScannerComponent>): string =>
  (fixture.nativeElement as HTMLElement).textContent
    ?.replaceAll(/\s+/g, ' ')
    .trim() ?? '';

const buttonNamed = (
  fixture: ComponentFixture<ScannerComponent>,
  name: string,
): HTMLButtonElement | undefined =>
  [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('button'),
  ].find(
    (button) => button.textContent?.replaceAll(/\s+/g, ' ').trim() === name,
  );

describe('ScannerComponent', () => {
  const camera: ScannerCamera = {
    destroy: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
  };
  const createCamera = vi.fn();
  const loadScannerAccess = vi.fn();
  let handleCameraResult: ((scannedValue: string) => void) | undefined;
  let queryClient: QueryClient;

  beforeEach(async () => {
    handleCameraResult = undefined;
    vi.mocked(camera.destroy).mockReset();
    vi.mocked(camera.start).mockReset().mockResolvedValue(undefined);
    vi.mocked(camera.stop).mockReset();
    createCamera
      .mockReset()
      .mockImplementation(
        (
          _videoElement: HTMLVideoElement,
          handleResult: (scannedValue: string) => void,
        ) => {
          handleCameraResult = handleResult;
          return camera;
        },
      );
    loadScannerAccess.mockReset().mockResolvedValue(true);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false },
      },
    });

    await TestBed.configureTestingModule({
      imports: [ScannerComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            users: {
              canUseScanner: {
                queryOptions: () => ({
                  queryFn: loadScannerAccess,
                  queryKey: ['scanner-access'],
                }),
              },
            },
          },
        },
        { provide: SCANNER_CAMERA_FACTORY, useValue: createCamera },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  const render = (): ComponentFixture<ScannerComponent> => {
    const fixture = TestBed.createComponent(ScannerComponent);
    fixture.detectChanges();
    return fixture;
  };

  const renderCameraReady = async (): Promise<
    ComponentFixture<ScannerComponent>
  > => {
    const fixture = render();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizedText(fixture)).toContain('Camera ready.');
    });
    return fixture;
  };

  it('waits for a positive organizer capability before requesting camera access', async () => {
    let resolveAccess: ((allowed: boolean) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const accessResult = new Promise<boolean>((resolve) => {
      resolveAccess = resolve;
    });
    loadScannerAccess.mockReturnValue(accessResult);
    const fixture = render();

    await vi.waitFor(() => expect(loadScannerAccess).toHaveBeenCalledOnce());
    expect(normalizedText(fixture)).toContain('Checking scanner access');
    expect(createCamera).not.toHaveBeenCalled();
    expect(camera.start).not.toHaveBeenCalled();

    resolveAccess?.(true);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(createCamera).toHaveBeenCalledOnce();
      expect(camera.start).toHaveBeenCalledOnce();
      expect(normalizedText(fixture)).toContain('Camera ready.');
    });
  });

  it('does not trust a cached grant until a fresh capability check succeeds', async () => {
    queryClient.setQueryData(['scanner-access'], true);
    let resolveAccess: ((allowed: boolean) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const accessResult = new Promise<boolean>((resolve) => {
      resolveAccess = resolve;
    });
    loadScannerAccess.mockReturnValue(accessResult);
    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadScannerAccess).toHaveBeenCalledOnce();
      expect(normalizedText(fixture)).toContain('Checking scanner access');
    });
    expect(createCamera).not.toHaveBeenCalled();
    expect(camera.start).not.toHaveBeenCalled();

    resolveAccess?.(true);

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(camera.start).toHaveBeenCalledOnce();
      expect(normalizedText(fixture)).toContain('Camera ready.');
    });
  });

  it('does not initialize the camera when organizer capability is denied', async () => {
    loadScannerAccess.mockResolvedValue(false);
    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizedText(fixture)).toContain('Scanner unavailable');
    });
    expect(createCamera).not.toHaveBeenCalled();
    expect(camera.start).not.toHaveBeenCalled();
  });

  it('retries capability resolution before initializing the camera', async () => {
    loadScannerAccess
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue(true);
    const fixture = render();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizedText(fixture)).toContain(
        'Scanner access could not be checked',
      );
    });
    expect(loadScannerAccess).toHaveBeenCalledOnce();
    expect(createCamera).not.toHaveBeenCalled();

    buttonNamed(fixture, 'Try checking access again')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(loadScannerAccess).toHaveBeenCalledTimes(2);
      expect(camera.start).toHaveBeenCalledOnce();
      expect(normalizedText(fixture)).toContain('Camera ready.');
    });
  });

  it('destroys the camera when a fresh capability check revokes access', async () => {
    loadScannerAccess.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const fixture = await renderCameraReady();

    await queryClient.refetchQueries({
      exact: true,
      queryKey: ['scanner-access'],
    });

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(camera.destroy).toHaveBeenCalledOnce();
      expect(normalizedText(fixture)).toContain('Scanner unavailable');
    });
    const video =
      (fixture.nativeElement as HTMLElement).querySelector('video') ??
      undefined;
    expect(video?.hidden).toBe(true);
    expect(normalizedText(fixture)).not.toContain('Camera ready.');
  });

  it('destroys the camera and surfaces a fresh capability check failure', async () => {
    loadScannerAccess
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Unavailable'));
    const fixture = await renderCameraReady();

    await queryClient.refetchQueries({
      exact: true,
      queryKey: ['scanner-access'],
    });

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(camera.destroy).toHaveBeenCalledOnce();
      expect(normalizedText(fixture)).toContain(
        'Scanner access could not be checked',
      );
    });
    expect(normalizedText(fixture)).not.toContain('Camera ready.');
    expect(loadScannerAccess).toHaveBeenCalledTimes(2);
  });

  it('stops after an invalid code until the organizer explicitly scans again', async () => {
    const fixture = await renderCameraReady();
    handleCameraResult?.('not a ticket');
    fixture.detectChanges();

    expect(camera.stop).toHaveBeenCalledOnce();
    expect(camera.start).toHaveBeenCalledOnce();
    expect(normalizedText(fixture)).toContain(scannerNonTicketMessage);

    buttonNamed(fixture, 'Scan another code')?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(camera.start).toHaveBeenCalledTimes(2);
      expect(normalizedText(fixture)).not.toContain(scannerNonTicketMessage);
    });
  });

  it('surfaces failed navigation and retries the same registration explicitly', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(false);
    const fixture = await renderCameraReady();
    handleCameraResult?.(
      'https://tenant.example/scan/registration/registration-1',
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizedText(fixture)).toContain(scannerNavigationErrorMessage);
    });
    expect(navigate).toHaveBeenCalledWith([
      '/scan/registration',
      'registration-1',
    ]);
    expect(camera.start).toHaveBeenCalledOnce();

    navigate.mockResolvedValue(true);
    buttonNamed(fixture, 'Try opening ticket again')?.click();

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(navigate).toHaveBeenLastCalledWith([
      '/scan/registration',
      'registration-1',
    ]);
    expect(camera.start).toHaveBeenCalledOnce();
  });
});
