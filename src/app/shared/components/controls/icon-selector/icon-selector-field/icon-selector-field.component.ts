import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  model,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { IconComponent } from '../../../icon/icon.component';
import { IconSelectorDialogComponent } from '../icon-selector-dialog/icon-selector-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MatButtonModule, MatDialogModule],
  selector: 'app-icon-selector-field',
  styles: ``,
  templateUrl: './icon-selector-field.component.html',
})
export class IconSelectorFieldComponent
  implements
    FormValueControl<string | { iconColor: number; iconName: string } | null>
{
  readonly value = model<
    string | { iconColor: number; iconName: string } | null
  >(null);
  readonly touched = model<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly hidden = input<boolean>(false);

  private dialog = inject(MatDialog);

  async openSelectionDialog() {
    if (this.disabled() || this.readonly()) return;
    const icon = await firstValueFrom(
      this.dialog
        .open(IconSelectorDialogComponent, { minWidth: '70dvw' })
        .afterClosed(),
    );
    if (icon) {
      this.value.set(icon);
      this.touched.set(true);
    }
  }
}
