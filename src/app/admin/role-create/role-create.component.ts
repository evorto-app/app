import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FontAwesomeModule, MatButtonModule],
  selector: 'app-role-create',
  styles: ``,
  templateUrl: './role-create.component.html',
})
export class RoleCreateComponent {
  protected readonly faArrowLeft = faArrowLeft;
}
