import {
  afterNextRender,
  DestroyRef,
  DOCUMENT,
  inject,
  Injectable,
  signal,
} from '@angular/core';

const canonicalTimezone = (timezone: string) =>
  new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions()
    .timeZone;

export const shouldShowTimezone = (
  eventTimezone: string,
  deviceTimezone: null | string,
): boolean =>
  deviceTimezone === null ||
  canonicalTimezone(eventTimezone) !== canonicalTimezone(deviceTimezone);

const readDeviceTimezone = (): null | string => {
  try {
    const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone ? canonicalTimezone(timezone) : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
};

@Injectable({ providedIn: 'root' })
export class DeviceTimezoneService {
  private readonly deviceTimezone = signal<null | string>(null);
  readonly timezone = this.deviceTimezone.asReadonly();

  constructor() {
    const document = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const refresh = () => this.deviceTimezone.set(readDeviceTimezone());
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') refresh();
      };
      refresh();
      document.defaultView?.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', onVisibilityChange);
      destroyRef.onDestroy(() => {
        document.defaultView?.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      });
    });
  }
}
