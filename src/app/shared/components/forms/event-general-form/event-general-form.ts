import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTimepickerModule } from '@angular/material/timepicker';

import { EditorComponent } from '../../controls/editor/editor.component';
import { IconSelectorFieldComponent } from '../../controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { LocationSelectorField } from '../../controls/location-selector/location-selector-field/location-selector-field';
import { EventGeneralFormModel } from './event-general-form.schema';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EditorComponent,
    FormField,
    IconSelectorFieldComponent,
    MatDatepickerModule,
    MatTimepickerModule,
    MatInputModule,
    MatFormFieldModule,
    LocationSelectorField,
  ],
  selector: 'app-event-general-form',
  styles: ``,
  templateUrl: './event-general-form.html',
})
export class EventGeneralForm {
  public readonly generalForm = input.required<FieldTree<EventGeneralFormModel>>();
}
