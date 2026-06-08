import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type EventStatus = 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';

export const eventStatusClass = (status: EventStatus): string => {
  switch (status) {
    case 'APPROVED': {
      return 'bg-success text-on-success';
    }
    case 'DRAFT': {
      return 'bg-warn-container text-on-warn-container';
    }
    case 'PENDING_REVIEW': {
      return 'bg-tertiary-container text-on-tertiary-container';
    }
    case 'REJECTED': {
      return 'bg-error-container text-on-error-container';
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
      return 'Pending Review';
    }
    case 'REJECTED': {
      return 'Rejected';
    }
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-event-status',
  standalone: true,
  template: `
    <span [class]="getStatusClass()" class="rounded px-2 py-1 text-sm">
      {{ getStatusLabel() }}
    </span>
    @if (comment()) {
      <span class="text-on-surface-variant ml-2 text-sm"
        >{{ comment() }}
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
