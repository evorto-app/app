import { NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { injectMutation } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, NgOptimizedImage],
  selector: 'app-event-active-registration',
  styles: ``,
  templateUrl: './event-active-registration.component.html',
})
export class EventActiveRegistrationComponent {
  public readonly registrations = input.required<
    {
      checkoutUrl: null | string | undefined;
      id: string;
      paymentPending: boolean;
      registeredDescription: null | string | undefined;
      registrationOptionTitle: string;
      status: string;
    }[]
  >();
  private readonly queries = inject(QueriesService);

  private readonly cancelPendingRegistrationMutation = injectMutation(
    this.queries.cancelPendingRegistration(),
  );

  cancelPendingRegistration(registration: { id: string }) {
    this.cancelPendingRegistrationMutation.mutate({
      registrationId: registration.id,
    });
  }
}
