/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Directive } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Directive({
  providers: [
    {
      multi: true,
      provide: NG_VALUE_ACCESSOR,
      useExisting: NoopValueAccessorDirective,
    },
  ],
  selector: '[appNoopValueAccessor]',
})
export class NoopValueAccessorDirective implements ControlValueAccessor {
  registerOnChange(_function: unknown): void {}
  registerOnTouched(_function: unknown): void {}
  writeValue(_object: unknown): void {}
}
