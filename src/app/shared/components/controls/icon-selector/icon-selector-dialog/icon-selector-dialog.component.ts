import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { form, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { debounceTime } from 'rxjs';

import { injectTRPC } from '../../../../../core/trpc-client';
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
  protected readonly searchForm = form(this.searchModel);
  protected readonly searchValue = toSignal(
    toObservable(this.searchForm.query().value).pipe(debounceTime(400)),
    { initialValue: '' },
  );
  private trpc = injectTRPC();
  protected readonly iconSearchQuery = injectQuery(() =>
    this.trpc.icons.search.queryOptions({ search: this.searchValue() }),
  );
  protected displayDirectAccess = computed(() => {
    const iconData = this.iconSearchQuery.data();
    return !!(iconData && iconData.length === 0);
  });
  private readonly addIconMutation = injectMutation(() =>
    this.trpc.icons.addIcon.mutationOptions(),
  );
  private readonly queryClient = inject(QueryClient);

  async saveIconDirectly() {
    const icon = this.searchModel().query;
    this.addIconMutation.mutate(
      { icon },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.icons.search.pathKey(),
          });
        },
      },
    );
  }
}
