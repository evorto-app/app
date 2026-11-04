import type { EventsEventListRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faClock } from '@fortawesome/duotone-regular-svg-icons';

import { ConfigService } from '../../core/config.service';
import {
  TENANT_DATE_PIPE_TIMEZONE,
  TenantDatePipe,
} from '../../core/tenant-date.pipe';
import { eventStatusLabel } from '../../shared/components/event-status/event-status.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { Shape } from '../../shared/components/shape/shape';
import { TwoColumnLayoutComponent } from '../../shared/components/two-column-layout/two-column-layout.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventListService } from '../event-list.service';
import {
  eventPreviewRelativeDate,
  EventPreviewService,
} from './event-preview.service';

export const eventListSignUpStateLabel = (
  state: EventsEventListRecord['userSignUpState'],
): null | string => {
  switch (state) {
    case 'approvalPending': {
      return 'Waiting for approval';
    }
    case 'confirmed': {
      return 'Place confirmed';
    }
    case null: {
      return null;
    }
    case 'organizerConfirmed': {
      return 'Organizer confirmed';
    }
    case 'paymentRequired': {
      return 'Finish payment';
    }
    case 'waitlisted': {
      return 'On waitlist';
    }
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-none lg:overflow-hidden',
  },
  imports: [
    TwoColumnLayoutComponent,
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    IconComponent,
    Shape,
    RouterOutlet,
    RouterLinkActive,
    TenantDatePipe,
    IfAnyPermissionDirective,
  ],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly eventListService = inject(EventListService);

  protected readonly eventStatusLabel = eventStatusLabel;
  protected readonly eventDays = this.eventListService.eventDays;
  protected readonly eventListSignUpStateLabel = eventListSignUpStateLabel;
  protected readonly eventQuery = this.eventListService.eventQuery;
  protected readonly faClock = faClock;
  protected readonly outletActive = signal(false);
  private readonly previewReady = signal(false);
  protected readonly previewIndex = signal(0);
  protected readonly loadedPreviewIcons = signal<ReadonlySet<string>>(
    new Set(),
  );
  protected readonly previewPaused = signal(false);
  protected readonly previews = inject(EventPreviewService);
  private readonly timezone = inject(TENANT_DATE_PIPE_TIMEZONE);
  protected readonly previewEvent = computed(() => {
    const events = this.previews.events();
    return events[this.previewIndex() % events.length];
  });
  protected readonly previewIcon = computed(
    () => this.previewEvent()?.icon ?? { iconColor: 0, iconName: 'calendar' },
  );
  protected readonly previewUpcoming = computed(() =>
    this.eventDays().some((day) =>
      day.events.some((event) => event.id === this.previewEvent()?.id),
    ),
  );
  protected readonly previewDate = computed(() => {
    const event = this.previewEvent();
    return event
      ? eventPreviewRelativeDate(
          event.start,
          new Date().toISOString(),
          this.timezone,
        )
      : null;
  });
  private readonly config = inject(ConfigService);

  constructor() {
    this.config.updateTitle('Events');
    afterNextRender(() => this.previewReady.set(true));
    effect((onCleanup) => {
      const count = this.previews.events().length;
      if (!this.previewReady() || this.outletActive() || count < 2) return;

      const desktopMotion = globalThis.matchMedia(
        '(min-width: 64rem) and (prefers-reduced-motion: no-preference)',
      );
      const interval = setInterval(() => {
        if (document.hidden || !desktopMotion.matches || this.previewPaused())
          return;
        const ready = this.previews
          .events()
          .flatMap((event, index) =>
            index !== this.previewIndex() &&
            this.loadedPreviewIcons().has(event.icon.iconName)
              ? [index]
              : [],
          );
        const next = ready[Math.floor(Math.random() * ready.length)];
        if (next !== undefined) this.previewIndex.set(next);
      }, 6000);
      onCleanup(() => clearInterval(interval));
    });
  }

  protected previewIconLoaded(name: string) {
    this.loadedPreviewIcons.update((icons) => new Set([...icons, name]));
  }
}
