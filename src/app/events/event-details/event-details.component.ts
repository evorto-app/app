import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { IconComponent } from '@app/shared/components/icon/icon.component';
import { Shape } from '@app/shared/components/shape/shape';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  hexFromArgb,
  themeFromSourceColor,
} from '@material/material-color-utilities';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';
import { convert } from 'html-to-text';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';
import { injectTRPC } from '../../core/trpc-client';
import { EventStatusComponent } from '../../shared/components/event-status/event-status.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventActiveRegistrationComponent } from '../event-active-registration/event-active-registration.component';
import { EventRegistrationOptionComponent } from '../event-registration-option/event-registration-option.component';
import { EventReviewDialogComponent } from '../event-review-dialog/event-review-dialog.component';
import { SubmitEventDialogComponent } from '../submit-event-dialog/submit-event-dialog.component';
import { UpdateVisibilityDialogComponent } from '../update-visibility-dialog/update-visibility-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style]': 'themeStyles()',
  },
  imports: [
    MatButtonModule,
    MatMenuModule,
    RouterLink,
    FontAwesomeModule,
    EventRegistrationOptionComponent,
    EventActiveRegistrationComponent,
    EventStatusComponent,
    IfAnyPermissionDirective,
    Shape,
    IconComponent,
  ],
  standalone: true,
  styles: `
    header {
      view-transition-name: header;
      h1 {
        view-transition-name: header-title;
      }
      app-shape {
        view-transition-name: header-shape;
      }
      //app-icon {
      //  view-transition-name: header-icon;
      //}
    }
  `,
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  public eventId = input.required<string>();
  private trpc = injectTRPC();
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.findOne.queryOptions({ id: this.eventId() }),
  );
  protected readonly selfQery = injectQuery(() =>
    this.trpc.users.maybeSelf.queryOptions(),
  );
  private permissions = inject(PermissionsService);
  protected readonly canEdit = computed(() => {
    const editAllPermission =
      this.permissions.hasPermission('events:editAll')();
    if (editAllPermission) {
      return true;
    }
    const event = this.eventQuery.data();
    const self = this.selfQery.data();
    if (!self || !event) {
      return false;
    }
    if (event.creatorId === self.id) {
      return event?.status === 'DRAFT' || event?.status === 'REJECTED';
    }
    return false;
  });
  protected readonly canOrganize = computed(() => {
    const organizeAllPermission =
      this.permissions.hasPermission('events:organizeAll')();
    if (organizeAllPermission) {
      return true;
    }
    return false; // TODO: Implement logic to check if the user can organize this event
  });
  protected readonly canReview =
    this.permissions.hasPermission('events:review');
  protected readonly canSeeStatus = computed(() => {
    const canReview = this.permissions.hasPermission('events:review')();
    const canEdit = this.canEdit();
    const canSeeDrafts = this.permissions.hasPermission('events:seeDrafts')();
    return canReview || canEdit || canSeeDrafts;
  });

  protected readonly eventTheme = computed(() => {
    const event = this.eventQuery.data();
    if (!event) {
      return;
    }
    const theme = themeFromSourceColor(event.icon.iconColor);
    consola.info('Event theme:', theme);
    return theme;
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly registrationStatusQuery = injectQuery(() =>
    this.trpc.events.getRegistrationStatus.queryOptions({
      eventId: this.eventId(),
    }),
  );
  protected readonly themeStyles = computed(() => {
    const theme = this.eventTheme();
    if (!theme) {
      return {};
    }
    const syles = {
      '--color-on-primary': `light-dark(${hexFromArgb(theme.schemes.light.onPrimary)}, ${hexFromArgb(theme.schemes.dark.onPrimary)})`,
      '--color-on-primary-container': `light-dark(${hexFromArgb(theme.schemes.light.onPrimaryContainer)}, ${hexFromArgb(theme.schemes.dark.onPrimaryContainer)})`,
      '--color-on-secondary': `light-dark(${hexFromArgb(theme.schemes.light.onSecondary)}, ${hexFromArgb(theme.schemes.dark.onSecondary)})`,
      '--color-on-secondary-container': `light-dark(${hexFromArgb(theme.schemes.light.onSecondaryContainer)}, ${hexFromArgb(theme.schemes.dark.onSecondaryContainer)})`,
      '--color-on-surface': `light-dark(${hexFromArgb(theme.schemes.light.onSurface)}, ${hexFromArgb(theme.schemes.dark.onSurface)})`,
      '--color-primary': `light-dark(${hexFromArgb(theme.schemes.light.primary)}, ${hexFromArgb(theme.schemes.dark.primary)})`,
      '--color-primary-container': `light-dark(${hexFromArgb(theme.schemes.light.primaryContainer)}, ${hexFromArgb(theme.schemes.dark.primaryContainer)})`,
      '--color-secondary': `light-dark(${hexFromArgb(theme.schemes.light.secondary)}, ${hexFromArgb(theme.schemes.dark.secondary)})`,
      '--color-secondary-container': `light-dark(${hexFromArgb(theme.schemes.light.secondaryContainer)}, ${hexFromArgb(theme.schemes.dark.secondaryContainer)})`,
      '--color-surface': `light-dark(${hexFromArgb(theme.schemes.light.surface)}, ${hexFromArgb(theme.schemes.dark.surface)})`,
      '--color-tertiary-container': `light-dark(${hexFromArgb(theme.schemes.light.tertiaryContainer)}, ${hexFromArgb(theme.schemes.dark.tertiaryContainer)})`,
      '--mat-sys-on-primary': `light-dark(${hexFromArgb(theme.schemes.light.onPrimary)}, ${hexFromArgb(theme.schemes.dark.onPrimary)})`,
      '--mat-sys-on-primary-container': `light-dark(${hexFromArgb(theme.schemes.light.onPrimaryContainer)}, ${hexFromArgb(theme.schemes.dark.onPrimaryContainer)})`,
      '--mat-sys-on-secondary': `light-dark(${hexFromArgb(theme.schemes.light.onSecondary)}, ${hexFromArgb(theme.schemes.dark.onSecondary)})`,
      '--mat-sys-on-secondary-container': `light-dark(${hexFromArgb(theme.schemes.light.onSecondaryContainer)}, ${hexFromArgb(theme.schemes.dark.onSecondaryContainer)})`,
      '--mat-sys-on-surface': `light-dark(${hexFromArgb(theme.schemes.light.onSurface)}, ${hexFromArgb(theme.schemes.dark.onSurface)})`,
      '--mat-sys-on-surface-variant': `light-dark(${hexFromArgb(theme.schemes.light.onSurfaceVariant)}, ${hexFromArgb(theme.schemes.dark.onSurfaceVariant)})`,
      '--mat-sys-primary': `light-dark(${hexFromArgb(theme.schemes.light.primary)}, ${hexFromArgb(theme.schemes.dark.primary)})`,
      '--mat-sys-primary-container': `light-dark(${hexFromArgb(theme.schemes.light.primaryContainer)}, ${hexFromArgb(theme.schemes.dark.primaryContainer)})`,
      '--mat-sys-secondary': `light-dark(${hexFromArgb(theme.schemes.light.secondary)}, ${hexFromArgb(theme.schemes.dark.secondary)})`,
      '--mat-sys-secondary-container': `light-dark(${hexFromArgb(theme.schemes.light.secondaryContainer)}, ${hexFromArgb(theme.schemes.dark.secondaryContainer)})`,
      '--mat-sys-surface': `light-dark(${hexFromArgb(theme.schemes.light.surface)}, ${hexFromArgb(theme.schemes.dark.surface)})`,
      '--mat-sys-surface-variant': `light-dark(${hexFromArgb(theme.schemes.light.surfaceVariant)}, ${hexFromArgb(theme.schemes.dark.surfaceVariant)})`,
    };
    consola.info('Theme styles:', syles);
    return syles;
  });
  protected readonly updateVisibilityMutation = injectMutation(() =>
    this.trpc.events.updateVisibility.mutationOptions(),
  );
  private readonly config = inject(ConfigService);
  private dialog = inject(MatDialog);

  private notifications = inject(NotificationService);
  private readonly reviewMutation = injectMutation(() =>
    this.trpc.events.reviewEvent.mutationOptions(),
  );
  private readonly submitForReviewMutation = injectMutation(() =>
    this.trpc.events.submitForReview.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const event = this.eventQuery.data();
      if (event) {
        this.config.updateTitle(event.title);
        this.config.updateDescription(convert(event.description));
      }
    });
  }

  async updateVisibility() {
    const visibility = await firstValueFrom(
      this.dialog
        .open(UpdateVisibilityDialogComponent, {
          data: { event: this.eventQuery.data() },
        })
        .afterClosed(),
    );
    if (visibility) {
      this.updateVisibilityMutation.mutate({
        eventId: this.eventId(),
        visibility,
      });
    }
  }

  protected async reviewEvent(approved: boolean): Promise<void> {
    if (approved) {
      await this.reviewMutation.mutateAsync({
        approved,
        eventId: this.eventId(),
      });
      const event = this.eventQuery.data();
      if (event) {
        this.notifications.showEventReviewed(approved, event.title);
      }
    } else {
      const dialogReference = this.dialog.open(EventReviewDialogComponent);
      const comment = await firstValueFrom(dialogReference.afterClosed());

      if (comment) {
        await this.reviewMutation.mutateAsync({
          approved,
          comment,
          eventId: this.eventId(),
        });
        const event = this.eventQuery.data();
        if (event) {
          this.notifications.showEventReviewed(approved, event.title);
        }
      }
    }
  }

  protected async submitForReview(): Promise<void> {
    const dialogReference = this.dialog.open(SubmitEventDialogComponent);
    const confirmed = await firstValueFrom(dialogReference.afterClosed());

    if (confirmed) {
      await this.submitForReviewMutation.mutateAsync({
        eventId: this.eventId(),
      });
      const event = this.eventQuery.data();
      if (event) {
        this.notifications.showEventSubmitted(event.title);
      }
    }
  }
}
