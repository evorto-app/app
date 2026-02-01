import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  pattern,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faPencil,
  faRightFromBracket,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';
import {
  EditProfileDialogComponent,
  EditProfileDialogData,
  EditProfileDialogResult,
} from './edit-profile-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    MatFormFieldModule,
    MatInputModule,
    FormField,
    DatePipe,
  ],
  selector: 'app-user-profile',
  styles: ``,
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent {
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private readonly trpc = injectTRPC();
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
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.trpc.discounts.getTenantProviders.queryOptions(),
  );
  private readonly esnCardModel = signal({ identifier: '' });
  protected readonly esnCardForm = form(this.esnCardModel, (schemaPath) => {
    required(schemaPath.identifier);
    pattern(schemaPath.identifier, /^[A-Za-z0-9]{8,16}$/);
  });
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
    return providers.find((p) => p.type === 'esnCard')?.status === 'enabled';
  });

  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faPencil = faPencil;

  protected readonly faRightFromBracket = faRightFromBracket;

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
        this.esnCardModel.set({ identifier: '' });
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
  private readonly dialog = inject(MatDialog);

  protected deleteEsnCard() {
    this.deleteCardMutation.mutate({ type: 'esnCard' });
  }
  protected async openEditProfileDialog(): Promise<void> {
    const user = this.userQuery.data();
    if (!user) return;
    const dialogReference = this.dialog.open<
      EditProfileDialogComponent,
      EditProfileDialogData,
      EditProfileDialogResult
    >(EditProfileDialogComponent, {
      data: { firstName: user.firstName, lastName: user.lastName },
      width: '420px',
    });
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (!result) return;
    this.updateProfileMutation.mutate(result, {
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
        this.notifications.showSuccess('Profile updated successfully');
      },
    });
  }

  protected refreshEsnCard() {
    this.refreshCardMutation.mutate({ type: 'esnCard' });
  }

  protected async saveEsnCard(event: Event) {
    event.preventDefault();
    await submit(this.esnCardForm, async (formState) => {
      this.upsertCardMutation.mutate({
        identifier: formState().value().identifier.trim(),
        type: 'esnCard',
      });
    });
  }
}
