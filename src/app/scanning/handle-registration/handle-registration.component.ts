import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  
  // Get eventId from query params if present
  private readonly contextEventId = computed(() => {
    const queryParams = this.route.snapshot.queryParams;
    return queryParams['eventId'] || null;
  });
  
  protected readonly scanResultQuery = injectQuery(
    this.queries.registrationScanned(this.registrationId),
  );
  
  protected readonly checkInMutation = injectMutation(this.queries.checkIn());
  
  protected readonly startsSoon = computed(() => {
    const scanResult = this.scanResultQuery.data();
    if (!scanResult) return false;
    return (
      DateTime.fromJSDate(scanResult.event.start).diffNow('hours').hours < 1
    );
  });

  protected readonly eventMismatch = computed(() => {
    const scanResult = this.scanResultQuery.data();
    const contextEventId = this.contextEventId();
    if (!scanResult || !contextEventId) return false;
    return scanResult.event.id !== contextEventId;
  });

  protected readonly backUrl = computed(() => {
    const contextEventId = this.contextEventId();
    return contextEventId ? `/events/${contextEventId}/organize` : '/scan';
  });

  checkIn() {
    const registrationId = this.registrationId();
    if (!registrationId) return;
    
    this.checkInMutation.mutate(
      { registrationId },
      {
        onSuccess: () => {
          // Navigate back to the appropriate page after successful check-in
          const contextEventId = this.contextEventId();
          if (contextEventId) {
            this.router.navigate(['/events', contextEventId, 'organize']);
          } else {
            this.router.navigate(['/scan']);
          }
        },
        onError: (error) => {
          console.error('Check-in failed:', error);
          // Error handling can be enhanced with a toast notification
        },
      }
    );
  }
}
