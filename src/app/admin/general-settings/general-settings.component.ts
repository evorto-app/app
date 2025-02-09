import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, RouterLink, MatButtonModule],
  selector: 'app-general-settings',
  styles: ``,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
  protected readonly faArrowLeft = faArrowLeft;
}
