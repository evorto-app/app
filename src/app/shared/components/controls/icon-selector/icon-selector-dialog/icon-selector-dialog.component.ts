import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { injectQuery } from '@tanstack/angular-query-experimental';
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
  protected displayDirectAccess = signal(false);
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

  async saveIconDirectly() {
    // await this.trpc.core.addIcon.mutate({ icon: this.searchControl.value });
    // this.dialog.close(this.searchControl.value);
  }
}
