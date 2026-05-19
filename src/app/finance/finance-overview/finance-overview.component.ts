import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faBadgeCheck,
  faListTimeline,
  faRotateExclamation,
} from '@fortawesome/duotone-regular-svg-icons';

import { IfPermissionDirective } from '../../shared/directives/if-permission.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FaDuotoneIconComponent,
    IfPermissionDirective,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  selector: 'app-finance-overview',
  styles: ``,
  templateUrl: './finance-overview.component.html',
})
export class FinanceOverviewComponent {
  protected readonly faBadgeCheck = faBadgeCheck;
  protected readonly faListTimeline = faListTimeline;
  protected readonly faRotateExclamation = faRotateExclamation;
  protected readonly outletActive = signal(false);
}
