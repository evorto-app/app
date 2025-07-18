import { DatePipe, NgFor, NgIf } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  signal,
} from '@angular/core';
import { inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
    FormsModule,
    MatCardModule,
    DatePipe,
    NgIf,
    NgFor,
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
  protected displayName = signal('');
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faCog = faCog;
  protected readonly faPencil = faPencil;
  protected readonly faRightFromBracket = faRightFromBracket;

  protected readonly faUser = faUser;
  protected isEditing = signal(false);

  private readonly trpc = injectTRPC();
  protected readonly updateProfileMutation = injectMutation(() =>
    this.trpc.users.updateProfile.mutationOptions(),
  );

  protected readonly userEventsQuery = injectQuery(() =>
    this.trpc.users.events.findMany.queryOptions(),
  );

  protected readonly userQuery = injectQuery(() =>
    this.trpc.users.self.queryOptions(),
  );
  private readonly notifications = inject(NotificationService);

  protected cancelEditing(): void {
    this.isEditing.set(false);
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
        onSuccess: () => {
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
