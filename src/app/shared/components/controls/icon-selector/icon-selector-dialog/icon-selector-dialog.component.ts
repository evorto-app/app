import type { IconValue } from '@shared/types/icon';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { debounce, form, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../../../../core/effect-rpc-angular-client';
import { IconComponent } from '../../../icon/icon.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    // NotificationComponent,
    IconComponent,
    FormField,
  ],
  selector: 'app-icon-selector-dialog',
  styles: ``,
  templateUrl: './icon-selector-dialog.component.html',
})
export class IconSelectorDialogComponent {
  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
  });
  protected readonly searchValue = computed(
    () => this.searchForm().value().query,
  );
  protected readonly directAccessIcon = computed<IconValue>(() => ({
    iconColor: 0,
    iconName: this.searchValue(),
  }));
  private readonly rpc = AppRpc.injectClient();
  protected readonly iconSearchQuery = injectQuery(() =>
    this.rpc.icons.search.queryOptions({ search: this.searchValue() }),
  );
  protected displayDirectAccess = computed(() => {
    const iconData = this.iconSearchQuery.data();
    return !!(iconData && iconData.length === 0);
  });
  protected readonly iconChoices = computed(() => {
    const icons = this.iconSearchQuery.data() ?? [];
    return icons.map((icon) => ({
      ...icon,
      value: {
        iconColor: icon.sourceColor ?? 0,
        iconName: icon.commonName,
      } satisfies IconValue,
    }));
  });
  private readonly addIconMutation = injectMutation(() =>
    this.rpc.icons.add.mutationOptions(),
  );
  private readonly queryClient = inject(QueryClient);

  async saveIconDirectly() {
    const icon = this.searchValue();
    this.addIconMutation.mutate(
      { icon },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['icons', 'search']),
          );
        },
      },
    );
  }
}
