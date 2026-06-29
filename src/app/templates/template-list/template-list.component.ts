import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faEllipsisVertical,
  faPlus,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatButtonModule,
    FontAwesomeModule,
    MatMenuModule,
    IconComponent,
    RouterLinkActive,
    RouterOutlet,
  ],
  selector: 'app-template-list',
  styles: ``,
  templateUrl: './template-list.component.html',
})
export class TemplateListComponent {
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faPlus = faPlus;
  protected readonly outletActive = signal(false);
  private readonly rpc = AppRpc.injectClient();
  protected templateQuery = injectQuery(() =>
    this.rpc.templates.groupedByCategory.queryOptions(),
  );
  protected readonly templateQueryErrorMessage = computed(() => {
    const error = this.templateQuery.error();
    return getErrorMessage(error, 'Unknown error');
  });
}
