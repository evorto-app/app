import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faEllipsisVertical,
  faPlus,
  faXmark,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { holdServerRenderWhile } from '../../core/server-render-pending';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { TwoColumnLayoutComponent } from '../../shared/components/two-column-layout/two-column-layout.component';
import { IfPermissionDirective } from '../../shared/directives/if-permission.directive';
import {
  filterTemplateCategories,
  normalizeTemplateSearch,
} from './template-list.filter';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block lg:h-full lg:min-h-0' },
  imports: [
    TwoColumnLayoutComponent,
    RouterLink,
    MatButtonModule,
    FontAwesomeModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    IconComponent,
    IfPermissionDirective,
    RouterLinkActive,
    RouterOutlet,
  ],
  selector: 'app-template-list',
  styles: `
    input[type='search']::-webkit-search-cancel-button {
      appearance: none;
    }
  `,
  templateUrl: './template-list.component.html',
})
export class TemplateListComponent {
  protected readonly appRpc = AppRpc.injectClient();
  protected readonly canManageCategories = inject(
    PermissionsService,
  ).hasPermission('templates:manageCategories');
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faPlus = faPlus;
  protected readonly faXmark = faXmark;
  protected readonly outletActive = signal(false);
  protected readonly templateSearch = signal('');
  protected templateQuery = injectQuery(() =>
    this.appRpc.templates.groupedByCategory.queryOptions(),
  );
  protected readonly filteredCategories = computed(() =>
    this.templateQuery.isSuccess()
      ? filterTemplateCategories(
          this.templateQuery.data(),
          this.templateSearch(),
        )
      : [],
  );
  protected readonly isFilteringTemplates = computed(
    () => normalizeTemplateSearch(this.templateSearch()) !== '',
  );
  protected readonly trimmedTemplateSearch = computed(() =>
    this.templateSearch().trim(),
  );
  constructor() {
    holdServerRenderWhile(() => this.templateQuery.isPending());
  }

  protected clearTemplateSearch(input: HTMLInputElement): void {
    this.templateSearch.set('');
    input.focus();
  }

  protected updateTemplateSearch(event: Event): void {
    const target = event.target;
    this.templateSearch.set(
      target instanceof HTMLInputElement ? target.value : '',
    );
  }
}
