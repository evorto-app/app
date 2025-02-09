import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';

import { NavigationComponent } from './core/navigation/navigation.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NavigationComponent, MatSnackBarModule],
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  constructor(iconRegistry: MatIconRegistry, san: DomSanitizer) {
    iconRegistry.addSvgIconLiteral(
      'faPlus',
      san.bypassSecurityTrustHtml(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path class="fa-secondary" opacity=".4" d=""/><path class="fa-primary" d="M248 72l0-24-48 0 0 24 0 160L40 232l-24 0 0 48 24 0 160 0 0 160 0 24 48 0 0-24 0-160 160 0 24 0 0-48-24 0-160 0 0-160z"/></svg>`,
      ),
    );
  }
}
