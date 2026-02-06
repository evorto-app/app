import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { MatButton } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

import { EventLocationType } from '../../../../../../types/location';
import { LocationSelectorDialog } from '../location-selector-dialog/location-selector-dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButton],
  selector: 'app-location-selector-field',
  styles: ``,
  templateUrl: './location-selector-field.html',
})
export class LocationSelectorField implements FormValueControl<EventLocationType | null> {
  readonly disabled = input<boolean>(false);
  readonly hidden = input<boolean>(false);
  readonly invalid = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly touched = model<boolean>(false);
  readonly value = model<EventLocationType | null>(
    // eslint-disable-next-line unicorn/no-null
    null,
  );
  protected readonly showError = computed(
    () => this.touched() && this.invalid(),
  );

  private readonly dialog = inject(MatDialog);

  // Called when the user opens the dialog to select a location
  protected async openDialog() {
    if (this.disabled() || this.readonly()) return;
    // Open dialog and handle result
    const dialogReference = this.dialog.open<
      LocationSelectorDialog,
      never,
      EventLocationType | undefined
    >(LocationSelectorDialog, {
      maxWidth: '90dvw',
      width: '400px',
    });
    const value = await firstValueFrom(dialogReference.afterClosed());
    this.touched.set(true);
    if (value) {
      this.value.set(value);
    }
  }
}
