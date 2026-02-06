import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faBadgeCheck,
  faListTimeline,
  faReceipt,
  faRotateExclamation,
} from '@fortawesome/duotone-regular-svg-icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FaDuotoneIconComponent, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-finance-overview',
  styles: ``,
  templateUrl: './finance-overview.component.html',
})
export class FinanceOverviewComponent {
  protected readonly faBadgeCheck = faBadgeCheck;
  protected readonly faListTimeline = faListTimeline;
  protected readonly faReceipt = faReceipt;
  protected readonly faRotateExclamation = faRotateExclamation;
  protected readonly outletActive = signal(false);
}
