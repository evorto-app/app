import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faFolders,
  faLockKeyhole,
} from '@fortawesome/duotone-regular-svg-icons';

@Component({
  imports: [RouterLink, FontAwesomeModule, RouterLinkActive],
  selector: 'app-navigation',
  styles: ``,
  templateUrl: './navigation.component.html',
})
export class NavigationComponent {
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faFolders = faFolders;
  protected readonly faLockKeyhole = faLockKeyhole;
}
