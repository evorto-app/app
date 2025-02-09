import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faFolderUser,
  faGlobe,
  faUsers,
  faUsersGear,
} from '@fortawesome/duotone-regular-svg-icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, RouterLink, RouterOutlet, RouterLinkActive],
  selector: 'app-admin-overview',
  styles: ``,
  templateUrl: './admin-overview.component.html',
})
export class AdminOverviewComponent {
  protected readonly faFolderUser = faFolderUser;
  protected readonly faGlobe = faGlobe;
  protected readonly faUsers = faUsers;
  protected readonly faUsersGear = faUsersGear;
  protected readonly outletActive = signal(false);
}
