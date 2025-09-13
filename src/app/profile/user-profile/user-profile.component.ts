import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTabsModule } from '@angular/material/tabs';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faCog,
  faPencil,
  faRightFromBracket,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    FormsModule,
    MatCardModule,
    DatePipe,
  ],
  selector: 'app-user-profile',
  styles: `
    .profile-section {
      background-color: white;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .profile-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
  `,
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent {
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly trpc = injectTRPC();
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.trpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
    return providers.find((p) => p.type === 'esnCard')?.status === 'enabled';
  });
  protected readonly deleteCardMutation = injectMutation(() =>
    this.trpc.discounts.deleteMyCard.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.discounts.getMyCards.pathKey(),
        });
        this.notifications.showSuccess('ESN card removed');
      },
    }),
  );
  protected displayName = signal('');

  protected readonly esnCardControl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.pattern(/^[A-Za-z0-9]{8,16}$/)],
  });
  protected readonly faCalendarDays = faCalendarDays;

  protected readonly faCog = faCog;
  protected readonly faPencil = faPencil;

  protected readonly faRightFromBracket = faRightFromBracket;

  protected readonly faUser = faUser;
  protected isEditing = signal(false);
  // Discounts
  protected readonly myCardsQuery = injectQuery(() =>
    this.trpc.discounts.getMyCards.queryOptions(),
  );

  protected readonly refreshCardMutation = injectMutation(() =>
    this.trpc.discounts.refreshMyCard.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.discounts.getMyCards.pathKey(),
        });
        this.notifications.showSuccess('ESN card refreshed');
      },
    }),
  );
  protected readonly updateProfileMutation = injectMutation(() =>
    this.trpc.users.updateProfile.mutationOptions(),
  );
  protected readonly upsertCardMutation = injectMutation(() =>
    this.trpc.discounts.upsertMyCard.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.discounts.getMyCards.pathKey(),
        });
        this.notifications.showSuccess('ESN card saved');
      },
    }),
  );
  protected readonly userEventsQuery = injectQuery(() =>
    this.trpc.users.events.findMany.queryOptions(),
  );
  protected readonly userQuery = injectQuery(() =>
    this.trpc.users.self.queryOptions(),
  );

  protected cancelEditing(): void {
    this.isEditing.set(false);
  }
  protected deleteEsnCard() {
    this.deleteCardMutation.mutate({ type: 'esnCard' });
  }
  protected refreshEsnCard() {
    this.refreshCardMutation.mutate({ type: 'esnCard' });
  }

  protected saveEsnCard() {
    if (this.esnCardControl.invalid) {
      this.notifications.showError('Please enter a valid ESN card number');
      return;
    }
    this.upsertCardMutation.mutate({
      identifier: this.esnCardControl.value,
      type: 'esnCard',
    });
  }

  protected saveProfile(): void {
    const [firstName, ...lastNameParts] = this.displayName().split(' ');
    const lastName = lastNameParts.join(' ');

    this.updateProfileMutation.mutate(
      {
        firstName,
        lastName,
      },
      {
        onError: (error) => {
          this.notifications.showError(
            'Failed to update profile: ' + error.message,
          );
        },
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.users.self.pathKey(),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.users.maybeSelf.pathKey(),
          });
          this.isEditing.set(false);
          this.notifications.showSuccess('Profile updated successfully');
        },
      },
    );
  }

  protected startEditing(): void {
    this.displayName.set(
      this.userQuery.data()?.firstName + ' ' + this.userQuery.data()?.lastName,
    );
    this.isEditing.set(true);
  }
}
