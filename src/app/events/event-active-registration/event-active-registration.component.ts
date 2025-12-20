import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { injectMutation, QueryClient } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

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
  private readonly trpc = injectTRPC();
  private readonly cancelPendingRegistrationMutation = injectMutation(() =>
    this.trpc.events.cancelPendingRegistration.mutationOptions(),
  );

  private readonly queryClient = inject(QueryClient);

  cancelPendingRegistration(registration: { id: string }) {
    this.cancelPendingRegistrationMutation.mutate(
      {
        registrationId: registration.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.events.getRegistrationStatus.pathKey(),
          });
        },
      },
    );
  }
}
