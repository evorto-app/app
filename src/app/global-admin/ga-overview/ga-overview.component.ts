import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faFolders } from '@fortawesome/duotone-regular-svg-icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FontAwesomeModule],
  selector: 'app-ga-overview',
  styles: ``,
  templateUrl: './ga-overview.component.html',
})
export class GaOverviewComponent {
  protected readonly faFolders = faFolders;
  protected readonly outletActive = signal(false);
}
