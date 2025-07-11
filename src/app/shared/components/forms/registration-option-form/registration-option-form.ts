import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTimepickerModule } from '@angular/material/timepicker';

import { EditorComponent } from '../../controls/editor/editor.component';

export type RegistrationOptionFormGroup = FormGroup<{
  closeRegistrationTime: FormControl<Date>;
  description: FormControl<string>;
  isPaid: FormControl<boolean>;
  openRegistrationTime: FormControl<Date>;
  organizingRegistration: FormControl<boolean>;
  price: FormControl<number>;
  registeredDescription: FormControl<string>;
  registrationMode: FormControl<'application' | 'fcfs' | 'random'>;
  spots: FormControl<number>;
  title: FormControl<string>;
}>;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    EditorComponent,
    MatCheckboxModule,
    MatSelectModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    TitleCasePipe,
  ],
  selector: 'app-registration-option-form',
  styles: ``,
  templateUrl: './registration-option-form.html',
})
export class RegistrationOptionForm {
  public registrationModes = input.required<readonly string[]>();
  public registrationOptionForm = input.required<RegistrationOptionFormGroup>();
}
