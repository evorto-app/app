import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
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
import { ActivatedRoute } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faPencil,
  faReceipt,
  faRightFromBracket,
  faTags,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  EditProfileDialogComponent,
  EditProfileDialogData,
  EditProfileDialogResult,
} from './edit-profile-dialog.component';

type ProfileSection = 'discounts' | 'events' | 'overview' | 'receipts';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'app-user-profile',
  styles: ``,
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent {
  protected readonly allSectionEntries: {
    icon: typeof faUser;
    key: ProfileSection;
    label: string;
  }[] = [
    { icon: faUser, key: 'overview', label: 'Overview' },
    { icon: faCalendarDays, key: 'events', label: 'Events' },
    { icon: faTags, key: 'discounts', label: 'Discounts' },
    { icon: faReceipt, key: 'receipts', label: 'Receipts' },
  ];
  private readonly rpc = AppRpc.injectClient();
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly buyEsnCardUrl = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return;
    const esnProvider = providers.find(
      (provider) => provider.type === 'esnCard',
    );
    const buyEsnCardUrl = esnProvider?.config.buyEsnCardUrl?.trim();
    return buyEsnCardUrl && buyEsnCardUrl.length > 0
      ? buyEsnCardUrl
      : undefined;
  });
  protected readonly deleteCardMutation = injectMutation(() =>
    this.rpc.discounts.deleteMyCard.mutationOptions(),
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
  protected readonly faReceipt = faReceipt;
  protected readonly faRightFromBracket = faRightFromBracket;
  protected readonly faTags = faTags;
  protected readonly faUser = faUser;
  protected readonly myCardsQuery = injectQuery(() =>
    this.rpc.discounts.getMyCards.queryOptions(),
  );
  protected readonly hasVerifiedEsnCard = computed(() => {
    const cards = this.myCardsQuery.data();
    if (!cards) return false;
    return cards.some(
      (card) => card.type === 'esnCard' && card.status === 'verified',
    );
  });

  protected readonly myReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.my.queryOptions(),
  );
  protected readonly refreshCardMutation = injectMutation(() =>
    this.rpc.discounts.refreshMyCard.mutationOptions(),
  );

  protected readonly sectionEntries = computed(() =>
    this.allSectionEntries.filter(
      (section) => section.key !== 'discounts' || this.esnEnabled(),
    ),
  );
  protected readonly selectedSection = signal<ProfileSection>('overview');

  protected readonly updateProfileMutation = injectMutation(() =>
    this.rpc.users.updateProfile.mutationOptions(),
  );
  protected readonly upsertCardMutation = injectMutation(() =>
    this.rpc.discounts.upsertMyCard.mutationOptions(),
  );
  protected readonly userEventsQuery = injectQuery(() =>
    this.rpc.users.events.queryOptions(),
  );
  protected readonly userQuery = injectQuery(() =>
    this.rpc.users.self.queryOptions(),
  );
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  private readonly queryClient = inject(QueryClient);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    effect(() => {
      if (!this.esnEnabled() && this.selectedSection() === 'discounts') {
        this.selectedSection.set('overview');
      }
    });

    this.route.fragment.subscribe((fragment) => {
      if (fragment === 'discounts' && this.esnEnabled()) {
        this.selectedSection.set('discounts');
        return;
      }

      if (fragment === 'events') {
        this.selectedSection.set('events');
        return;
      }

      if (fragment === 'receipts') {
        this.selectedSection.set('receipts');
        return;
      }

      this.selectedSection.set('overview');
    });
  }

  protected deleteEsnCard(): void {
    this.deleteCardMutation.mutate(
      { type: 'esnCard' },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['discounts', 'getMyCards']),
          );
          this.notifications.showSuccess('ESN card removed');
        },
      },
    );
  }

  protected async openEditProfileDialog(): Promise<void> {
    const user = this.userQuery.data();
    if (!user) return;
    const dialogReference = this.dialog.open<
      EditProfileDialogComponent,
      EditProfileDialogData,
      EditProfileDialogResult
    >(EditProfileDialogComponent, {
      data: {
        firstName: user.firstName,
        iban: user.iban,
        lastName: user.lastName,
        paypalEmail: user.paypalEmail,
      },
      width: '420px',
    });
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (!result) return;
    this.updateProfileMutation.mutate(result, {
      onError: (error) => {
        const errorMessage = typeof error === 'string' ? error : error.message;
        this.notifications.showError(
          'Failed to update profile: ' + errorMessage,
        );
      },
      onSuccess: async () => {
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['users', 'self']),
        );
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['users', 'maybeSelf']),
        );
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter([
            'finance',
            'receipts.refundableGroupedByRecipient',
          ]),
        );
        this.notifications.showSuccess('Profile updated successfully');
      },
    });
  }

  protected refreshEsnCard(): void {
    this.refreshCardMutation.mutate(
      { type: 'esnCard' },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['discounts', 'getMyCards']),
          );
          this.notifications.showSuccess('ESN card refreshed');
        },
      },
    );
  }

  protected async saveEsnCard(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.esnCardForm, async (formState) => {
      this.upsertCardMutation.mutate(
        {
          identifier: formState().value().identifier.trim(),
          type: 'esnCard',
        },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['discounts', 'getMyCards']),
            );
            this.esnCardModel.set({ identifier: '' });
            this.notifications.showSuccess('ESN card saved');
          },
        },
      );
    });
  }

  protected sectionButtonClasses(section: ProfileSection): string {
    if (this.selectedSection() === section) {
      return 'bg-secondary-container text-on-secondary-container';
    }
    return 'bg-surface text-on-surface';
  }

  protected setSelectedSection(section: ProfileSection): void {
    this.selectedSection.set(section);
  }
}
