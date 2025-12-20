import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

interface DurationValue {
  days: number;
  hours: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule, ReactiveFormsModule],
  providers: [
    {
      multi: true,
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DurationSelectorComponent),
    },
  ],
  selector: 'app-duration-selector',
  standalone: true,
  templateUrl: './duration-selector.component.html',
})
export class DurationSelectorComponent implements ControlValueAccessor {
  public readonly hint = input<string>('');
  public readonly label = input<string>('Duration');

  protected disabled = signal(false);

  private fb = inject(NonNullableFormBuilder);

  protected readonly durationForm = this.fb.group({
    days: [0],
    hours: [0],
  });
  constructor() {
    // Subscribe to form changes and emit the total hours
    this.durationForm.valueChanges.subscribe((value) => {
      const totalHours = (value.days || 0) * 24 + (value.hours || 0);
      this.onChange(totalHours);
    });
  }
  registerOnChange(function_: (value: number) => void): void {
    this.onChange = function_;
  }

  registerOnTouched(function_: () => void): void {
    this.onTouched = function_;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    if (isDisabled) {
      this.durationForm.disable();
    } else {
      this.durationForm.enable();
    }
  }

  // ControlValueAccessor implementation
  writeValue(totalHours: number): void {
    if (totalHours !== null && totalHours !== undefined) {
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;

      this.durationForm.patchValue(
        {
          days,
          hours,
        },
        { emitEvent: false },
      );
    }
  }

  protected onBlur(): void {
    this.onTouched();
  }

  private onChange = (value: number) => {};

  private onTouched = () => {};
}
