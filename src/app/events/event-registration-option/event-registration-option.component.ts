import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { interval, map } from 'rxjs';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatTooltipModule, CurrencyPipe, DatePipe],
  selector: 'app-event-registration-option',
  styles: ``,
  templateUrl: './event-registration-option.component.html',
})
export class EventRegistrationOptionComponent {
  public readonly registrationOption = input.required<{
    closeRegistrationTime: Date;
    description: null | string;
    discounts?: Array<{ discountType: 'esnCard'; discountedPrice: number }> | null;
    eventId: string;
    id: string;
    isPaid: boolean;
    openRegistrationTime: Date;
    price: number;
    title: string;
  }>();
  private trpc = injectTRPC();
  protected readonly authenticationQuery = injectQuery(() =>
    this.trpc.config.isAuthenticated.queryOptions(),
  );
  protected readonly userCardsQuery = injectQuery(() =>
    this.trpc.discounts.getMyCards.queryOptions(),
  );
  protected readonly tenantQuery = injectQuery(() =>
    this.trpc.config.tenant.queryOptions(),
  );
  private queryClient = inject(QueryClient);

  // Compute the best available discount for the user
  protected readonly bestDiscount = computed(() => {
    const option = this.registrationOption();
    const userCards = this.userCardsQuery.data() ?? [];
    const tenant = this.tenantQuery.data() as any;
    const enabledSet = new Set(
      Object.entries(tenant?.discountProviders ?? {})
        .filter(([, v]: any) => v?.enabled === true)
        .map(([k]) => k as string),
    );
    const discounts = option.discounts ?? [];

    if (!option.isPaid || discounts.length === 0) {
      return null;
    }

    // Find valid discounts the user is eligible for
    const eligibleDiscounts = discounts.filter(discount => {
      // Check if provider is enabled on the tenant
      if (!enabledSet.has(discount.discountType)) return false;

      // Check if user has a valid card for this provider
      const userCard = userCards.find(card =>
        card.type === discount.discountType &&
        card.status === 'verified'
      );
      if (!userCard) return false;

      // TODO: Add event start date validation (card must be valid on event start)
      // For now, just check it's verified
      return true;
    });

    if (eligibleDiscounts.length === 0) {
      return null;
    }

    // Return the lowest priced discount (best deal)
    return eligibleDiscounts.reduce((best, current) =>
      current.discountedPrice < best.discountedPrice ? current : best
    );
  });

  protected readonly discountInfo = computed(() => {
    const option = this.registrationOption();
    const bestDiscount = this.bestDiscount();
    const basePrice = option.price;

    if (!bestDiscount || !option.isPaid) {
      return {
        hasDiscount: false,
        finalPrice: basePrice,
        originalPrice: basePrice,
        savings: 0,
        savingsPercentage: 0,
        discountType: null as null | 'esnCard'
      };
    }

    const savings = basePrice - bestDiscount.discountedPrice;
    const savingsPercentage = basePrice > 0 ? Math.round((savings / basePrice) * 100) : 0;

    return {
      hasDiscount: true,
      finalPrice: bestDiscount.discountedPrice,
      originalPrice: basePrice,
      savings,
      savingsPercentage,
      discountType: bestDiscount.discountType
    };
  });

  protected readonly availableDiscounts = computed(() => {
    const option = this.registrationOption();
    const userCards = this.userCardsQuery.data() ?? [];
    const tenant = this.tenantQuery.data() as any;
    const enabledSet = new Set(
      Object.entries(tenant?.discountProviders ?? {})
        .filter(([, v]: any) => v?.enabled === true)
        .map(([k]) => k as string),
    );
    const discounts = option.discounts ?? [];

    return discounts.map(discount => {
      const isProviderEnabled = enabledSet.has(discount.discountType);
      const userCard = userCards.find(card => card.type === discount.discountType);

      let status: 'eligible' | 'no_card' | 'invalid_card' | 'provider_disabled' = 'no_card';
      let message = '';

      if (!isProviderEnabled) {
        status = 'provider_disabled';
        message = 'This discount is currently not available';
      } else if (!userCard) {
        status = 'no_card';
        message = 'Add your card to get this discount';
      } else if (userCard.status !== 'verified') {
        status = 'invalid_card';
        message = 'Your card needs verification';
      } else {
        status = 'eligible';
        message = 'You are eligible for this discount';
      }

      return {
        ...discount,
        status,
        message,
        savings: option.price - discount.discountedPrice,
        savingsPercentage: option.price > 0 ? Math.round(((option.price - discount.discountedPrice) / option.price) * 100) : 0
      };
    });
  });

  protected readonly hasManageableDiscounts = computed(() => {
    return this.availableDiscounts().some(d => d.status === 'no_card' || d.status === 'invalid_card');
  });
  protected readonly registrationMutation = injectMutation(() =>
    this.trpc.events.registerForEvent.mutationOptions({
      onSuccess: async ({ userRegistration: { eventId } }) => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.events.getRegistrationStatus.queryKey({
            eventId,
          }),
        });
      },
    }),
  );
  private currentTime = toSignal(interval(1000).pipe(map(() => new Date())), {
    initialValue: new Date(),
  });

  protected registrationOpen = computed(() => {
    const currentTime = this.currentTime();
    const registrationOption = this.registrationOption();
    if (registrationOption.openRegistrationTime > currentTime) {
      return 'tooEarly';
    }
    if (registrationOption.closeRegistrationTime < currentTime) {
      return 'tooLate';
    }
    return 'open';
  });

  register(registrationOption: { eventId: string; id: string }) {
    this.registrationMutation.mutate({
      eventId: registrationOption.eventId,
      registrationOptionId: registrationOption.id,
    });
  }
}
