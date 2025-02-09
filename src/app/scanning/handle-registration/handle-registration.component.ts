import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  MatButton,
  MatButtonModule,
  MatIconAnchor,
  MatIconButton,
} from '@angular/material/button';
import { MatMenu } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { QueriesService } from '../../core/queries.service';

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
  private readonly queries = inject(QueriesService);
  protected readonly scanResultQuery = injectQuery(
    this.queries.registrationScanned(this.registrationId),
  );
  protected readonly startsSoon = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) return false;
    return (
      DateTime.fromJSDate(scanResult.event.start).diffNow('hours').hours < 1
    );
  });

  checkIn() {}
}
