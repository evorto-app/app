import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
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
    ReactiveFormsModule,
  ],
  selector: 'app-icon-selector-dialog',
  styles: ``,
  templateUrl: './icon-selector-dialog.component.html',
})
export class IconSelectorDialogComponent {
  protected searchControl = new FormControl('', { nonNullable: true });
  protected searchValue = toSignal(
    this.searchControl.valueChanges.pipe(debounceTime(400)),
    {
      initialValue: '',
    },
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
    const icon = this.searchControl.value;
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
