import type { EventReviewStatus } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type EventStatus = EventReviewStatus;

export const eventStatusClass = (status: EventStatus): string => {
  switch (status) {
    case 'APPROVED': {
      return 'bg-success text-on-success';
    }
    case 'DRAFT': {
      return 'bg-warning-container text-on-warning-container';
    }
    case 'PENDING_REVIEW': {
      return 'bg-tertiary-container text-on-tertiary-container';
    }
  }
};

export const eventStatusLabel = (status: EventStatus): string => {
  switch (status) {
    case 'APPROVED': {
      return 'Published';
    }
    case 'DRAFT': {
      return 'Draft';
    }
    case 'PENDING_REVIEW': {
      return 'In review';
    }
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex flex-wrap items-center gap-2' },
  selector: 'app-event-status',
  template: `
    <span
      [class]="getStatusClass()"
      class="inline-block whitespace-nowrap rounded px-2 py-1 text-sm"
    >
      {{ getStatusLabel() }}
    </span>
    @if (comment()) {
      <span class="text-on-surface-variant text-sm"
        >Review feedback: {{ comment() }}
        @if (reviewer()) {
          ({{ reviewer() }})
        }
      </span>
    }
  `,
})
export class EventStatusComponent {
  comment = input<null | string>();
  reviewer = input<null | string>();
  status = input.required<EventStatus>();

  protected getStatusClass(): string {
    return eventStatusClass(this.status());
  }

  protected getStatusLabel(): string {
    return eventStatusLabel(this.status());
  }
}
