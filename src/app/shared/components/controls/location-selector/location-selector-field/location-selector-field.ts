import { ChangeDetectionStrategy, Component, forwardRef, inject, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import consola from 'consola/browser';
import { firstValueFrom } from 'rxjs';

import { EventLocationType, GoogleLocationType } from '../../../../../../types/location';
import { LocationSelectorDialog } from '../location-selector-dialog/location-selector-dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButton],
  providers: [
    {
      multi: true,
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => LocationSelectorField),
    },
  ],
  selector: 'app-location-selector-field',
  styles: ``,
  templateUrl: './location-selector-field.html',
})
export class LocationSelectorField implements ControlValueAccessor {
  protected readonly disabled = signal<boolean>(false);

  protected readonly value = signal<EventLocationType | null>(null);
  private readonly dialog = inject(MatDialog);

  // Registers a callback for when the value changes
  registerOnChange(function_: (value: EventLocationType) => void): void {
    this._onChange = function_;
  }
  // Registers a callback for when the field is touched
  registerOnTouched(function_: () => void): void {
    this._onTouched = function_;
  }

  // Sets the disabled state
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // Called by Angular to write a value to the field
  writeValue(value: EventLocationType | null): void {
    this.value.set(value);
  }

  // Called when the user opens the dialog to select a location
  protected async openDialog() {
    if (this.disabled()) return;
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
    consola.info(value);
    if (value) {
      this.value.set(value);
      this._onChange(value);
      this._onTouched();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onChange: (value: EventLocationType) => void = () => {};

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private _onTouched: () => void = () => {};
}
