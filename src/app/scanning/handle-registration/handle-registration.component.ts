import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FaDuotoneIconComponent, MatButtonModule, RouterLink, DatePipe],
  selector: 'app-handle-registration',
  styles: ``,
  templateUrl: './handle-registration.component.html',
})
export class HandleRegistrationComponent {
  public readonly registrationId = input.required<string>();
  protected readonly faArrowLeft = faArrowLeft;
  private readonly trpc = injectTRPC();
  protected readonly scanResultQuery = injectQuery(() =>
    this.trpc.events.registrationScanned.queryOptions({
      registrationId: this.registrationId(),
    }),
  );
  protected readonly startsSoon = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) return false;
    return (
      DateTime.fromJSDate(scanResult.event.start).diffNow('hours').hours < 1
    );
  });

  checkIn() {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult?.allowCheckin) return;
  }
}
