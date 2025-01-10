import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule],
  selector: 'app-role-list',
  styles: ``,
  templateUrl: './role-list.component.html',
})
export class RoleListComponent {
  faArrowLeft = faArrowLeft;
}
