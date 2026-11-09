import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faClockRotateLeft,
  faEnvelopeOpenText,
  faFolders,
} from '@fortawesome/duotone-regular-svg-icons';

import { TwoColumnLayoutComponent } from '../../shared/components/two-column-layout/two-column-layout.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TwoColumnLayoutComponent,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    FontAwesomeModule,
  ],
  selector: 'app-ga-overview',
  styles: ``,
  templateUrl: './ga-overview.component.html',
})
export class GaOverviewComponent {
  protected readonly faClockRotateLeft = faClockRotateLeft;
  protected readonly faEnvelopeOpenText = faEnvelopeOpenText;
  protected readonly faFolders = faFolders;
  protected readonly outletActive = signal(false);
}
