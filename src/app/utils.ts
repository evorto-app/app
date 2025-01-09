import { inject } from '@angular/core';
import {
  FormControlDirective,
  FormControlName,
  NgControl,
  NgModel,
} from '@angular/forms';

export function injectNgControl() {
  const ngControl = inject(NgControl, { optional: true, self: true });

  if (!ngControl)
    throw new Error('A form control was expected but not supplied.');

  if (
    ngControl instanceof FormControlDirective ||
    ngControl instanceof FormControlName ||
    ngControl instanceof NgModel
  ) {
    return ngControl;
  }

  throw new Error('A form control was expected but not supplied.');
}
