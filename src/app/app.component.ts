import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconRegistry } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';

import { ConfigService } from './core/config.service';
import { footerIcons } from './core/footer-icons';
import { NavigationComponent } from './core/navigation/navigation.component';
import { tenantLegalLinks } from './core/tenant-legal-links';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    NavigationComponent,
    MatSnackBarModule,
    FontAwesomeModule,
    MatButtonModule,
    MatTooltipModule,
  ],
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  private readonly config = inject(ConfigService);
  protected readonly footerIcons = footerIcons;
  protected readonly footerLinks = computed(
    () => this.config.tenantSignal()?.footerLinks ?? [],
  );
  protected readonly legalLinks = computed(() =>
    tenantLegalLinks(this.config.tenantSignal()),
  );
  private readonly iconRegistry = inject(MatIconRegistry);
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    this.iconRegistry.addSvgIconLiteral(
      'faPlus',
      this.sanitizer.bypassSecurityTrustHtml(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path class="fa-secondary" opacity=".4" d=""/><path class="fa-primary" d="M248 72l0-24-48 0 0 24 0 160L40 232l-24 0 0 48 24 0 160 0 0 160 0 24 48 0 0-24 0-160 160 0 24 0 0-48-24 0-160 0 0-160z"/></svg>`,
      ),
    );
  }
}
