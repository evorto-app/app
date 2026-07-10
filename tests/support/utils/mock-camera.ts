import type { Page } from '@playwright/test';

export type MockCameraMode = 'allowed' | 'denied';

export const installMockCamera = async (
  page: Page,
  mode: MockCameraMode,
): Promise<void> => {
  await page.addInitScript((cameraMode: MockCameraMode) => {
    const getUserMedia = async (): Promise<MediaStream> => {
      if (cameraMode === 'denied') {
        throw new DOMException('Camera permission denied', 'NotAllowedError');
      }

      const canvas = document.createElement('canvas');
      canvas.hidden = true;
      canvas.height = 240;
      canvas.width = 320;
      document.documentElement.append(canvas);
      const stream = canvas.captureStream(5);
      const context = canvas.getContext('2d');
      let frame = 0;
      const drawFrame = () => {
        if (!context) {
          return;
        }
        context.fillStyle = frame % 2 === 0 ? '#ffffff' : '#f5f5f5';
        context.fillRect(0, 0, canvas.width, canvas.height);
        frame += 1;
      };
      drawFrame();
      globalThis.setInterval(drawFrame, 200);
      return stream;
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: async () => [
          {
            deviceId: 'mock-camera',
            groupId: 'mock-camera-group',
            kind: 'videoinput',
            label: 'Mock camera',
            toJSON: () => ({}),
          },
        ],
        getSupportedConstraints: () => ({ facingMode: true, width: true }),
        getUserMedia,
      },
    });
  }, mode);
};
