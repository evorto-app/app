import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  signal,
  inject,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  NonNullableFormBuilder,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

interface DurationValue {
  days: number;
  hours: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DurationSelectorComponent),
      multi: true,
    },
  ],
  selector: 'app-duration-selector',
  standalone: true,
  templateUrl: './duration-selector.component.html',
})
export class DurationSelectorComponent implements ControlValueAccessor {
  public readonly label = input<string>('Duration');
  public readonly hint = input<string>('');
  
  private fb = inject(NonNullableFormBuilder);
  
  protected readonly durationForm = this.fb.group({
    days: [0],
    hours: [0],
  });

  private onChange = (value: number) => {};
  private onTouched = () => {};
  protected disabled = signal(false);

  constructor() {
    // Subscribe to form changes and emit the total hours
    this.durationForm.valueChanges.subscribe((value) => {
      const totalHours = (value.days || 0) * 24 + (value.hours || 0);
      this.onChange(totalHours);
    });
  }

  // ControlValueAccessor implementation
  writeValue(totalHours: number): void {
    if (totalHours !== null && totalHours !== undefined) {
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      
      this.durationForm.patchValue({
        days,
        hours,
      }, { emitEvent: false });
    }
  }

  registerOnChange(fn: (value: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    if (isDisabled) {
      this.durationForm.disable();
    } else {
      this.durationForm.enable();
    }
  }

  protected onBlur(): void {
    this.onTouched();
  }
}