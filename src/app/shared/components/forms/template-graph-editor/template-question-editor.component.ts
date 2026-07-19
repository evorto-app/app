import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faTrashCan } from '@fortawesome/duotone-regular-svg-icons';

import { TemplateGraphOptionChoice } from './template-addon-editor.component';
import { TemplateGraphQuestionFormModel } from './template-graph-form.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: '@container block' },
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  selector: 'app-template-question-editor',
  templateUrl: './template-question-editor.component.html',
})
export class TemplateQuestionEditorComponent {
  readonly optionChoices =
    input.required<readonly TemplateGraphOptionChoice[]>();
  readonly questionForm =
    input.required<FieldTree<TemplateGraphQuestionFormModel>>();
  readonly remove = output();

  protected readonly faTrashCan = faTrashCan;
}
