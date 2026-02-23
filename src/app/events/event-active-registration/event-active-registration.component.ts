import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, MatButtonModule, NgOptimizedImage],
  selector: 'app-event-active-registration',
  styles: ``,
  templateUrl: './event-active-registration.component.html',
})
export class EventActiveRegistrationComponent {
  public readonly registrations = input.required<
    readonly {
      appliedDiscountedPrice?: null | number | undefined;
      appliedDiscountType?: 'esnCard' | null | undefined;
      basePriceAtRegistration?: null | number | undefined;
      checkoutUrl?: null | string | undefined;
      discountAmount?: null | number | undefined;
      id: string;
      paymentPending: boolean;
      registeredDescription?: null | string | undefined;
      registrationOptionTitle: string;
      status: string;
    }[]
  >();
  private readonly rpc = AppRpc.injectClient();
  private readonly cancelPendingRegistrationMutation = injectMutation(() =>
    this.rpc.events.cancelPendingRegistration.mutationOptions(),
  );
  private readonly queryClient = inject(QueryClient);

  cancelPendingRegistration(registration: { id: string }) {
    this.cancelPendingRegistrationMutation.mutate(
      {
        registrationId: registration.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'getRegistrationStatus']),
          );
        },
      },
    );
  }
}
