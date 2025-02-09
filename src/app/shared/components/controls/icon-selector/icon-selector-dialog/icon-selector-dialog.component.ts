import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { debounceTime } from 'rxjs';

import { QueriesService } from '../../../../../core/queries.service';
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
  private queries = inject(QueriesService);
  protected readonly iconSearchQuery = injectQuery(
    this.queries.searchIcons(this.searchValue),
  );
  protected displayDirectAccess = computed(() => {
    const iconData = this.iconSearchQuery.data();
    return !!(iconData && iconData.length === 0);
  });
  private readonly addIconMutation = injectMutation(this.queries.addIcon());

  async saveIconDirectly() {
    const icon = this.searchControl.value;
    this.addIconMutation.mutate({ icon });
  }
}
