import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTimepickerModule } from '@angular/material/timepicker';

import { EventLocation } from '../../../../../shared/types/location';
import { EditorComponent } from '../../controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../controls/icon-selector/icon-selector-field/icon-selector-field.component';
import {
  LocationSelectorField
} from '../../controls/location-selector/location-selector-field/location-selector-field';

export type EventGeneralFormGroup = FormGroup<GeneralFormControls>;
interface GeneralFormControls {
  description: FormControl<string>;
  end: FormControl<Date>;
  icon: FormControl<string>;
  location: FormControl<EventLocation | null>;
  registrationOptions: FormArray;
  start: FormControl<Date>;
  title: FormControl<string>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EditorComponent,
    IconSelectorFieldComponent,
    MatDatepickerModule,
    MatTimepickerModule,
    MatInputModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    LocationSelectorField,
  ],
  selector: 'app-event-general-form',
  styles: ``,
  templateUrl: './event-general-form.html',
})
export class EventGeneralForm {
  public readonly generalForm = input.required<EventGeneralFormGroup>();
}
